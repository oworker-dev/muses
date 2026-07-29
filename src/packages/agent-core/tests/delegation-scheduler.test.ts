import { describe, expect, it } from "vitest";

import {
  AGENT_DELEGATION_SCHEMA_VERSION,
  DefaultAgentDelegationScheduler,
  InMemoryAgentDelegationStore,
  type AgentBudgetUsage,
  type AgentClockPort,
  type AgentDelegationAuthoritySnapshot,
  type AgentDelegationBudgetPort,
  type AgentDelegationChildRuntimePort,
  type AgentDelegationChildSnapshot,
  type AgentDelegationFingerprintPort,
  type AgentDelegationPlan,
  type AgentDelegationProfileRegistryPort,
  type AgentDelegationResultValidatorPort,
  type AgentDelegationTask,
  type AgentIdPort,
  type AgentProfileSnapshot,
} from "../src";

describe("DefaultAgentDelegationScheduler", () => {
  it("executes independent children within concurrency and aggregates results", async () => {
    const fixture = schedulerFixture();
    const plan = delegationPlan([
      delegatedTask("research"),
      delegatedTask("render"),
    ], { maxConcurrency: 2 });
    const submitted = await fixture.scheduler.submit({
      plan,
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });

    const completed = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(completed).toMatchObject({
      status: "completed",
      budgetReservation: { status: "settled" },
      tasks: [
        { taskId: "research", status: "completed" },
        { taskId: "render", status: "completed" },
      ],
    });
    expect(fixture.children.starts.map(({ taskId }) => taskId)).toEqual([
      "research",
      "render",
    ]);
    expect(fixture.budget.operations.filter((value) => value.startsWith("envelope:reserve"))).toHaveLength(1);
    const events = await fixture.store.readEvents(completed.delegationRunId);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events.at(-1)?.type).toBe("delegation.completed");
  });

  it("replays one submission and rejects idempotency drift", async () => {
    const fixture = schedulerFixture();
    const input = {
      plan: delegationPlan(),
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    };
    const first = await fixture.scheduler.submit(input);
    const replay = await fixture.scheduler.submit(input);

    expect(replay).toEqual(first);
    expect(fixture.budget.operations.filter((value) => value.startsWith("envelope:reserve"))).toHaveLength(1);

    const changedTask = delegatedTask("research");
    await expect(
      fixture.scheduler.submit({
        ...input,
        plan: delegationPlan([{ ...changedTask, objective: "Changed" }]),
      }),
    ).rejects.toMatchObject({ code: "delegation-idempotency-conflict" });
  });

  it("reclaims an expired task lease after a crash before child preparation", async () => {
    const fixture = schedulerFixture({ profileFailures: 1 });
    const submitted = await fixture.scheduler.submit({
      plan: delegationPlan(),
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });

    await expect(
      fixture.scheduler.resume(submitted.run.delegationRunId),
    ).rejects.toThrow("profile registry unavailable");
    fixture.clock.advance(31_000);

    const completed = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(completed.status).toBe("completed");
    const events = await fixture.store.readEvents(completed.delegationRunId);
    expect(events.filter(({ type }) => type === "task.claimed")).toHaveLength(2);
    expect(
      events.find(
        ({ type, data }) => type === "task.claimed" && data.recovered === true,
      ),
    ).toBeTruthy();
  });

  it("reuses child identity after task reservation fails behind the receipt", async () => {
    const fixture = schedulerFixture({ taskReservationFailures: 1 });
    const submitted = await fixture.scheduler.submit({
      plan: delegationPlan(),
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });

    await expect(
      fixture.scheduler.resume(submitted.run.delegationRunId),
    ).rejects.toThrow("task reservation unavailable");
    const prepared = await fixture.scheduler.inspect(
      submitted.run.delegationRunId,
    );
    const childRunId = prepared.tasks[0]?.childRunId;

    const completed = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(completed.tasks[0]?.childRunId).toBe(childRunId);
    expect(fixture.children.starts).toHaveLength(1);
    const events = await fixture.store.readEvents(completed.delegationRunId);
    expect(
      events.filter(({ type }) => type === "task.child-submitted"),
    ).toHaveLength(1);
  });

  it("isolates a failed branch while independent work completes", async () => {
    const fixture = schedulerFixture({
      childOutcomes: {
        research: failedChild("provider-rejected"),
      },
    });
    const plan = delegationPlan(
      [
        delegatedTask("research"),
        delegatedTask("independent"),
        delegatedTask("render", ["research"]),
      ],
      { maxConcurrency: 2, failureMode: "isolate" },
    );
    const submitted = await fixture.scheduler.submit({
      plan,
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });

    const completed = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(completed.status).toBe("completed-with-failures");
    expect(completed.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "research", status: "failed" }),
        expect.objectContaining({ taskId: "independent", status: "completed" }),
        expect.objectContaining({ taskId: "render", status: "blocked" }),
      ]),
    );
    expect(fixture.children.starts.map(({ taskId }) => taskId)).not.toContain(
      "render",
    );
  });

  it("fail-fast cancels an already running sibling", async () => {
    const fixture = schedulerFixture({
      childOutcomes: {
        long: runningChild(),
        required: failedChild("required-failed"),
      },
    });
    const plan = delegationPlan(
      [delegatedTask("long"), delegatedTask("required")],
      { maxConcurrency: 2, failureMode: "fail-fast" },
    );
    const submitted = await fixture.scheduler.submit({
      plan,
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });

    const failed = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(failed.status).toBe("failed");
    expect(failed.failure).toMatchObject({
      code: "required-failed",
      taskId: "required",
    });
    expect(fixture.children.cancellations).toEqual([
      expect.objectContaining({ childRunId: failed.tasks[0]?.childRunId }),
    ]);
    expect(failed.tasks[0]?.status).toBe("cancelled");
  });

  it("cancels a running delegation idempotently and rejects cancellation drift", async () => {
    const fixture = schedulerFixture({
      childOutcomes: { research: runningChild() },
    });
    const submitted = await fixture.scheduler.submit({
      plan: delegationPlan(),
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });
    const running = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );
    expect(running.tasks[0]?.status).toBe("running");

    const input = {
      delegationRunId: running.delegationRunId,
      idempotencyKey: "cancel-1",
      reason: "User stopped the plan.",
    };
    const cancelled = await fixture.scheduler.cancel(input);
    const replay = await fixture.scheduler.cancel(input);

    expect(cancelled.status).toBe("cancelled");
    expect(replay).toEqual(cancelled);
    expect(fixture.children.cancellations).toHaveLength(1);
    await expect(
      fixture.scheduler.cancel({ ...input, reason: "Different reason" }),
    ).rejects.toMatchObject({ code: "delegation-idempotency-conflict" });
  });

  it("rejects a resolved Profile that exceeds the task grant", async () => {
    const fixture = schedulerFixture({
      profile: profile({ toolNames: ["image.generate", "admin.delete"] }),
    });
    const submitted = await fixture.scheduler.submit({
      plan: delegationPlan(),
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });

    const completed = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(completed.status).toBe("completed-with-failures");
    expect(completed.tasks[0]).toMatchObject({
      status: "failed",
      failure: { code: "profile-invalid" },
    });
    expect(fixture.children.starts).toHaveLength(0);
  });

  it("does not exceed maxConcurrency while children remain active", async () => {
    const fixture = schedulerFixture({
      childOutcomes: {
        one: runningChild(),
        two: runningChild(),
        three: runningChild(),
      },
    });
    const submitted = await fixture.scheduler.submit({
      plan: delegationPlan(
        [delegatedTask("one"), delegatedTask("two"), delegatedTask("three")],
        { maxConcurrency: 2 },
      ),
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });

    const running = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(fixture.children.starts).toHaveLength(2);
    expect(running.tasks.filter(({ status }) => status === "running")).toHaveLength(2);
    expect(running.tasks.filter(({ status }) => status === "ready")).toHaveLength(1);
  });

  it("reconciles a later completed child while an earlier sibling is still running", async () => {
    const fixture = schedulerFixture({
      childOutcomes: {
        long: runningChild(),
        quick: runningChild(),
      },
    });
    const submitted = await fixture.scheduler.submit({
      plan: delegationPlan(
        [delegatedTask("long"), delegatedTask("quick")],
        { maxConcurrency: 2 },
      ),
      authority: delegationAuthority(),
      idempotencyKey: "submit-1",
    });
    const running = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );
    const quickRunId = running.tasks.find(
      ({ taskId }) => taskId === "quick",
    )?.childRunId;
    fixture.children.complete(quickRunId!, "quick");

    const reconciled = await fixture.scheduler.resume(
      submitted.run.delegationRunId,
    );

    expect(reconciled.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "long", status: "running" }),
        expect.objectContaining({ taskId: "quick", status: "completed" }),
      ]),
    );
  });
});

function schedulerFixture(options: {
  profileFailures?: number;
  taskReservationFailures?: number;
  childOutcomes?: Record<string, AgentDelegationChildSnapshot>;
  profile?: AgentProfileSnapshot;
} = {}) {
  const ids = new FixedIds();
  const clock = new FixedClock();
  const store = new InMemoryAgentDelegationStore(ids);
  const budget = new FixtureBudget(options.taskReservationFailures || 0);
  const children = new FixtureChildren(options.childOutcomes || {});
  let profileFailures = options.profileFailures || 0;
  const profiles: AgentDelegationProfileRegistryPort = {
    resolve: async () => {
      if (profileFailures > 0) {
        profileFailures -= 1;
        throw new Error("profile registry unavailable");
      }
      return options.profile || profile();
    },
  };
  const results: AgentDelegationResultValidatorPort = {
    validate: async ({ task, result }) => {
      const kinds = new Set(result.evidence.map(({ kind }) => kind));
      return task.result.requiredEvidenceKinds.every((kind) => kinds.has(kind))
        ? { ok: true }
        : {
            ok: false,
            code: "evidence-missing",
            message: "Required task evidence is missing.",
          };
    },
  };
  const fingerprints: AgentDelegationFingerprintPort = {
    fingerprint: (value) => JSON.stringify(value),
  };
  return {
    ids,
    clock,
    store,
    budget,
    children,
    scheduler: new DefaultAgentDelegationScheduler({
      store,
      budget,
      children,
      profiles,
      results,
      fingerprints,
      ids,
      clock,
    }),
  };
}

class FixtureBudget implements AgentDelegationBudgetPort {
  readonly operations: string[] = [];
  private readonly completed = new Set<string>();

  constructor(private taskReservationFailures: number) {}

  async reserveEnvelope(input: Parameters<AgentDelegationBudgetPort["reserveEnvelope"]>[0]) {
    this.once(`envelope:reserve:${input.reservationId}`);
  }

  async reserveTask(input: Parameters<AgentDelegationBudgetPort["reserveTask"]>[0]) {
    if (this.taskReservationFailures > 0) {
      this.taskReservationFailures -= 1;
      throw new Error("task reservation unavailable");
    }
    this.once(`task:reserve:${input.reservationId}`);
  }

  async finalizeTask(input: Parameters<AgentDelegationBudgetPort["finalizeTask"]>[0]) {
    this.once(`task:${input.outcome}:${input.reservationId}`);
  }

  async finalizeEnvelope(input: Parameters<AgentDelegationBudgetPort["finalizeEnvelope"]>[0]) {
    this.once(`envelope:${input.outcome}:${input.reservationId}`);
  }

  private once(operation: string) {
    if (this.completed.has(operation)) return;
    this.completed.add(operation);
    this.operations.push(operation);
  }
}

class FixtureChildren implements AgentDelegationChildRuntimePort {
  readonly starts: Array<{ childRunId: string; taskId: string }> = [];
  readonly cancellations: Array<{ childRunId: string; reason: string }> = [];
  private readonly snapshots = new Map<string, AgentDelegationChildSnapshot>();

  constructor(private readonly outcomes: Record<string, AgentDelegationChildSnapshot>) {}

  async start(input: Parameters<AgentDelegationChildRuntimePort["start"]>[0]) {
    const existing = this.snapshots.get(input.childRunId);
    if (existing) return existing;
    this.starts.push({ childRunId: input.childRunId, taskId: input.taskId });
    const configured = this.outcomes[input.taskId];
    const snapshot = configured
      ? { ...configured, childRunId: input.childRunId }
      : completedChild(input.childRunId, input.taskId);
    this.snapshots.set(input.childRunId, snapshot);
    return snapshot;
  }

  async inspect(childRunId: string) {
    const snapshot = this.snapshots.get(childRunId);
    if (!snapshot) throw new Error("child not found");
    return snapshot;
  }

  async cancel(input: Parameters<AgentDelegationChildRuntimePort["cancel"]>[0]) {
    const current = this.snapshots.get(input.childRunId);
    if (!current) return null;
    if (current.status === "cancelled") return current;
    this.cancellations.push({
      childRunId: input.childRunId,
      reason: input.reason,
    });
    const cancelled: AgentDelegationChildSnapshot = {
      ...current,
      status: "cancelled",
      failure: {
        code: "cancelled",
        message: input.reason,
        retryable: false,
      },
    };
    this.snapshots.set(input.childRunId, cancelled);
    return cancelled;
  }

  complete(childRunId: string, taskId: string) {
    this.snapshots.set(childRunId, completedChild(childRunId, taskId));
  }
}

class FixedClock implements AgentClockPort {
  private timestamp = Date.parse("2026-07-29T00:00:00.000Z");

  now() {
    return new Date(this.timestamp);
  }

  advance(milliseconds: number) {
    this.timestamp += milliseconds;
  }
}

class FixedIds implements AgentIdPort {
  private sequence = 0;

  create(prefix: Parameters<AgentIdPort["create"]>[0]) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

function completedChild(
  childRunId: string,
  taskId: string,
): AgentDelegationChildSnapshot {
  return {
    childRunId,
    childSandboxId: `sandbox:${childRunId}`,
    status: "completed",
    result: {
      data: { taskId, value: "done" },
      artifactRefs: [`artifact:${taskId}`],
      evidence: [{ kind: "artifact", ref: `artifact:${taskId}` }],
    },
    usage: usage(),
    costOutcome: "known",
  };
}

function runningChild(): AgentDelegationChildSnapshot {
  return {
    childRunId: "replaced-by-fixture",
    childSandboxId: "sandbox:running",
    status: "running",
  };
}

function failedChild(code: string): AgentDelegationChildSnapshot {
  return {
    childRunId: "replaced-by-fixture",
    childSandboxId: "sandbox:failed",
    status: "failed",
    costOutcome: "known",
    failure: { code, message: code, retryable: false },
  };
}

function usage(): AgentBudgetUsage {
  return {
    turns: 1,
    modelCalls: 1,
    toolCalls: 1,
    inputTokens: 100,
    outputTokens: 50,
    creditMicros: "10",
    startedAt: "2026-07-29T00:00:00.000Z",
  };
}

function profile(
  overrides: Partial<AgentProfileSnapshot> = {},
): AgentProfileSnapshot {
  return {
    profileId: "image-specialist",
    version: "1.0.0",
    modelRef: "fixture/model",
    instructions: "Complete the delegated image task.",
    toolNames: ["image.generate"],
    skillRefs: ["image-direction@1.0.0"],
    mcpConnectionRefs: ["asset-search@1.0.0"],
    ...overrides,
  };
}

function delegationPlan(
  tasks: readonly AgentDelegationTask[] = [delegatedTask("research")],
  overrides: Partial<AgentDelegationPlan> = {},
): AgentDelegationPlan {
  return {
    schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
    planId: "plan-1",
    revision: 0,
    workspaceId: "workspace-1",
    projectId: "project-1",
    sessionId: "session-1",
    rootRunId: "run-root",
    delegatedByRunId: "run-root",
    maxConcurrency: 1,
    failureMode: "isolate",
    tasks,
    createdAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

function delegatedTask(
  taskId: string,
  dependsOn: readonly string[] = [],
): AgentDelegationTask {
  return {
    taskId,
    objective: `Complete ${taskId}.`,
    profile: { profileId: "image-specialist", version: "1.0.0" },
    dependsOn,
    context: {
      sourceRunId: "run-root",
      sourceContextVersion: 2,
      facts: [
        {
          key: "brief",
          value: "Create one campaign image.",
          classification: "workspace",
        },
      ],
      artifactRefs: ["artifact:brief-1"],
    },
    grant: {
      permissions: ["image.generate"],
      toolNames: ["image.generate"],
      skillRefs: ["image-direction@1.0.0"],
      mcpConnectionRefs: ["asset-search@1.0.0"],
      computeCapabilities: ["media-processing"],
    },
    budget: {
      maxTurns: 2,
      maxModelCalls: 2,
      maxToolCalls: 2,
      maxInputTokens: 1_000,
      maxOutputTokens: 500,
      maxCreditMicros: "100",
      maxDurationMs: 10_000,
    },
    result: {
      outputSchema: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
      maxBytes: 8_192,
      requiredEvidenceKinds: ["artifact"],
    },
  };
}

function delegationAuthority(): AgentDelegationAuthoritySnapshot {
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    sessionId: "session-1",
    rootRunId: "run-root",
    delegatedByRunId: "run-root",
    sourceContextVersion: 2,
    currentDepth: 0,
    policy: {
      maxDepth: 3,
      maxTasks: 8,
      maxConcurrency: 4,
      maxContextCharactersPerTask: 1_024,
      maxResultBytesPerTask: 16_384,
    },
    delegablePermissions: ["image.generate"],
    delegableToolNames: ["image.generate"],
    delegableSkillRefs: ["image-direction@1.0.0"],
    delegableMcpConnectionRefs: ["asset-search@1.0.0"],
    delegableComputeCapabilities: ["media-processing"],
    delegableContextClassifications: ["public", "workspace"],
    delegableArtifactRefs: ["artifact:brief-1"],
    remainingBudget: {
      maxTurns: 20,
      maxModelCalls: 20,
      maxToolCalls: 20,
      maxInputTokens: 20_000,
      maxOutputTokens: 10_000,
      maxCreditMicros: "10000",
      maxDurationMs: 60_000,
    },
  };
}
