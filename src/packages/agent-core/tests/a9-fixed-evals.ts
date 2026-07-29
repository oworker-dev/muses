import {
  AgentModelError,
  AgentRuntimeError,
  DefaultAgentPolicy,
  HeadlessAgentRuntime,
  InMemoryAgentStateStore,
  type AgentClockPort,
  type AgentEvent,
  type AgentIdPort,
  type AgentModelPort,
  type AgentModelResult,
  type AgentPolicyPort,
  type AgentRunSnapshot,
  type AgentStateStorePort,
  type AgentToolCall,
  type AgentToolDefinition,
  type AgentToolRegistryPort,
  type StartAgentRun,
} from "../src";
import {
  A9_FIXED_EVAL_SUITE,
  type A9FixedEvalCase,
} from "./fixtures/a9-fixed-v1";

type EvalScalar = string | number | boolean;
type EvalMetrics = Readonly<Record<string, EvalScalar>>;

export type A9FixedEvalReport = {
  readonly schemaVersion: "muses-agent-eval-result-v1";
  readonly suiteId: typeof A9_FIXED_EVAL_SUITE.suiteId;
  readonly suiteVersion: typeof A9_FIXED_EVAL_SUITE.version;
  readonly fixtureDigest: string;
  readonly runtime: typeof A9_FIXED_EVAL_SUITE.runtime;
  readonly modelFixture: typeof A9_FIXED_EVAL_SUITE.modelFixture;
  readonly status: "passed" | "failed";
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly liveProviderCalls: 0;
  readonly liveNetworkCalls: 0;
  readonly cases: readonly {
    readonly id: A9FixedEvalCase["id"];
    readonly category: A9FixedEvalCase["category"];
    readonly status: "passed" | "failed";
    readonly assertions: readonly string[];
    readonly observed?: EvalMetrics;
    readonly failure?: string;
  }[];
};

const caseRunners: Record<A9FixedEvalCase["id"], () => Promise<EvalMetrics>> = {
  "success-canvas-command": runSuccess,
  "recover-after-driver-retry": runRecovery,
  "refuse-policy-denied-tool": runRefusal,
  "budget-stops-before-model": runBudget,
  "approval-gates-external-tool": runApproval,
  "cancellation-fences-late-model": runCancellation,
  "isolation-rejects-snapshot-drift": runIsolation,
  "unknown-tool-has-no-side-effect": runNoSideEffect,
};

export async function runA9FixedEvals(): Promise<A9FixedEvalReport> {
  const results: A9FixedEvalReport["cases"][number][] = [];
  for (const definition of A9_FIXED_EVAL_SUITE.cases) {
    try {
      const actual = await caseRunners[definition.id]();
      assertExpected(definition, actual);
      results.push({
        id: definition.id,
        category: definition.category,
        status: "passed",
        assertions: Object.keys(definition.expected),
        observed: actual,
      });
    } catch (error) {
      results.push({
        id: definition.id,
        category: definition.category,
        status: "failed",
        assertions: Object.keys(definition.expected),
        failure: sanitizeFailure(error),
      });
    }
  }
  const passed = results.filter(({ status }) => status === "passed").length;
  return {
    schemaVersion: "muses-agent-eval-result-v1",
    suiteId: A9_FIXED_EVAL_SUITE.suiteId,
    suiteVersion: A9_FIXED_EVAL_SUITE.version,
    fixtureDigest: await fixtureDigest(),
    runtime: A9_FIXED_EVAL_SUITE.runtime,
    modelFixture: A9_FIXED_EVAL_SUITE.modelFixture,
    status: passed === results.length ? "passed" : "failed",
    passed,
    failed: results.length - passed,
    total: results.length,
    liveProviderCalls: 0,
    liveNetworkCalls: 0,
    cases: results,
  };
}

async function runSuccess() {
  const fixture = createFixture({
    model: new FixedModel([
      toolResult("canvas.item.put", "put-success"),
      stopResult(),
    ]),
  });
  const runId = "eval-success";
  await fixture.runtime.start(startInput(runId));
  await fixture.runtime.resume(runId);
  const run = await fixture.runtime.inspect(runId);
  const events = await fixture.store.readEvents(runId);
  const execution = fixture.tools.executions[0];
  return {
    status: run.status,
    turns: run.turn,
    modelCalls: run.budget.usage.modelCalls,
    toolCalls: run.budget.usage.toolCalls,
    toolExecutions: fixture.tools.executions.length,
    scopedToVerifiedRun:
      execution?.workspaceId === "workspace-fixed" &&
      execution.projectId === "project-fixed" &&
      execution.runId === runId &&
      execution.idempotencyKey === `${runId}:put-success`,
    terminalCheckpoint: run.checkpoint?.eventSequence === events.length,
  };
}

async function runRecovery() {
  const retryModel: AgentModelPort = {
    estimate: () => zeroEstimate(),
    complete: async () => {
      throw new AgentModelError(
        "model-call-in-progress",
        "The deterministic receipt is still active.",
        true,
        "retry-driver",
      );
    },
  };
  const fixture = createFixture({ model: retryModel });
  const runId = "eval-recovery";
  await fixture.runtime.start(startInput(runId));
  let retryCode = "none";
  try {
    await fixture.runtime.resume(runId);
  } catch (error) {
    retryCode = error instanceof AgentModelError ? error.code : "unexpected";
  }
  const before = await fixture.runtime.inspect(runId);
  const beforeEvents = await fixture.store.readEvents(runId);
  const recovered = new HeadlessAgentRuntime({
    model: new FixedModel([stopResult()]),
    tools: fixture.tools,
    policy: new DefaultAgentPolicy(),
    store: fixture.store,
    clock: fixture.clock,
    ids: fixture.ids,
  });
  await recovered.resume(runId);
  const run = await recovered.inspect(runId);
  return {
    retryCode,
    statusBeforeRecovery: before.status,
    modelEventsBeforeRecovery: countEvents(beforeEvents, "model.completed"),
    status: run.status,
    modelCalls: run.budget.usage.modelCalls,
    toolCalls: run.budget.usage.toolCalls,
    toolExecutions: fixture.tools.executions.length,
  };
}

async function runRefusal() {
  const fixture = createFixture({
    model: new FixedModel([
      toolResult("canvas.item.put", "put-refused"),
      stopResult(),
    ]),
    policy: new DenyPolicy(),
  });
  const runId = "eval-refusal";
  await fixture.runtime.start(startInput(runId));
  await fixture.runtime.resume(runId);
  const run = await fixture.runtime.inspect(runId);
  const events = await fixture.store.readEvents(runId);
  return {
    status: run.status,
    policyDenials: countEvents(events, "tool.denied"),
    toolCalls: run.budget.usage.toolCalls,
    toolExecutions: fixture.tools.executions.length,
  };
}

async function runBudget() {
  const model = new FixedModel([stopResult()], {
    inputTokens: 101,
    outputTokens: 1,
    creditMicros: "1",
  });
  const fixture = createFixture({ model });
  const runId = "eval-budget";
  await fixture.runtime.start(
    startInput(runId, {
      budget: { ...defaultBudget(), maxInputTokens: 100 },
    }),
  );
  await fixture.runtime.resume(runId);
  const run = await fixture.runtime.inspect(runId);
  return {
    status: run.status,
    failureCode: run.failure?.code || "none",
    modelCompletions: model.completeCalls,
    modelCalls: run.budget.usage.modelCalls,
    toolCalls: run.budget.usage.toolCalls,
    creditMicros: run.budget.usage.creditMicros,
    toolExecutions: fixture.tools.executions.length,
  };
}

async function runApproval() {
  const externalTool: AgentToolDefinition = {
    name: "fixture.external",
    description: "A deterministic external-effect fixture.",
    inputSchema: { type: "object" },
    requiredPermissions: ["fixture.external"],
    sideEffect: "external",
  };
  const fixture = createFixture({
    model: new FixedModel([
      toolResult("fixture.external", "external-approved"),
      stopResult(),
    ]),
    tools: new FixedTools([externalTool]),
  });
  const runId = "eval-approval";
  await fixture.runtime.start(
    startInput(runId, {
      toolNames: ["fixture.external"],
      permissions: ["fixture.external"],
    }),
  );
  await fixture.runtime.resume(runId);
  const waiting = await fixture.runtime.inspect(runId);
  const decision = {
    approvalId: waiting.pendingApproval?.approvalId || "missing",
    decision: "approved" as const,
    reason: "A9 deterministic approval.",
    decidedBy: { kind: "user" as const, actorId: "user-fixed" },
  };
  const executionsBeforeApproval = fixture.tools.executions.length;
  await fixture.runtime.approve(runId, decision);
  await fixture.runtime.approve(runId, decision);
  await fixture.runtime.resume(runId);
  const run = await fixture.runtime.inspect(runId);
  const events = await fixture.store.readEvents(runId);
  return {
    waitingStatus: waiting.status,
    executionsBeforeApproval,
    status: run.status,
    approvalRequests: countEvents(events, "approval.requested"),
    approvalDecisions: countEvents(events, "approval.decided"),
    toolCalls: run.budget.usage.toolCalls,
    toolExecutions: fixture.tools.executions.length,
  };
}

async function runCancellation() {
  const model = new DeferredModel();
  const fixture = createFixture({ model });
  const runId = "eval-cancellation";
  await fixture.runtime.start(startInput(runId));
  const driving = fixture.runtime.resume(runId);
  await waitForStatus(fixture.runtime, runId, "running");
  const cancellingRuntime = new HeadlessAgentRuntime({
    model,
    tools: fixture.tools,
    policy: new DefaultAgentPolicy(),
    store: fixture.store,
    clock: fixture.clock,
    ids: fixture.ids,
  });
  await cancellingRuntime.cancel(runId, "A9 deterministic cancellation.");
  model.release(stopResult());
  let lateResultError = "none";
  try {
    await driving;
  } catch (error) {
    lateResultError =
      error instanceof AgentRuntimeError ? error.code : "unexpected";
  }
  const run = await fixture.runtime.inspect(runId);
  const events = await fixture.store.readEvents(runId);
  return {
    lateResultError,
    status: run.status,
    turns: run.turn,
    modelCalls: run.budget.usage.modelCalls,
    modelEvents: countEvents(events, "model.completed"),
    cancellationEvents: countEvents(events, "run.cancelled"),
    toolExecutions: fixture.tools.executions.length,
  };
}

async function runIsolation() {
  const model = new FixedModel([stopResult()]);
  const baseStore = new InMemoryAgentStateStore(
    new FixedIds("isolation-store"),
  );
  const store = new TamperableStore(baseStore);
  const fixture = createFixture({ model, store });
  const runId = "eval-isolation";
  await fixture.runtime.start(startInput(runId));
  const pinned = await fixture.runtime.inspect(runId);
  await store.tamper(runId, (run) => ({
    ...run,
    extensions: run.extensions
      ? {
          ...run.extensions,
          logicalSandbox: {
            ...run.extensions.logicalSandbox,
            scope: {
              ...run.extensions.logicalSandbox.scope,
              workspaceId: "workspace-forged",
            },
          },
        }
      : undefined,
  }));
  let driftError = "none";
  try {
    await fixture.runtime.inspect(runId);
  } catch (error) {
    driftError = error instanceof AgentRuntimeError ? error.code : "unexpected";
  }
  return {
    snapshotState: pinned.extensions ? "pinned" : "missing",
    networkDefault: pinned.extensions?.logicalSandbox.network.default || "none",
    filesystemNamespace:
      pinned.extensions?.logicalSandbox.filesystem.namespace || "none",
    driftError,
    modelCompletions: model.completeCalls,
    toolExecutions: fixture.tools.executions.length,
  };
}

async function runNoSideEffect() {
  const fixture = createFixture({
    model: new FixedModel([
      toolResult("admin.models.delete", "unknown-tool"),
      stopResult(),
    ]),
  });
  const runId = "eval-no-side-effect";
  await fixture.runtime.start(startInput(runId));
  await fixture.runtime.resume(runId);
  const run = await fixture.runtime.inspect(runId);
  const events = await fixture.store.readEvents(runId);
  return {
    status: run.status,
    toolDenials: countEvents(events, "tool.denied"),
    toolCalls: run.budget.usage.toolCalls,
    toolExecutions: fixture.tools.executions.length,
  };
}

function createFixture(input: {
  model: AgentModelPort;
  policy?: AgentPolicyPort;
  tools?: FixedTools;
  store?: AgentStateStorePort;
}) {
  const ids = new FixedIds("runtime");
  const clock = new FixedClock();
  const store = input.store || new InMemoryAgentStateStore(ids);
  const tools = input.tools || new FixedTools([canvasTool()]);
  return {
    runtime: new HeadlessAgentRuntime({
      model: input.model,
      tools,
      policy: input.policy || new DefaultAgentPolicy(),
      store,
      clock,
      ids,
    }),
    store,
    tools,
    clock,
    ids,
  };
}

function startInput(
  runId: string,
  overrides: {
    toolNames?: readonly string[];
    permissions?: readonly string[];
    budget?: StartAgentRun["budget"];
  } = {},
): StartAgentRun {
  return {
    runId,
    session: {
      sessionId: `session-${runId}`,
      workspaceId: "workspace-fixed",
      projectId: "project-fixed",
      canvasId: "canvas-fixed",
    },
    profile: {
      profileId: "muses-fixed-eval",
      version: A9_FIXED_EVAL_SUITE.version,
      modelRef: A9_FIXED_EVAL_SUITE.modelFixture,
      instructions: "Execute only the deterministic A9 fixture.",
      toolNames: overrides.toolNames || ["canvas.item.put"],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    input: "Run the sanitized deterministic fixture.",
    budget: overrides.budget || defaultBudget(),
    permissions: overrides.permissions || ["canvas.write"],
    metadata: { fixture: A9_FIXED_EVAL_SUITE.suiteId },
  };
}

function defaultBudget() {
  return {
    maxTurns: 8,
    maxModelCalls: 8,
    maxToolCalls: 8,
    maxInputTokens: 1_000,
    maxOutputTokens: 1_000,
    maxCreditMicros: "1000",
    maxDurationMs: 60_000,
  };
}

class FixedModel implements AgentModelPort {
  private index = 0;
  completeCalls = 0;

  constructor(
    private readonly results: readonly AgentModelResult[],
    private readonly estimatedUsage = zeroEstimate(),
  ) {}

  estimate() {
    return structuredClone(this.estimatedUsage);
  }

  async complete() {
    this.completeCalls += 1;
    const result = this.results[this.index];
    this.index += 1;
    if (!result) throw new Error("Deterministic model result is missing.");
    return structuredClone(result);
  }
}

class DeferredModel implements AgentModelPort {
  private resolve!: (result: AgentModelResult) => void;
  private readonly pending = new Promise<AgentModelResult>((resolve) => {
    this.resolve = resolve;
  });

  estimate() {
    return zeroEstimate();
  }

  complete() {
    return this.pending;
  }

  release(result: AgentModelResult) {
    this.resolve(structuredClone(result));
  }
}

class FixedTools implements AgentToolRegistryPort {
  readonly executions: Array<{
    callId: string;
    workspaceId: string;
    projectId: string;
    runId: string;
    idempotencyKey: string;
  }> = [];

  constructor(private readonly definitions: readonly AgentToolDefinition[]) {}

  async list() {
    return this.definitions;
  }

  async execute(
    call: AgentToolCall,
    context: Parameters<AgentToolRegistryPort["execute"]>[1],
  ) {
    this.executions.push({
      callId: call.id,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      runId: context.runId,
      idempotencyKey: context.idempotencyKey,
    });
    return {
      toolCallId: call.id,
      ok: true as const,
      output: { accepted: true },
    };
  }
}

class DenyPolicy implements AgentPolicyPort {
  async authorizeTool() {
    return { outcome: "deny" as const, reason: "A9 deterministic refusal." };
  }
}

class FixedClock implements AgentClockPort {
  private tick = 0;

  now() {
    const value = new Date(Date.UTC(2026, 6, 29, 0, 0, this.tick));
    this.tick += 1;
    return value;
  }
}

class FixedIds implements AgentIdPort {
  private sequence = 0;

  constructor(private readonly namespace: string) {}

  create(prefix: Parameters<AgentIdPort["create"]>[0]) {
    this.sequence += 1;
    return `${prefix}-${this.namespace}-${this.sequence}`;
  }
}

class TamperableStore implements AgentStateStorePort {
  private readonly overrides = new Map<string, AgentRunSnapshot>();

  constructor(private readonly base: AgentStateStorePort) {}

  create(...args: Parameters<AgentStateStorePort["create"]>) {
    return this.base.create(...args);
  }

  async read(runId: string) {
    return structuredClone(
      this.overrides.get(runId) || (await this.base.read(runId)),
    );
  }

  commit(...args: Parameters<AgentStateStorePort["commit"]>) {
    return this.base.commit(...args);
  }

  readEvents(...args: Parameters<AgentStateStorePort["readEvents"]>) {
    return this.base.readEvents(...args);
  }

  stream(...args: Parameters<AgentStateStorePort["stream"]>) {
    return this.base.stream(...args);
  }

  async tamper(
    runId: string,
    change: (run: AgentRunSnapshot) => AgentRunSnapshot,
  ) {
    const run = await this.base.read(runId);
    if (!run) throw new Error("The isolation fixture Run is missing.");
    this.overrides.set(runId, structuredClone(change(run)));
  }
}

function canvasTool(): AgentToolDefinition {
  return {
    name: "canvas.item.put",
    description: "A deterministic canvas command fixture.",
    inputSchema: { type: "object" },
    requiredPermissions: ["canvas.write"],
    sideEffect: "project-write",
  };
}

function toolResult(name: string, id: string): AgentModelResult {
  return {
    content: "Deterministic tool request.",
    finishReason: "tool-calls",
    toolCalls: [{ id, name, input: { fixture: true } }],
    usage: { inputTokens: 10, outputTokens: 5, creditMicros: "10" },
  };
}

function stopResult(): AgentModelResult {
  return {
    content: "Deterministic completion.",
    finishReason: "stop",
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5, creditMicros: "10" },
  };
}

function zeroEstimate() {
  return { inputTokens: 0, outputTokens: 0, creditMicros: "0" };
}

function countEvents(events: readonly AgentEvent[], type: AgentEvent["type"]) {
  return events.filter((event) => event.type === type).length;
}

async function waitForStatus(
  runtime: HeadlessAgentRuntime,
  runId: string,
  status: AgentRunSnapshot["status"],
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await runtime.inspect(runId)).status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`The fixed eval Run did not reach ${status}.`);
}

function assertExpected(definition: A9FixedEvalCase, actual: EvalMetrics) {
  for (const [key, expected] of Object.entries(definition.expected)) {
    if (actual[key] !== expected) {
      throw new Error(
        `${definition.id}.${key} expected ${String(expected)} but received ${String(actual[key])}.`,
      );
    }
  }
}

function sanitizeFailure(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown eval failure.";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

async function fixtureDigest() {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(A9_FIXED_EVAL_SUITE)),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
