import { describe, expect, it } from "vitest";

import {
  DefaultAgentPolicy,
  HeadlessAgentHarness,
  HeadlessAgentRuntime,
  InMemoryAgentStateStore,
  type AgentClockPort,
  type AgentIdPort,
  type AgentMessage,
  type AgentModelPort,
  type AgentModelResult,
  type AgentPolicyPort,
  type AgentRunSnapshot,
  type AgentToolCall,
  type AgentToolDefinition,
  type AgentToolRegistryPort,
  type StartAgentRun,
} from "../src";

describe("HeadlessAgentRuntime", () => {
  it("runs a model-tool-model loop with event and checkpoint evidence", async () => {
    const fixture = createRuntime([
      {
        content: "I will update the canvas.",
        finishReason: "tool-calls",
        toolCalls: [
          {
            id: "tool-call-1",
            name: "canvas.item.put",
            input: { itemId: "asset-1" },
          },
        ],
        usage: { inputTokens: 20, outputTokens: 8, creditMicros: "100" },
      },
      {
        content: "The asset is now on the canvas.",
        finishReason: "stop",
        toolCalls: [],
        usage: { inputTokens: 35, outputTokens: 10, creditMicros: "120" },
      },
    ]);
    const harness = new HeadlessAgentHarness(fixture.runtime);

    const result = await harness.execute(startInput());

    expect(result).toMatchObject({
      status: "completed",
      turn: 2,
      budget: {
        usage: {
          modelCalls: 2,
          toolCalls: 1,
          inputTokens: 55,
          outputTokens: 18,
          creditMicros: "220",
        },
      },
    });
    expect(result.checkpoint?.runRevision).toBe(result.revision);
    expect(
      result.context.messages.find(
        (message) => message.role === "assistant" && message.toolCalls?.length,
      ),
    ).toMatchObject({
      toolCalls: [
        {
          id: "tool-call-1",
          name: "canvas.item.put",
          input: { itemId: "asset-1" },
        },
      ],
    });
    expect(
      result.context.messages.find((message) => message.role === "tool"),
    ).toMatchObject({
      toolCallId: "tool-call-1",
      toolName: "canvas.item.put",
    });
    expect(fixture.tools.executions).toEqual([
      expect.objectContaining({
        callId: "tool-call-1",
        idempotencyKey: "agent-run-1:tool-call-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
    ]);
    const events = await fixture.store.readEvents(result.runId);
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "run.created",
        "run.started",
        "model.completed",
        "tool.started",
        "tool.completed",
        "run.completed",
        "checkpoint.created",
      ]),
    );
    expect(events.map(({ sequence }) => sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
  });

  it("pauses external side effects for approval and resumes the same tool call", async () => {
    const fixture = createRuntime(
      [
        {
          content: "I need to publish this asset.",
          finishReason: "tool-calls",
          toolCalls: [
            {
              id: "publish-1",
              name: "social.publish",
              input: { assetId: "a1" },
            },
          ],
          usage: { inputTokens: 10, outputTokens: 5, creditMicros: "10" },
        },
        {
          content: "Published after approval.",
          finishReason: "stop",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5, creditMicros: "10" },
        },
      ],
      new DefaultAgentPolicy(),
    );
    fixture.tools.definitions.push({
      name: "social.publish",
      description: "Publish an asset",
      inputSchema: { type: "object" },
      requiredPermissions: ["social.publish"],
      sideEffect: "external",
    });
    const input = startInput({
      toolNames: ["canvas.item.put", "social.publish"],
      permissions: ["canvas.write", "social.publish"],
    });
    const ref = await fixture.runtime.start(input);

    await fixture.runtime.resume(ref.runId);
    const waiting = await fixture.runtime.inspect(ref.runId);

    expect(waiting.status).toBe("waiting-approval");
    expect(waiting.pendingApproval).toMatchObject({
      toolCall: { id: "publish-1", name: "social.publish" },
      status: "pending",
    });
    expect(fixture.tools.executions).toHaveLength(0);

    await fixture.runtime.approve(ref.runId, {
      approvalId: waiting.pendingApproval!.approvalId,
      decision: "approved",
      reason: "Approved by the project owner",
    });
    await fixture.runtime.resume(ref.runId);

    expect(await fixture.runtime.inspect(ref.runId)).toMatchObject({
      status: "completed",
      budget: { usage: { toolCalls: 1 } },
    });
    expect(fixture.tools.executions[0]?.callId).toBe("publish-1");
  });

  it("fails closed when a model response exceeds the run budget", async () => {
    const fixture = createRuntime([
      {
        content: "Oversized response",
        finishReason: "stop",
        toolCalls: [],
        usage: { inputTokens: 10_000, outputTokens: 1, creditMicros: "1" },
      },
    ]);
    const input = startInput({
      budget: { ...defaultBudget(), maxInputTokens: 100 },
    });

    const result = await new HeadlessAgentHarness(fixture.runtime).execute(
      input,
    );

    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "input-token-budget-exceeded", retryable: false },
    });
    expect(fixture.tools.executions).toHaveLength(0);
  });

  it("does not persist raw model provider errors", async () => {
    const fixture = createRuntime([]);

    const result = await new HeadlessAgentHarness(fixture.runtime).execute(
      startInput(),
    );
    const events = await fixture.store.readEvents(result.runId);
    const failed = events.find(({ type }) => type === "run.failed");

    expect(result.failure).toEqual({
      code: "model-failed",
      message: "The Agent model provider could not complete this turn.",
      retryable: true,
    });
    expect(failed?.data).toEqual(result.failure);
    expect(JSON.stringify({ result, failed })).not.toContain(
      "Scripted model result is missing.",
    );
  });

  it("reopens a completed run for follow-up while preserving context", async () => {
    const fixture = createRuntime([
      stop("Initial result"),
      stop("Follow-up result"),
    ]);
    const ref = await fixture.runtime.start(startInput());
    await fixture.runtime.resume(ref.runId);
    const message: AgentMessage = {
      id: "follow-up-1",
      role: "user",
      content: "Make it warmer.",
      createdAt: "2026-07-29T00:00:05.000Z",
    };

    await fixture.runtime.followUp(ref.runId, message);
    await fixture.runtime.resume(ref.runId);
    const completed = await fixture.runtime.inspect(ref.runId);

    expect(completed.status).toBe("completed");
    expect(completed.turn).toBe(2);
    expect(completed.context.messages.map(({ content }) => content)).toContain(
      "Make it warmer.",
    );
  });

  it("starts a fresh duration window for follow-up after an idle interval", async () => {
    const fixture = createRuntime([
      stop("Initial result"),
      stop("Follow-up result"),
    ]);
    const ref = await fixture.runtime.start(startInput());
    await fixture.runtime.resume(ref.runId);
    const initial = await fixture.runtime.inspect(ref.runId);
    fixture.clock.advanceSeconds(120);

    await fixture.runtime.followUp(ref.runId, {
      id: "follow-up-after-idle",
      role: "user",
      content: "Make it cooler.",
      createdAt: "2026-07-29T00:02:00.000Z",
    });
    const reopened = await fixture.runtime.inspect(ref.runId);
    await fixture.runtime.resume(ref.runId);
    const completed = await fixture.runtime.inspect(ref.runId);

    expect(reopened.budget.usage.startedAt).not.toBe(
      initial.budget.usage.startedAt,
    );
    expect(completed).toMatchObject({
      status: "completed",
      turn: 2,
      budget: {
        usage: {
          modelCalls: 2,
          inputTokens: 20,
          outputTokens: 10,
          creditMicros: "20",
        },
      },
    });
  });

  it("streams a complete terminal event history from a cursor", async () => {
    const fixture = createRuntime([stop("Done")]);
    const completed = await new HeadlessAgentHarness(fixture.runtime).execute(
      startInput(),
    );
    const events = [];
    for await (const event of fixture.runtime.stream(completed.runId, "1")) {
      events.push(event);
    }

    expect(events[0]?.sequence).toBe(2);
    expect(events.at(-1)?.type).toBe("checkpoint.created");
  });

  it("replays an explicit run id without creating another run", async () => {
    const fixture = createRuntime([stop("Done")]);
    const first = await fixture.runtime.start(startInput());
    await fixture.runtime.resume(first.runId);

    const replay = await fixture.runtime.start(startInput());

    expect(replay).toMatchObject({
      runId: first.runId,
      status: "completed",
    });
    const events = await fixture.store.readEvents(first.runId);
    expect(events.filter(({ type }) => type === "run.created")).toHaveLength(1);
  });
});

class ScriptedModel implements AgentModelPort {
  private index = 0;

  constructor(private readonly results: readonly AgentModelResult[]) {}

  async complete() {
    const result = this.results[this.index];
    this.index += 1;
    if (!result) throw new Error("Scripted model result is missing.");
    return structuredClone(result);
  }
}

class FixtureTools implements AgentToolRegistryPort {
  readonly definitions: AgentToolDefinition[] = [
    {
      name: "canvas.item.put",
      description: "Put an item through the Muses Operation Gateway",
      inputSchema: { type: "object" },
      requiredPermissions: ["canvas.write"],
      sideEffect: "project-write",
    },
  ];
  readonly executions: Array<{
    callId: string;
    idempotencyKey: string;
    workspaceId: string;
    projectId: string;
  }> = [];

  async list(_run: AgentRunSnapshot) {
    return this.definitions;
  }

  async execute(
    call: AgentToolCall,
    context: Parameters<AgentToolRegistryPort["execute"]>[1],
  ) {
    this.executions.push({
      callId: call.id,
      idempotencyKey: context.idempotencyKey,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
    });
    return { toolCallId: call.id, ok: true, output: { accepted: true } };
  }
}

class AllowPolicy implements AgentPolicyPort {
  async authorizeTool() {
    return { outcome: "allow" as const };
  }
}

class FixtureClock implements AgentClockPort {
  private tick = 0;

  now() {
    const value = new Date(Date.UTC(2026, 6, 29, 0, 0, this.tick));
    this.tick += 1;
    return value;
  }

  advanceSeconds(seconds: number) {
    this.tick += seconds;
  }
}

class FixtureIds implements AgentIdPort {
  private sequence = 0;

  create(prefix: Parameters<AgentIdPort["create"]>[0]) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

function createRuntime(
  results: readonly AgentModelResult[],
  policy: AgentPolicyPort = new AllowPolicy(),
) {
  const ids = new FixtureIds();
  const store = new InMemoryAgentStateStore(ids);
  const tools = new FixtureTools();
  const clock = new FixtureClock();
  const runtime = new HeadlessAgentRuntime({
    model: new ScriptedModel(results),
    tools,
    policy,
    store,
    clock,
    ids,
  });
  return { runtime, store, tools, clock };
}

function startInput(
  overrides: {
    toolNames?: string[];
    permissions?: string[];
    budget?: StartAgentRun["budget"];
  } = {},
): StartAgentRun {
  return {
    runId: "agent-run-1",
    session: {
      sessionId: "session-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      canvasId: "canvas-1",
    },
    profile: {
      profileId: "muses-agent",
      version: "0.1.0",
      modelRef: "fixture/model",
      instructions: "Act through Muses tools and report the result.",
      toolNames: overrides.toolNames || ["canvas.item.put"],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    input: "Add the generated image to my canvas.",
    budget: overrides.budget || defaultBudget(),
    permissions: overrides.permissions || ["canvas.write"],
  };
}

function defaultBudget() {
  return {
    maxTurns: 8,
    maxModelCalls: 8,
    maxToolCalls: 8,
    maxInputTokens: 10_000,
    maxOutputTokens: 10_000,
    maxCreditMicros: "1000000",
    maxDurationMs: 60_000,
  };
}

function stop(content: string): AgentModelResult {
  return {
    content,
    finishReason: "stop",
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5, creditMicros: "10" },
  };
}
