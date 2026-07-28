import {
  AGENT_CORE_SCHEMA_VERSION,
  type AgentApprovalRequest,
  type AgentBudgetLimit,
  type AgentBudgetUsage,
  type AgentEventDraft,
  type AgentExecutionPlan,
  type AgentMessage,
  type AgentPendingToolCall,
  type AgentRunRef,
  type AgentRunSnapshot,
  type AgentToolCall,
  type AgentToolCallResult,
  type ApprovalDecision,
  type StartAgentRun,
} from "./contracts";
import type {
  AgentClockPort,
  AgentIdPort,
  AgentModelPort,
  AgentPolicyPort,
  AgentStateStorePort,
  AgentToolDefinition,
  AgentToolRegistryPort,
} from "./ports";
import {
  AgentRuntimeError,
  parseAgentEventCursor,
  type AgentRuntimePort,
} from "./runtime-port";

export type HeadlessAgentRuntimeDependencies = {
  readonly model: AgentModelPort;
  readonly tools: AgentToolRegistryPort;
  readonly policy: AgentPolicyPort;
  readonly store: AgentStateStorePort;
  readonly clock?: AgentClockPort;
  readonly ids?: AgentIdPort;
};

export class HeadlessAgentRuntime implements AgentRuntimePort {
  private readonly clock: AgentClockPort;
  private readonly ids: AgentIdPort;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly closedSessions = new Set<string>();

  constructor(private readonly dependencies: HeadlessAgentRuntimeDependencies) {
    this.clock = dependencies.clock || new SystemAgentClock();
    this.ids = dependencies.ids || new RandomAgentIdPort();
  }

  async start(input: StartAgentRun): Promise<AgentRunRef> {
    validateBudget(input.budget);
    if (input.runId) {
      const existing = await this.dependencies.store.read(input.runId);
      if (existing) {
        assertIdempotentStart(existing, input);
        return toRunRef(existing);
      }
    }
    if (this.closedSessions.has(input.session.sessionId)) {
      throw new AgentRuntimeError(
        "run-state-invalid",
        "The AgentSession is closed.",
      );
    }
    const now = this.now();
    const runId = input.runId || this.ids.create("arun");
    const userMessage = this.message("user", input.input, now);
    const systemMessage = this.message(
      "system",
      input.profile.instructions,
      now,
    );
    const snapshot: AgentRunSnapshot = {
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      runId,
      session: {
        schemaVersion: AGENT_CORE_SCHEMA_VERSION,
        ...input.session,
        createdAt: now,
        updatedAt: now,
      },
      profile: structuredClone(input.profile),
      status: "queued",
      revision: 0,
      turn: 0,
      context: {
        version: 1,
        messages: [systemMessage, userMessage],
        artifactRefs: [],
        createdAt: now,
      },
      plan: input.plan
        ? { ...structuredClone(input.plan), revision: 0, updatedAt: now }
        : undefined,
      budget: {
        limit: structuredClone(input.budget),
        usage: zeroUsage(now),
      },
      permissions: [...input.permissions],
      metadata: structuredClone(input.metadata || {}),
      pendingMessages: [],
      pendingToolCalls: [],
      createdAt: now,
      updatedAt: now,
    };
    const events: AgentEventDraft[] = [
      this.event(runId, "run.created", now, {
        sessionId: input.session.sessionId,
        profileId: input.profile.profileId,
        profileVersion: input.profile.version,
        metadata: input.metadata || {},
      }),
      this.event(runId, "message.received", now, {
        messageId: userMessage.id,
        role: userMessage.role,
      }),
    ];
    if (snapshot.plan) {
      events.push(
        this.event(runId, "plan.updated", now, {
          revision: snapshot.plan.revision,
          goal: snapshot.plan.goal,
        }),
      );
    }
    try {
      await this.dependencies.store.create(snapshot, events);
    } catch (error) {
      if (input.runId && isRevisionConflict(error)) {
        const existing = await this.dependencies.store.read(input.runId);
        if (existing) {
          assertIdempotentStart(existing, input);
          return toRunRef(existing);
        }
      }
      throw error;
    }
    return toRunRef(snapshot);
  }

  stream(runId: string, cursor?: string) {
    return this.dependencies.store.stream(runId, parseAgentEventCursor(cursor));
  }

  async steer(runId: string, message: AgentMessage) {
    await this.serialize(runId, async () => {
      const run = await this.requireRun(runId);
      if (isTerminal(run.status)) {
        throw new AgentRuntimeError(
          "run-state-invalid",
          "Steering cannot change a terminal AgentRun; use followUp.",
        );
      }
      await this.commit(
        run,
        {
          ...run,
          pendingMessages: [...run.pendingMessages, structuredClone(message)],
        },
        [
          this.event(runId, "message.received", this.now(), {
            messageId: message.id,
            role: message.role,
            mode: "steer",
          }),
        ],
      );
    });
  }

  async followUp(runId: string, message: AgentMessage) {
    await this.serialize(runId, async () => {
      const run = await this.requireRun(runId);
      if (run.status === "cancelled") {
        throw new AgentRuntimeError(
          "run-state-invalid",
          "A cancelled AgentRun cannot accept follow-up work.",
        );
      }
      await this.commit(
        run,
        {
          ...run,
          status: isTerminal(run.status) ? "queued" : run.status,
          completedAt: isTerminal(run.status) ? undefined : run.completedAt,
          failure: isTerminal(run.status) ? undefined : run.failure,
          pendingMessages: [...run.pendingMessages, structuredClone(message)],
        },
        [
          this.event(runId, "message.follow-up", this.now(), {
            messageId: message.id,
            role: message.role,
          }),
        ],
      );
    });
  }

  async approve(runId: string, decision: ApprovalDecision) {
    await this.serialize(runId, async () => {
      const run = await this.requireRun(runId);
      const pending = run.pendingToolCalls[0];
      if (
        run.status !== "waiting-approval" ||
        !pending?.approval ||
        pending.approval.approvalId !== decision.approvalId
      ) {
        throw new AgentRuntimeError(
          "approval-not-found",
          "The pending Agent approval was not found.",
        );
      }
      const now = this.now();
      const approval: AgentApprovalRequest = {
        ...pending.approval,
        status: decision.decision,
        decidedAt: now,
        decisionReason: decision.reason,
      };
      const remaining = run.pendingToolCalls.slice(1);
      const nextPending: readonly AgentPendingToolCall[] =
        decision.decision === "approved"
          ? [{ ...pending, state: "approved", approval }, ...remaining]
          : remaining;
      const deniedMessage =
        decision.decision === "denied"
          ? this.toolMessage(
              pending.call,
              {
                toolCallId: pending.call.id,
                ok: false,
                error: {
                  code: "approval-denied",
                  message: decision.reason || "The tool call was not approved.",
                  retryable: false,
                },
              },
              now,
            )
          : undefined;
      await this.commit(
        run,
        {
          ...run,
          status: "queued",
          pendingToolCalls: nextPending,
          pendingApproval: undefined,
          context: deniedMessage
            ? appendContextMessages(run, [deniedMessage], now)
            : run.context,
        },
        [
          this.event(runId, "approval.decided", now, {
            approvalId: approval.approvalId,
            decision: decision.decision,
            reason: decision.reason || "",
          }),
        ],
      );
    });
  }

  async cancel(runId: string, reason?: string) {
    await this.serialize(runId, async () => {
      const run = await this.requireRun(runId);
      if (run.status === "cancelled") return;
      if (run.status === "completed" || run.status === "failed") {
        throw new AgentRuntimeError(
          "run-state-invalid",
          "A terminal AgentRun cannot be cancelled.",
        );
      }
      const now = this.now();
      await this.commit(
        run,
        {
          ...run,
          status: "cancelled",
          pendingToolCalls: [],
          pendingApproval: undefined,
          completedAt: now,
        },
        [this.event(runId, "run.cancelled", now, { reason: reason || "" })],
      );
    });
  }

  async resume(runId: string) {
    await this.serialize(runId, () => this.drive(runId));
  }

  async inspect(runId: string) {
    return this.requireRun(runId);
  }

  async updatePlan(
    runId: string,
    expectedPlanRevision: number,
    plan: Omit<AgentExecutionPlan, "revision" | "updatedAt">,
  ) {
    await this.serialize(runId, async () => {
      const run = await this.requireRun(runId);
      const revision = run.plan?.revision ?? -1;
      if (revision !== expectedPlanRevision) {
        throw new AgentRuntimeError(
          "plan-revision-conflict",
          `Expected plan revision ${expectedPlanRevision}; current revision is ${revision}.`,
        );
      }
      const now = this.now();
      const nextPlan = {
        ...structuredClone(plan),
        revision: revision + 1,
        updatedAt: now,
      };
      await this.commit(run, { ...run, plan: nextPlan }, [
        this.event(runId, "plan.updated", now, {
          revision: nextPlan.revision,
          goal: nextPlan.goal,
        }),
      ]);
    });
  }

  async close(sessionId: string) {
    this.closedSessions.add(sessionId);
  }

  private async drive(runId: string) {
    let run = await this.requireRun(runId);
    if (run.status === "waiting-approval") {
      throw new AgentRuntimeError(
        "run-state-invalid",
        "The AgentRun requires an approval decision before resume.",
      );
    }
    if (isTerminal(run.status)) {
      throw new AgentRuntimeError(
        "run-state-invalid",
        "The AgentRun is already terminal.",
      );
    }

    let now = this.now();
    run = await this.commit(run, { ...run, status: "running" }, [
      this.event(
        runId,
        run.revision === 0 ? "run.started" : "run.resumed",
        now,
        {},
      ),
    ]);

    while (run.status === "running") {
      const budgetFailure = checkBudgetBeforeModel(run, this.clock.now());
      if (budgetFailure) {
        await this.fail(run, budgetFailure);
        return;
      }

      if (run.pendingMessages.length > 0) {
        now = this.now();
        run = await this.commit(
          run,
          {
            ...run,
            context: appendContextMessages(run, run.pendingMessages, now),
            pendingMessages: [],
          },
          [],
        );
      }

      if (run.pendingToolCalls.length > 0) {
        const outcome = await this.processPendingTool(run);
        run = outcome.run;
        if (outcome.waiting) return;
        continue;
      }

      const tools = await this.availableTools(run);
      let modelResult;
      try {
        modelResult = await this.dependencies.model.complete({
          run,
          messages: run.context.messages,
          tools,
        });
      } catch (error) {
        await this.fail(run, {
          code: "model-failed",
          message:
            error instanceof Error ? error.message : "The model call failed.",
          retryable: true,
        });
        return;
      }

      const nextUsage = addModelUsage(run.budget.usage, modelResult.usage);
      const usageFailure = checkBudgetAfterModel(run.budget.limit, nextUsage);
      if (usageFailure) {
        await this.fail(run, usageFailure);
        return;
      }
      now = this.now();
      const assistant = this.message("assistant", modelResult.content, now, {
        toolCalls: modelResult.toolCalls,
      });
      const nextPlan = modelResult.plan
        ? {
            ...structuredClone(modelResult.plan),
            revision: (run.plan?.revision ?? -1) + 1,
            updatedAt: now,
          }
        : run.plan;
      const pendingToolCalls = modelResult.toolCalls.map(
        (call): AgentPendingToolCall => ({
          call: structuredClone(call),
          state: "policy-check",
        }),
      );
      const events: AgentEventDraft[] = [
        this.event(runId, "model.completed", now, {
          turn: run.turn + 1,
          finishReason: modelResult.finishReason,
          toolCallCount: modelResult.toolCalls.length,
          usage: modelResult.usage,
        }),
      ];
      if (modelResult.plan) {
        events.push(
          this.event(runId, "plan.updated", now, {
            revision: nextPlan?.revision ?? 0,
            goal: nextPlan?.goal || "",
          }),
        );
      }
      run = await this.commit(
        run,
        {
          ...run,
          turn: run.turn + 1,
          context: appendContextMessages(run, [assistant], now),
          plan: nextPlan,
          pendingToolCalls,
          budget: { ...run.budget, usage: nextUsage },
        },
        events,
      );

      if (
        modelResult.finishReason === "stop" ||
        modelResult.toolCalls.length === 0
      ) {
        now = this.now();
        await this.commit(
          run,
          { ...run, status: "completed", completedAt: now },
          [this.event(runId, "run.completed", now, { turn: run.turn })],
        );
        return;
      }
    }
  }

  private async processPendingTool(run: AgentRunSnapshot) {
    const pending = run.pendingToolCalls[0];
    const remaining = run.pendingToolCalls.slice(1);
    const tool = (await this.availableTools(run)).find(
      (candidate) => candidate.name === pending.call.name,
    );
    if (!tool) {
      const now = this.now();
      const message = this.toolMessage(
        pending.call,
        {
          toolCallId: pending.call.id,
          ok: false,
          error: {
            code: "tool-not-found",
            message: `Tool "${pending.call.name}" is not available.`,
            retryable: false,
          },
        },
        now,
      );
      return {
        waiting: false,
        run: await this.commit(
          run,
          {
            ...run,
            pendingToolCalls: remaining,
            context: appendContextMessages(run, [message], now),
          },
          [
            this.event(run.runId, "tool.denied", now, {
              toolCallId: pending.call.id,
              code: "tool-not-found",
            }),
          ],
        ),
      };
    }

    if (pending.state === "policy-check") {
      const policy = await this.dependencies.policy.authorizeTool({
        run,
        tool,
        call: pending.call,
      });
      if (policy.outcome === "approval") {
        const now = this.now();
        const approval: AgentApprovalRequest = {
          approvalId: this.ids.create("approval"),
          toolCall: structuredClone(pending.call),
          reason: policy.reason,
          requestedAt: now,
          status: "pending",
        };
        const waiting = {
          ...pending,
          state: "waiting-approval" as const,
          approval,
        };
        const next = await this.commit(
          run,
          {
            ...run,
            status: "waiting-approval",
            pendingToolCalls: [waiting, ...remaining],
            pendingApproval: approval,
          },
          [
            this.event(run.runId, "tool.requested", now, {
              toolCallId: pending.call.id,
              toolName: pending.call.name,
            }),
            this.event(run.runId, "approval.requested", now, {
              approvalId: approval.approvalId,
              toolCallId: pending.call.id,
              reason: approval.reason,
            }),
          ],
        );
        return { waiting: true, run: next };
      }
      if (policy.outcome === "deny") {
        const now = this.now();
        const result: AgentToolCallResult = {
          toolCallId: pending.call.id,
          ok: false,
          error: {
            code: "policy-denied",
            message: policy.reason,
            retryable: false,
          },
        };
        return {
          waiting: false,
          run: await this.commit(
            run,
            {
              ...run,
              pendingToolCalls: remaining,
              context: appendContextMessages(
                run,
                [this.toolMessage(pending.call, result, now)],
                now,
              ),
            },
            [
              this.event(run.runId, "tool.denied", now, {
                toolCallId: pending.call.id,
                reason: policy.reason,
              }),
            ],
          ),
        };
      }
    }

    if (run.budget.usage.toolCalls >= run.budget.limit.maxToolCalls) {
      await this.fail(run, budgetFailure("tool-call-budget-exceeded"));
      return { waiting: true, run: await this.requireRun(run.runId) };
    }
    const now = this.now();
    run = await this.commit(run, run, [
      this.event(run.runId, "tool.started", now, {
        toolCallId: pending.call.id,
        toolName: pending.call.name,
      }),
    ]);

    let result: AgentToolCallResult;
    try {
      result = await this.dependencies.tools.execute(pending.call, {
        workspaceId: run.session.workspaceId,
        projectId: run.session.projectId,
        canvasId: run.session.canvasId,
        sessionId: run.session.sessionId,
        runId: run.runId,
        permissions: run.permissions,
        metadata: run.metadata,
        idempotencyKey: `${run.runId}:${pending.call.id}`,
      });
    } catch (error) {
      result = {
        toolCallId: pending.call.id,
        ok: false,
        error: {
          code: "tool-execution-failed",
          message:
            error instanceof Error ? error.message : "Tool execution failed.",
          retryable: true,
        },
      };
    }
    const completedAt = this.now();
    const usage = {
      ...run.budget.usage,
      toolCalls: run.budget.usage.toolCalls + 1,
    };
    const next = await this.commit(
      run,
      {
        ...run,
        pendingToolCalls: remaining,
        context: appendContextMessages(
          run,
          [this.toolMessage(pending.call, result, completedAt)],
          completedAt,
        ),
        budget: { ...run.budget, usage },
      },
      [
        this.event(
          run.runId,
          result.ok ? "tool.completed" : "tool.failed",
          completedAt,
          {
            toolCallId: pending.call.id,
            toolName: pending.call.name,
            ok: result.ok,
            error: result.error || null,
          },
        ),
      ],
    );
    return { waiting: false, run: next };
  }

  private async availableTools(run: AgentRunSnapshot) {
    const allowedNames = new Set(run.profile.toolNames);
    return (await this.dependencies.tools.list(run)).filter(
      (tool) =>
        allowedNames.has(tool.name) &&
        tool.requiredPermissions.every((permission) =>
          run.permissions.includes(permission),
        ),
    );
  }

  private async fail(
    run: AgentRunSnapshot,
    failure: AgentRunSnapshot["failure"] & {},
  ) {
    const now = this.now();
    await this.commit(
      run,
      {
        ...run,
        status: "failed",
        failure,
        pendingToolCalls: [],
        pendingApproval: undefined,
        completedAt: now,
      },
      [this.event(run.runId, "run.failed", now, failure)],
    );
  }

  private async commit(
    current: AgentRunSnapshot,
    next: AgentRunSnapshot,
    events: readonly AgentEventDraft[],
  ) {
    const now = this.now();
    const revision = current.revision + 1;
    const eventCount = (await this.dependencies.store.readEvents(current.runId))
      .length;
    const checkpoint = {
      checkpointId: this.ids.create("checkpoint"),
      runRevision: revision,
      contextVersion: next.context.version,
      eventSequence: eventCount + events.length + 1,
      createdAt: now,
    };
    return this.dependencies.store.commit({
      runId: current.runId,
      expectedRevision: current.revision,
      snapshot: {
        ...next,
        revision,
        session: { ...next.session, updatedAt: now },
        checkpoint,
        updatedAt: now,
      },
      events: [
        ...events,
        this.event(current.runId, "checkpoint.created", now, {
          checkpointId: checkpoint.checkpointId,
          runRevision: checkpoint.runRevision,
          contextVersion: checkpoint.contextVersion,
        }),
      ],
    });
  }

  private async requireRun(runId: string) {
    const run = await this.dependencies.store.read(runId);
    if (!run) {
      throw new AgentRuntimeError("run-not-found", "AgentRun was not found.");
    }
    return run;
  }

  private serialize<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(runId) || Promise.resolve();
    const current = previous.then(operation, operation);
    const queued = current.finally(() => {
      if (this.queues.get(runId) === queued) this.queues.delete(runId);
    });
    this.queues.set(runId, queued);
    return current;
  }

  private message(
    role: AgentMessage["role"],
    content: string,
    createdAt: string,
    options: {
      toolCallId?: string;
      toolName?: string;
      toolCalls?: readonly AgentToolCall[];
    } = {},
  ): AgentMessage {
    return {
      id: this.ids.create("amsg"),
      role,
      content,
      createdAt,
      ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
      ...(options.toolName ? { toolName: options.toolName } : {}),
      ...(options.toolCalls && options.toolCalls.length > 0
        ? { toolCalls: structuredClone(options.toolCalls) }
        : {}),
    };
  }

  private toolMessage(
    call: AgentToolCall,
    result: AgentToolCallResult,
    createdAt: string,
  ) {
    return this.message(
      "tool",
      JSON.stringify(result.ok ? (result.output ?? null) : result.error),
      createdAt,
      { toolCallId: call.id, toolName: call.name },
    );
  }

  private event(
    runId: string,
    type: AgentEventDraft["type"],
    createdAt: string,
    data: Readonly<Record<string, unknown>>,
  ): AgentEventDraft {
    return {
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      runId,
      type,
      createdAt,
      data,
    };
  }

  private now() {
    return this.clock.now().toISOString();
  }
}

export class DefaultAgentPolicy implements AgentPolicyPort {
  async authorizeTool(input: {
    readonly run: AgentRunSnapshot;
    readonly tool: AgentToolDefinition;
    readonly call: AgentToolCall;
  }) {
    const missing = input.tool.requiredPermissions.filter(
      (permission) => !input.run.permissions.includes(permission),
    );
    if (missing.length > 0) {
      return {
        outcome: "deny" as const,
        reason: `Missing permissions: ${missing.join(", ")}.`,
      };
    }
    if (input.tool.sideEffect === "external") {
      return {
        outcome: "approval" as const,
        reason: "This tool creates an external side effect.",
      };
    }
    return { outcome: "allow" as const };
  }
}

export class SystemAgentClock implements AgentClockPort {
  now() {
    return new Date();
  }
}

export class RandomAgentIdPort implements AgentIdPort {
  create(prefix: Parameters<AgentIdPort["create"]>[0]) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  }
}

export class HeadlessAgentHarness {
  constructor(private readonly runtime: AgentRuntimePort) {}

  async execute(input: StartAgentRun) {
    const ref = await this.runtime.start(input);
    await this.runtime.resume(ref.runId);
    return this.runtime.inspect(ref.runId);
  }
}

function appendContextMessages(
  run: AgentRunSnapshot,
  messages: readonly AgentMessage[],
  createdAt: string,
) {
  return {
    ...run.context,
    version: run.context.version + 1,
    messages: [...run.context.messages, ...messages],
    createdAt,
  };
}

function zeroUsage(startedAt: string): AgentBudgetUsage {
  return {
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    creditMicros: "0",
    startedAt,
  };
}

function addModelUsage(
  usage: AgentBudgetUsage,
  model: { inputTokens: number; outputTokens: number; creditMicros: string },
): AgentBudgetUsage {
  return {
    ...usage,
    turns: usage.turns + 1,
    modelCalls: usage.modelCalls + 1,
    inputTokens: usage.inputTokens + model.inputTokens,
    outputTokens: usage.outputTokens + model.outputTokens,
    creditMicros: (
      BigInt(usage.creditMicros) + BigInt(model.creditMicros)
    ).toString(),
  };
}

function checkBudgetBeforeModel(run: AgentRunSnapshot, now: Date) {
  const { limit, usage } = run.budget;
  if (usage.turns >= limit.maxTurns)
    return budgetFailure("turn-budget-exceeded");
  if (usage.modelCalls >= limit.maxModelCalls) {
    return budgetFailure("model-call-budget-exceeded");
  }
  if (
    now.getTime() - new Date(usage.startedAt).getTime() >=
    limit.maxDurationMs
  ) {
    return budgetFailure("duration-budget-exceeded");
  }
  return null;
}

function checkBudgetAfterModel(
  limit: AgentBudgetLimit,
  usage: AgentBudgetUsage,
) {
  if (usage.inputTokens > limit.maxInputTokens) {
    return budgetFailure("input-token-budget-exceeded");
  }
  if (usage.outputTokens > limit.maxOutputTokens) {
    return budgetFailure("output-token-budget-exceeded");
  }
  if (BigInt(usage.creditMicros) > BigInt(limit.maxCreditMicros)) {
    return budgetFailure("credit-budget-exceeded");
  }
  return null;
}

function budgetFailure(code: string) {
  return {
    code,
    message: `Agent budget exceeded: ${code}.`,
    retryable: false,
  };
}

function validateBudget(budget: AgentBudgetLimit) {
  const integerLimits = [
    budget.maxTurns,
    budget.maxModelCalls,
    budget.maxToolCalls,
    budget.maxInputTokens,
    budget.maxOutputTokens,
    budget.maxDurationMs,
  ];
  if (
    integerLimits.some((value) => !Number.isInteger(value) || value <= 0) ||
    !/^\d+$/.test(budget.maxCreditMicros)
  ) {
    throw new AgentRuntimeError(
      "budget-exceeded",
      "Agent budget limits must be positive integers.",
    );
  }
}

function toRunRef(run: AgentRunSnapshot): AgentRunRef {
  return {
    runId: run.runId,
    sessionId: run.session.sessionId,
    status: run.status,
    revision: run.revision,
  };
}

function assertIdempotentStart(
  existing: AgentRunSnapshot,
  input: StartAgentRun,
) {
  if (
    existing.session.sessionId !== input.session.sessionId ||
    existing.session.workspaceId !== input.session.workspaceId ||
    existing.session.projectId !== input.session.projectId ||
    existing.session.canvasId !== input.session.canvasId ||
    existing.profile.profileId !== input.profile.profileId ||
    existing.profile.version !== input.profile.version
  ) {
    throw new AgentRuntimeError(
      "revision-conflict",
      `AgentRun "${existing.runId}" already belongs to another immutable start request.`,
    );
  }
}

function isRevisionConflict(error: unknown) {
  return error instanceof AgentRuntimeError && error.code === "revision-conflict";
}

function isTerminal(status: AgentRunSnapshot["status"]) {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
