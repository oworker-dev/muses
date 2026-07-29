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
import {
  A10_FIXED_EVAL_SUITE,
  type A10FixedEvalCase,
} from "./fixtures/a10-fixed-v1";

type EvalScalar = string | number | boolean;
type EvalMetrics = Readonly<Record<string, EvalScalar>>;

export type A10FixedEvalReport = {
  readonly schemaVersion: "muses-agent-eval-result-v1";
  readonly suiteId: typeof A10_FIXED_EVAL_SUITE.suiteId;
  readonly suiteVersion: typeof A10_FIXED_EVAL_SUITE.version;
  readonly fixtureDigest: string;
  readonly runtime: typeof A10_FIXED_EVAL_SUITE.runtime;
  readonly childRuntimeFixture: typeof A10_FIXED_EVAL_SUITE.childRuntimeFixture;
  readonly status: "passed" | "failed";
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly liveProviderCalls: 0;
  readonly liveNetworkCalls: 0;
  readonly cases: readonly {
    readonly id: A10FixedEvalCase["id"];
    readonly category: A10FixedEvalCase["category"];
    readonly status: "passed" | "failed";
    readonly assertions: readonly string[];
    readonly observed?: EvalMetrics;
    readonly failure?: string;
  }[];
};

const caseRunners: Record<A10FixedEvalCase["id"], () => Promise<EvalMetrics>> =
  {
    "parallel-dag-aggregates": runParallelDag,
    "restart-reclaims-expired-lease": runLeaseRecovery,
    "receipt-survives-budget-outage": runReceiptRecovery,
    "isolate-preserves-independent-branch": runIsolation,
    "fail-fast-cancels-running-sibling": runFailFast,
    "ambiguous-cost-requires-review": runBillingReview,
  };

export async function runA10FixedEvals(): Promise<A10FixedEvalReport> {
  const results: A10FixedEvalReport["cases"][number][] = [];
  for (const definition of A10_FIXED_EVAL_SUITE.cases) {
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
    suiteId: A10_FIXED_EVAL_SUITE.suiteId,
    suiteVersion: A10_FIXED_EVAL_SUITE.version,
    fixtureDigest: await fixtureDigest(),
    runtime: A10_FIXED_EVAL_SUITE.runtime,
    childRuntimeFixture: A10_FIXED_EVAL_SUITE.childRuntimeFixture,
    status: passed === results.length ? "passed" : "failed",
    passed,
    failed: results.length - passed,
    total: results.length,
    liveProviderCalls: 0,
    liveNetworkCalls: 0,
    cases: results,
  };
}

async function runParallelDag() {
  const fixture = schedulerFixture();
  const submitted = await fixture.scheduler().submit({
    plan: delegationPlan(
      [
        delegatedTask("research"),
        delegatedTask("render"),
        delegatedTask("qa", ["research", "render"]),
      ],
      { maxConcurrency: 2 },
    ),
    authority: delegationAuthority(),
    idempotencyKey: "eval-parallel-submit",
  });
  const completed = await fixture
    .scheduler()
    .resume(submitted.run.delegationRunId);
  const events = await fixture.store.readEvents(completed.delegationRunId);
  return {
    status: completed.status,
    completedTasks: countTasks(completed.tasks, "completed"),
    childStarts: fixture.children.starts.length,
    uniqueChildRuns: new Set(
      fixture.children.starts.map(({ childRunId }) => childRunId),
    ).size,
    envelopeSettles: fixture.budget.count("envelope:settle:"),
    taskSettles: fixture.budget.count("task:settle:"),
    terminalEvent: events.at(-1)?.type || "missing",
  };
}

async function runLeaseRecovery() {
  const fixture = schedulerFixture({ profileFailures: 1 });
  const firstScheduler = fixture.scheduler();
  const submitted = await firstScheduler.submit({
    plan: delegationPlan(),
    authority: delegationAuthority(),
    idempotencyKey: "eval-lease-submit",
  });
  let firstFailure = "none";
  try {
    await firstScheduler.resume(submitted.run.delegationRunId);
  } catch (error) {
    firstFailure = failureKind(error, {
      "profile registry unavailable": "profile-registry-unavailable",
    });
  }
  const beforeRestart = await firstScheduler.inspect(
    submitted.run.delegationRunId,
  );
  fixture.clock.advance(31_000);
  const recovered = await fixture
    .scheduler()
    .resume(submitted.run.delegationRunId);
  const events = await fixture.store.readEvents(recovered.delegationRunId);
  const claims = events.filter(({ type }) => type === "task.claimed");
  return {
    firstFailure,
    statusBeforeRestart: beforeRestart.status,
    status: recovered.status,
    claimEvents: claims.length,
    recoveredClaims: claims.filter(({ data }) => data.recovered === true)
      .length,
    childStarts: fixture.children.starts.length,
  };
}

async function runReceiptRecovery() {
  const fixture = schedulerFixture({ taskReservationFailures: 1 });
  const firstScheduler = fixture.scheduler();
  const submitted = await firstScheduler.submit({
    plan: delegationPlan(),
    authority: delegationAuthority(),
    idempotencyKey: "eval-receipt-submit",
  });
  let firstFailure = "none";
  try {
    await firstScheduler.resume(submitted.run.delegationRunId);
  } catch (error) {
    firstFailure = failureKind(error, {
      "task reservation unavailable": "task-reservation-unavailable",
    });
  }
  const prepared = await firstScheduler.inspect(submitted.run.delegationRunId);
  const childRunId = prepared.tasks[0]?.childRunId;
  const completed = await fixture
    .scheduler()
    .resume(submitted.run.delegationRunId);
  const events = await fixture.store.readEvents(completed.delegationRunId);
  return {
    firstFailure,
    preparedChildIdentity: Boolean(childRunId),
    status: completed.status,
    childSubmissionEvents: events.filter(
      ({ type }) => type === "task.child-submitted",
    ).length,
    childStarts: fixture.children.starts.length,
    childIdentityStable: completed.tasks[0]?.childRunId === childRunId,
  };
}

async function runIsolation() {
  const fixture = schedulerFixture({
    childOutcomes: { research: failedChild("provider-rejected") },
  });
  const submitted = await fixture.scheduler().submit({
    plan: delegationPlan(
      [
        delegatedTask("research"),
        delegatedTask("independent"),
        delegatedTask("render", ["research"]),
      ],
      { maxConcurrency: 2, failureMode: "isolate" },
    ),
    authority: delegationAuthority(),
    idempotencyKey: "eval-isolate-submit",
  });
  const completed = await fixture
    .scheduler()
    .resume(submitted.run.delegationRunId);
  return {
    status: completed.status,
    failedTasks: countTasks(completed.tasks, "failed"),
    completedTasks: countTasks(completed.tasks, "completed"),
    blockedTasks: countTasks(completed.tasks, "blocked"),
    blockedChildStarts: fixture.children.starts.filter(
      ({ taskId }) => taskId === "render",
    ).length,
  };
}

async function runFailFast() {
  const fixture = schedulerFixture({
    childOutcomes: {
      long: runningChild(),
      required: failedChild("required-failed"),
    },
  });
  const submitted = await fixture.scheduler().submit({
    plan: delegationPlan([delegatedTask("long"), delegatedTask("required")], {
      maxConcurrency: 2,
      failureMode: "fail-fast",
    }),
    authority: delegationAuthority(),
    idempotencyKey: "eval-fail-fast-submit",
  });
  const failed = await fixture
    .scheduler()
    .resume(submitted.run.delegationRunId);
  const events = await fixture.store.readEvents(failed.delegationRunId);
  return {
    status: failed.status,
    failureCode: failed.failure?.code || "missing",
    cancelledTasks: countTasks(failed.tasks, "cancelled"),
    childCancellations: fixture.children.cancellations.length,
    taskCancelEvents: events.filter(({ type }) => type === "task.cancelled")
      .length,
  };
}

async function runBillingReview() {
  const fixture = schedulerFixture({
    childOutcomes: { research: reviewChild("research") },
  });
  const submitted = await fixture.scheduler().submit({
    plan: delegationPlan(),
    authority: delegationAuthority(),
    idempotencyKey: "eval-review-submit",
  });
  const completed = await fixture
    .scheduler()
    .resume(submitted.run.delegationRunId);
  const finalizations = fixture.budget.calls.filter(
    (operation) =>
      operation.startsWith("task:review:") ||
      operation.startsWith("envelope:review:"),
  );
  return {
    status: completed.status,
    taskBudgetStatus:
      completed.tasks[0]?.budgetReservation?.status || "missing",
    envelopeBudgetStatus: completed.budgetReservation.status,
    taskReviews: fixture.budget.count("task:review:"),
    envelopeReviews: fixture.budget.count("envelope:review:"),
    duplicateFinalizations: finalizations.length - new Set(finalizations).size,
  };
}

function schedulerFixture(
  options: {
    profileFailures?: number;
    taskReservationFailures?: number;
    childOutcomes?: Record<string, AgentDelegationChildSnapshot>;
  } = {},
) {
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
      return profile();
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
            message: "Required deterministic evidence is missing.",
          };
    },
  };
  const fingerprints: AgentDelegationFingerprintPort = {
    fingerprint: (value) => JSON.stringify(value),
  };
  return {
    store,
    budget,
    children,
    clock,
    scheduler: () =>
      new DefaultAgentDelegationScheduler({
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
  readonly calls: string[] = [];
  private readonly completed = new Set<string>();

  constructor(private taskReservationFailures: number) {}

  async reserveEnvelope(
    input: Parameters<AgentDelegationBudgetPort["reserveEnvelope"]>[0],
  ) {
    this.record(`envelope:reserve:${input.reservationId}`);
  }

  async reserveTask(
    input: Parameters<AgentDelegationBudgetPort["reserveTask"]>[0],
  ) {
    if (this.taskReservationFailures > 0) {
      this.taskReservationFailures -= 1;
      throw new Error("task reservation unavailable");
    }
    this.record(`task:reserve:${input.reservationId}`);
  }

  async finalizeTask(
    input: Parameters<AgentDelegationBudgetPort["finalizeTask"]>[0],
  ) {
    this.record(`task:${input.outcome}:${input.reservationId}`);
  }

  async finalizeEnvelope(
    input: Parameters<AgentDelegationBudgetPort["finalizeEnvelope"]>[0],
  ) {
    this.record(`envelope:${input.outcome}:${input.reservationId}`);
  }

  count(prefix: string) {
    return this.calls.filter((operation) => operation.startsWith(prefix))
      .length;
  }

  private record(operation: string) {
    this.calls.push(operation);
    if (this.completed.has(operation)) return;
    this.completed.add(operation);
  }
}

class FixtureChildren implements AgentDelegationChildRuntimePort {
  readonly starts: Array<{ childRunId: string; taskId: string }> = [];
  readonly cancellations: Array<{ childRunId: string; reason: string }> = [];
  private readonly snapshots = new Map<string, AgentDelegationChildSnapshot>();

  constructor(
    private readonly outcomes: Record<string, AgentDelegationChildSnapshot>,
  ) {}

  async start(input: Parameters<AgentDelegationChildRuntimePort["start"]>[0]) {
    const existing = this.snapshots.get(input.childRunId);
    if (existing) return existing;
    this.starts.push({ childRunId: input.childRunId, taskId: input.taskId });
    const configured = this.outcomes[input.taskId];
    const snapshot = configured
      ? {
          ...configured,
          childRunId: input.childRunId,
          childSandboxId: `sandbox:${input.childRunId}`,
        }
      : completedChild(input.childRunId, input.taskId);
    this.snapshots.set(input.childRunId, snapshot);
    return snapshot;
  }

  async inspect(childRunId: string) {
    const snapshot = this.snapshots.get(childRunId);
    if (!snapshot) throw new Error("Deterministic child Run is missing.");
    return snapshot;
  }

  async cancel(
    input: Parameters<AgentDelegationChildRuntimePort["cancel"]>[0],
  ) {
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
}

class FixedClock implements AgentClockPort {
  private timestamp = Date.parse("2026-07-30T00:00:00.000Z");

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
    return `${prefix}-a10-eval-${this.sequence}`;
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
      data: { taskId, state: "completed" },
      artifactRefs: [`artifact:${taskId}`],
      evidence: [{ kind: "artifact", ref: `artifact:${taskId}` }],
    },
    usage: usage(),
    costOutcome: "known",
  };
}

function reviewChild(taskId: string): AgentDelegationChildSnapshot {
  return {
    ...completedChild("replaced-by-fixture", taskId),
    costOutcome: "unknown",
  };
}

function runningChild(): AgentDelegationChildSnapshot {
  return {
    childRunId: "replaced-by-fixture",
    childSandboxId: "replaced-by-fixture",
    status: "running",
  };
}

function failedChild(code: string): AgentDelegationChildSnapshot {
  return {
    childRunId: "replaced-by-fixture",
    childSandboxId: "replaced-by-fixture",
    status: "failed",
    costOutcome: "known",
    failure: { code, message: code, retryable: false },
  };
}

function profile(): AgentProfileSnapshot {
  return {
    profileId: "image-specialist",
    version: A10_FIXED_EVAL_SUITE.version,
    modelRef: A10_FIXED_EVAL_SUITE.childRuntimeFixture,
    instructions: "Complete only the deterministic delegated fixture.",
    toolNames: ["image.generate"],
    skillRefs: ["image-direction@1.0.0"],
    mcpConnectionRefs: ["asset-search@1.0.0"],
  };
}

function delegationPlan(
  tasks: readonly AgentDelegationTask[] = [delegatedTask("research")],
  overrides: Partial<AgentDelegationPlan> = {},
): AgentDelegationPlan {
  return {
    schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
    planId: "a10-fixed-plan",
    revision: 0,
    workspaceId: "workspace-fixed",
    projectId: "project-fixed",
    sessionId: "session-fixed",
    rootRunId: "run-root-fixed",
    delegatedByRunId: "run-root-fixed",
    maxConcurrency: 1,
    failureMode: "isolate",
    tasks,
    createdAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

function delegatedTask(
  taskId: string,
  dependsOn: readonly string[] = [],
): AgentDelegationTask {
  return {
    taskId,
    objective: `Complete deterministic task ${taskId}.`,
    profile: {
      profileId: "image-specialist",
      version: A10_FIXED_EVAL_SUITE.version,
    },
    dependsOn,
    context: {
      sourceRunId: "run-root-fixed",
      sourceContextVersion: 2,
      facts: [
        {
          key: "brief",
          value: "Sanitized deterministic campaign fixture.",
          classification: "workspace",
        },
      ],
      artifactRefs: ["artifact:brief-fixed"],
    },
    grant: {
      permissions: ["image.generate"],
      toolNames: ["image.generate"],
      skillRefs: ["image-direction@1.0.0"],
      mcpConnectionRefs: ["asset-search@1.0.0"],
      computeCapabilities: ["media-processing"],
    },
    budget: taskBudget(),
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
    workspaceId: "workspace-fixed",
    projectId: "project-fixed",
    sessionId: "session-fixed",
    rootRunId: "run-root-fixed",
    delegatedByRunId: "run-root-fixed",
    sourceContextVersion: 2,
    currentDepth: 0,
    policy: {
      maxDepth: 3,
      maxTasks: 8,
      maxConcurrency: 4,
      maxContextCharactersPerTask: 2_000,
      maxResultBytesPerTask: 16_384,
    },
    delegablePermissions: ["image.generate"],
    delegableToolNames: ["image.generate"],
    delegableSkillRefs: ["image-direction@1.0.0"],
    delegableMcpConnectionRefs: ["asset-search@1.0.0"],
    delegableComputeCapabilities: ["media-processing"],
    delegableContextClassifications: ["workspace"],
    delegableArtifactRefs: ["artifact:brief-fixed"],
    remainingBudget: {
      maxTurns: 20,
      maxModelCalls: 20,
      maxToolCalls: 20,
      maxInputTokens: 20_000,
      maxOutputTokens: 10_000,
      maxCreditMicros: "10000",
      maxDurationMs: 120_000,
    },
  };
}

function taskBudget() {
  return {
    maxTurns: 2,
    maxModelCalls: 2,
    maxToolCalls: 2,
    maxInputTokens: 1_000,
    maxOutputTokens: 500,
    maxCreditMicros: "100",
    maxDurationMs: 10_000,
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
    startedAt: "2026-07-30T00:00:00.000Z",
  };
}

function countTasks(tasks: readonly { status: string }[], status: string) {
  return tasks.filter((task) => task.status === status).length;
}

function failureKind(error: unknown, known: Readonly<Record<string, string>>) {
  if (!(error instanceof Error)) return "unexpected";
  return known[error.message] || "unexpected";
}

function assertExpected(definition: A10FixedEvalCase, actual: EvalMetrics) {
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
    new TextEncoder().encode(JSON.stringify(A10_FIXED_EVAL_SUITE)),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
