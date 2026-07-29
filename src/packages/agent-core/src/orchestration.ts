import type {
  AgentBudgetLimit,
  AgentBudgetUsage,
  AgentProfileSnapshot,
  AgentRunParentRef,
} from "./contracts";

export const AGENT_DELEGATION_SCHEMA_VERSION = "0.1.0-draft" as const;

export type AgentDelegationComputeCapability =
  | "code"
  | "cli"
  | "browser"
  | "untrusted-file"
  | "media-processing";

export type AgentDelegationContextFact = {
  readonly key: string;
  readonly value: string;
  readonly classification: "public" | "workspace" | "restricted";
};

export type AgentDelegationContextPackage = {
  readonly sourceRunId: string;
  readonly sourceContextVersion: number;
  readonly facts: readonly AgentDelegationContextFact[];
  readonly artifactRefs: readonly string[];
};

export type AgentDelegationGrant = {
  readonly permissions: readonly string[];
  readonly toolNames: readonly string[];
  readonly skillRefs: readonly string[];
  readonly mcpConnectionRefs: readonly string[];
  readonly computeCapabilities: readonly AgentDelegationComputeCapability[];
};

export type AgentDelegationTask = {
  readonly taskId: string;
  readonly objective: string;
  readonly profile: {
    readonly profileId: string;
    readonly version: string;
  };
  readonly dependsOn: readonly string[];
  readonly context: AgentDelegationContextPackage;
  readonly grant: AgentDelegationGrant;
  readonly budget: AgentBudgetLimit;
  readonly result: {
    readonly outputSchema: Readonly<Record<string, unknown>>;
    readonly maxBytes: number;
    readonly requiredEvidenceKinds: readonly string[];
  };
};

export type AgentDelegationPlan = {
  readonly schemaVersion: typeof AGENT_DELEGATION_SCHEMA_VERSION;
  readonly planId: string;
  readonly revision: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly rootRunId: string;
  readonly delegatedByRunId: string;
  readonly maxConcurrency: number;
  readonly failureMode: "fail-fast" | "isolate";
  readonly tasks: readonly AgentDelegationTask[];
  readonly createdAt: string;
};

export type AgentDelegationPolicySnapshot = {
  readonly maxDepth: number;
  readonly maxTasks: number;
  readonly maxConcurrency: number;
  readonly maxContextCharactersPerTask: number;
  readonly maxResultBytesPerTask: number;
};

export type AgentDelegationAuthoritySnapshot = {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly rootRunId: string;
  readonly delegatedByRunId: string;
  readonly sourceContextVersion: number;
  readonly currentDepth: number;
  readonly policy: AgentDelegationPolicySnapshot;
  readonly delegablePermissions: readonly string[];
  readonly delegableToolNames: readonly string[];
  readonly delegableSkillRefs: readonly string[];
  readonly delegableMcpConnectionRefs: readonly string[];
  readonly delegableComputeCapabilities: readonly AgentDelegationComputeCapability[];
  readonly delegableContextClassifications: readonly AgentDelegationContextFact["classification"][];
  readonly delegableArtifactRefs: readonly string[];
  readonly remainingBudget: AgentBudgetLimit;
};

export type AgentDelegationBudgetEnvelope = AgentBudgetLimit;

export type AgentDelegationProfileRegistryPort = {
  resolve(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly profileId: string;
    readonly version: string;
  }): Promise<AgentProfileSnapshot | null>;
};

export type AgentDelegationValidationIssue = {
  readonly code:
    | "identity-required"
    | "plan-invalid"
    | "policy-invalid"
    | "authority-invalid"
    | "scope-mismatch"
    | "depth-exceeded"
    | "task-limit-exceeded"
    | "concurrency-invalid"
    | "duplicate-task"
    | "dependency-invalid"
    | "dependency-cycle"
    | "context-invalid"
    | "context-not-granted"
    | "permission-not-granted"
    | "tool-not-granted"
    | "skill-not-granted"
    | "mcp-not-granted"
    | "compute-not-granted"
    | "budget-invalid"
    | "budget-exceeded"
    | "result-contract-invalid";
  readonly path: string;
  readonly message: string;
};

export type AgentDelegationValidation =
  | {
      readonly ok: true;
      readonly nextDepth: number;
      readonly topologicalOrder: readonly string[];
      readonly budgetEnvelope: AgentDelegationBudgetEnvelope;
    }
  | {
      readonly ok: false;
      readonly issues: readonly AgentDelegationValidationIssue[];
    };

export type AgentDelegationTaskStatus =
  | "pending"
  | "ready"
  | "claimed"
  | "running"
  | "waiting-approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type AgentDelegationEvidence = {
  readonly kind: string;
  readonly ref: string;
};

export type AgentDelegationTaskResult = {
  readonly data: unknown;
  readonly artifactRefs: readonly string[];
  readonly evidence: readonly AgentDelegationEvidence[];
};

export type AgentDelegationBudgetReservationStatus =
  | "pending"
  | "reserved"
  | "settled"
  | "released"
  | "review-required";

export type AgentDelegationTaskRun = {
  readonly taskId: string;
  readonly status: AgentDelegationTaskStatus;
  readonly claim?: {
    readonly attemptId: string;
    readonly leaseExpiresAt: string;
  };
  readonly childRunId?: string;
  readonly childSandboxId?: string;
  readonly profileSnapshot?: AgentProfileSnapshot;
  readonly budgetReservation?: {
    readonly reservationId: string;
    readonly status: AgentDelegationBudgetReservationStatus;
    readonly updatedAt: string;
  };
  readonly childSubmission?: AgentDelegationChildSubmissionReceipt;
  readonly result?: AgentDelegationTaskResult;
  readonly usage?: AgentBudgetUsage;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
};

export type AgentDelegationChildSubmissionReceipt = {
  readonly receiptId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly childRunId: string;
  readonly idempotencyKey: string;
  readonly budgetReservationId: string;
  readonly submittedAt: string;
};

export type AgentDelegationSubmissionReceipt = {
  readonly receiptId: string;
  readonly delegationRunId: string;
  readonly idempotencyKey: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly planFingerprint: string;
  readonly authorityFingerprint: string;
  readonly submittedAt: string;
};

export type AgentDelegationRunSnapshot = {
  readonly schemaVersion: typeof AGENT_DELEGATION_SCHEMA_VERSION;
  readonly delegationRunId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly rootRunId: string;
  readonly parentRunId: string;
  readonly authorityFingerprint: string;
  readonly status:
    | "queued"
    | "running"
    | "cancelling"
    | "completed"
    | "completed-with-failures"
    | "failed"
    | "cancelled";
  readonly revision: number;
  readonly maxConcurrency: number;
  readonly failureMode: AgentDelegationPlan["failureMode"];
  readonly budgetEnvelope: AgentDelegationBudgetEnvelope;
  readonly budgetReservation: {
    readonly reservationId: string;
    readonly status: AgentDelegationBudgetReservationStatus;
    readonly updatedAt: string;
  };
  readonly cancellation?: AgentDelegationCancellationReceipt;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
    readonly taskId?: string;
  };
  readonly tasks: readonly AgentDelegationTaskRun[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type AgentDelegationCancellationReceipt = {
  readonly receiptId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly requestedAt: string;
};

export type AgentDelegationEventType =
  | "delegation.submitted"
  | "delegation.budget-reserved"
  | "delegation.cancellation-requested"
  | "delegation.completed"
  | "delegation.completed-with-failures"
  | "delegation.failed"
  | "delegation.cancelled"
  | "task.ready"
  | "task.claimed"
  | "task.child-submitted"
  | "task.running"
  | "task.completed"
  | "task.failed"
  | "task.blocked"
  | "task.cancelled";

export type AgentDelegationEvent = {
  readonly schemaVersion: typeof AGENT_DELEGATION_SCHEMA_VERSION;
  readonly eventId: string;
  readonly delegationRunId: string;
  readonly sequence: number;
  readonly type: AgentDelegationEventType;
  readonly createdAt: string;
  readonly data: Readonly<Record<string, unknown>>;
};

export type AgentDelegationEventDraft = Omit<
  AgentDelegationEvent,
  "eventId" | "sequence"
>;

export type AgentDelegationSchedulerPort = {
  submit(input: {
    readonly plan: AgentDelegationPlan;
    readonly authority: AgentDelegationAuthoritySnapshot;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly receipt: AgentDelegationSubmissionReceipt;
    readonly run: AgentDelegationRunSnapshot;
  }>;
  inspect(delegationRunId: string): Promise<AgentDelegationRunSnapshot>;
  resume(delegationRunId: string): Promise<AgentDelegationRunSnapshot>;
  cancel(input: {
    readonly delegationRunId: string;
    readonly idempotencyKey: string;
    readonly reason: string;
  }): Promise<AgentDelegationRunSnapshot>;
};

export function agentDelegationParentRef(input: {
  readonly parentRunId: string;
  readonly rootRunId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly taskId: string;
}): AgentRunParentRef {
  return {
    runId: input.parentRunId,
    rootRunId: input.rootRunId,
    delegationPlanId: input.planId,
    delegationPlanRevision: input.planRevision,
    delegationTaskId: input.taskId,
  };
}

export function validateAgentDelegationPlan(input: {
  readonly plan: AgentDelegationPlan;
  readonly authority: AgentDelegationAuthoritySnapshot;
}): AgentDelegationValidation {
  const { plan, authority } = input;
  const issues: AgentDelegationValidationIssue[] = [];
  const issue = (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => issues.push({ code, path, message });

  if (
    plan.schemaVersion !== AGENT_DELEGATION_SCHEMA_VERSION ||
    !nonEmpty(plan.planId) ||
    !Number.isSafeInteger(plan.revision) ||
    plan.revision < 0 ||
    !validDate(plan.createdAt)
  ) {
    issue(
      "identity-required",
      "plan",
      "A delegation plan requires a supported schema, identity, revision and timestamp.",
    );
  }
  if (!isFailureMode(plan.failureMode)) {
    issue(
      "plan-invalid",
      "plan.failureMode",
      "A delegation plan requires a supported failure mode.",
    );
  }
  validateAuthority(authority, issue);
  if (
    plan.workspaceId !== authority.workspaceId ||
    plan.projectId !== authority.projectId ||
    plan.sessionId !== authority.sessionId ||
    plan.rootRunId !== authority.rootRunId ||
    plan.delegatedByRunId !== authority.delegatedByRunId
  ) {
    issue(
      "scope-mismatch",
      "plan",
      "A delegation plan must remain inside the verified parent Run scope.",
    );
  }
  const policyValid = validatePolicy(authority.policy, issue);
  const nextDepth = authority.currentDepth + 1;
  if (
    !Number.isSafeInteger(authority.currentDepth) ||
    authority.currentDepth < 0 ||
    (policyValid && nextDepth > authority.policy.maxDepth)
  ) {
    issue(
      "depth-exceeded",
      "authority.currentDepth",
      "The next SubAgentRun would exceed the server policy depth.",
    );
  }
  if (
    plan.tasks.length === 0 ||
    (policyValid && plan.tasks.length > authority.policy.maxTasks)
  ) {
    issue(
      "task-limit-exceeded",
      "plan.tasks",
      "A delegation plan must contain a bounded non-empty task set.",
    );
  }
  if (
    !Number.isSafeInteger(plan.maxConcurrency) ||
    plan.maxConcurrency <= 0 ||
    (policyValid && plan.maxConcurrency > authority.policy.maxConcurrency) ||
    plan.maxConcurrency > plan.tasks.length
  ) {
    issue(
      "concurrency-invalid",
      "plan.maxConcurrency",
      "Delegation concurrency must fit the task set and server policy.",
    );
  }

  const taskIds = new Set<string>();
  let dependencyGraphValid = true;
  for (const [index, task] of plan.tasks.entries()) {
    const path = `plan.tasks[${index}]`;
    if (!nonEmpty(task.taskId) || !nonEmpty(task.objective)) {
      dependencyGraphValid = false;
      issue(
        "identity-required",
        path,
        "Each delegated task requires an identity and bounded objective.",
      );
    }
    if (taskIds.has(task.taskId)) {
      dependencyGraphValid = false;
      issue("duplicate-task", `${path}.taskId`, "Task ids must be unique.");
    }
    taskIds.add(task.taskId);
    if (!nonEmpty(task.profile.profileId) || !nonEmpty(task.profile.version)) {
      issue(
        "identity-required",
        `${path}.profile`,
        "A delegated task requires an exact Agent Profile version.",
      );
    }
    validateContext(task, plan, authority, path, issue);
    validateGrant(task, authority, path, issue);
    validateResult(task, authority, path, issue);
  }

  for (const [index, task] of plan.tasks.entries()) {
    const path = `plan.tasks[${index}].dependsOn`;
    if (hasDuplicates(task.dependsOn)) {
      dependencyGraphValid = false;
      issue("dependency-invalid", path, "Task dependencies must be unique.");
    }
    for (const dependency of task.dependsOn) {
      if (dependency === task.taskId || !taskIds.has(dependency)) {
        dependencyGraphValid = false;
        issue(
          "dependency-invalid",
          path,
          "A dependency must reference another task in the same plan.",
        );
      }
    }
  }

  const topologicalOrder = dependencyGraphValid ? orderTasks(plan.tasks) : [];
  if (
    dependencyGraphValid &&
    topologicalOrder.length !== plan.tasks.length
  ) {
    issue(
      "dependency-cycle",
      "plan.tasks",
      "Delegated task dependencies cannot contain a cycle.",
    );
  }
  const budgetEnvelope = validateBudgetEnvelope(plan, authority, issue);
  if (issues.length > 0 || !budgetEnvelope) return { ok: false, issues };
  return { ok: true, nextDepth, topologicalOrder, budgetEnvelope };
}

function validatePolicy(
  policy: AgentDelegationPolicySnapshot,
  issue: (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => void,
): boolean {
  if (
    !Number.isSafeInteger(policy.maxDepth) ||
    policy.maxDepth < 0 ||
    [
      policy.maxTasks,
      policy.maxConcurrency,
      policy.maxContextCharactersPerTask,
      policy.maxResultBytesPerTask,
    ].some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    issue(
      "policy-invalid",
      "authority.policy",
      "Delegation policy limits must be bounded safe integers.",
    );
    return false;
  }
  return true;
}

function validateAuthority(
  authority: AgentDelegationAuthoritySnapshot,
  issue: (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => void,
) {
  if (
    [
      authority.workspaceId,
      authority.projectId,
      authority.sessionId,
      authority.rootRunId,
      authority.delegatedByRunId,
    ].some((value) => !nonEmpty(value))
  ) {
    issue(
      "authority-invalid",
      "authority",
      "Server delegation authority requires an exact non-empty Run scope.",
    );
  }
  const collections = [
    authority.delegablePermissions,
    authority.delegableToolNames,
    authority.delegableSkillRefs,
    authority.delegableMcpConnectionRefs,
    authority.delegableComputeCapabilities,
    authority.delegableContextClassifications,
    authority.delegableArtifactRefs,
  ] as const;
  if (
    !Number.isSafeInteger(authority.sourceContextVersion) ||
    authority.sourceContextVersion <= 0
  ) {
    issue(
      "authority-invalid",
      "authority.sourceContextVersion",
      "Server delegation authority requires an exact parent context version.",
    );
  }
  if (
    collections.some(
      (values) =>
        hasDuplicates(values) ||
        values.some((value) => !nonEmpty(value)),
    )
  ) {
    issue(
      "authority-invalid",
      "authority",
      "Server delegation authority cannot contain empty or duplicate grants.",
    );
  }
}

function validateContext(
  task: AgentDelegationTask,
  plan: AgentDelegationPlan,
  authority: AgentDelegationAuthoritySnapshot,
  path: string,
  issue: (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => void,
) {
  const context = task.context;
  const characters =
    task.objective.length +
    context.facts.reduce(
      (count, fact) => count + fact.key.length + fact.value.length,
      0,
    ) +
    context.artifactRefs.reduce((count, ref) => count + ref.length, 0);
  if (
    context.sourceRunId !== plan.delegatedByRunId ||
    !Number.isSafeInteger(context.sourceContextVersion) ||
    context.sourceContextVersion !== authority.sourceContextVersion ||
    hasDuplicates(context.facts.map(({ key }) => key)) ||
    hasDuplicates(context.artifactRefs) ||
    context.facts.some(
      (fact) =>
        !nonEmpty(fact.key) ||
        !nonEmpty(fact.value) ||
        !isContextClassification(fact.classification),
    ) ||
    context.artifactRefs.some((ref) => !nonEmpty(ref)) ||
    (positiveSafeInteger(authority.policy.maxContextCharactersPerTask) &&
      characters > authority.policy.maxContextCharactersPerTask)
  ) {
    issue(
      "context-invalid",
      `${path}.context`,
      "A child receives only a bounded explicit context package from its parent Run.",
    );
  }
  if (
    context.facts.some(
      (fact) =>
        !authority.delegableContextClassifications.includes(
          fact.classification,
        ),
    ) ||
    context.artifactRefs.some(
      (ref) => !authority.delegableArtifactRefs.includes(ref),
    )
  ) {
    issue(
      "context-not-granted",
      `${path}.context`,
      "A delegated context package must be a subset of server-authorized data.",
    );
  }
}

function validateGrant(
  task: AgentDelegationTask,
  authority: AgentDelegationAuthoritySnapshot,
  path: string,
  issue: (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => void,
) {
  validateGrantSubset(
    "permission-not-granted",
    "permissions",
    task.grant.permissions,
    authority.delegablePermissions,
    path,
    issue,
  );
  validateGrantSubset(
    "tool-not-granted",
    "toolNames",
    task.grant.toolNames,
    authority.delegableToolNames,
    path,
    issue,
  );
  validateGrantSubset(
    "skill-not-granted",
    "skillRefs",
    task.grant.skillRefs,
    authority.delegableSkillRefs,
    path,
    issue,
  );
  validateGrantSubset(
    "mcp-not-granted",
    "mcpConnectionRefs",
    task.grant.mcpConnectionRefs,
    authority.delegableMcpConnectionRefs,
    path,
    issue,
  );
  validateGrantSubset(
    "compute-not-granted",
    "computeCapabilities",
    task.grant.computeCapabilities,
    authority.delegableComputeCapabilities,
    path,
    issue,
  );
}

function validateGrantSubset<T extends string>(
  code: AgentDelegationValidationIssue["code"],
  key: string,
  requested: readonly T[],
  available: readonly T[],
  path: string,
  issue: (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => void,
) {
  if (
    hasDuplicates(requested) ||
    requested.some(
      (value) => !nonEmpty(value) || !available.includes(value),
    )
  ) {
    issue(
      code,
      `${path}.grant.${key}`,
      "A delegated grant must be an explicit subset of server authority.",
    );
  }
}

function validateResult(
  task: AgentDelegationTask,
  authority: AgentDelegationAuthoritySnapshot,
  path: string,
  issue: (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => void,
) {
  if (
    !plainRecord(task.result.outputSchema) ||
    task.result.outputSchema.type !== "object" ||
    !jsonCompatible(task.result.outputSchema) ||
    !Number.isSafeInteger(task.result.maxBytes) ||
    task.result.maxBytes <= 0 ||
    (positiveSafeInteger(authority.policy.maxResultBytesPerTask) &&
      task.result.maxBytes > authority.policy.maxResultBytesPerTask) ||
    hasDuplicates(task.result.requiredEvidenceKinds) ||
    task.result.requiredEvidenceKinds.some((kind) => !nonEmpty(kind))
  ) {
    issue(
      "result-contract-invalid",
      `${path}.result`,
      "A delegated task requires a bounded structured result contract.",
    );
  }
}

function validateBudgetEnvelope(
  plan: AgentDelegationPlan,
  authority: AgentDelegationAuthoritySnapshot,
  issue: (
    code: AgentDelegationValidationIssue["code"],
    path: string,
    message: string,
  ) => void,
): AgentDelegationBudgetEnvelope | undefined {
  const fields = [
    "maxTurns",
    "maxModelCalls",
    "maxToolCalls",
    "maxInputTokens",
    "maxOutputTokens",
  ] as const;
  const totals = Object.fromEntries(fields.map((field) => [field, 0])) as Record<
    (typeof fields)[number],
    number
  >;
  let creditMicros = BigInt(0);
  let maxDurationMs = 0;
  let invalid = false;
  if (!validBudgetLimit(authority.remainingBudget, true)) {
    issue(
      "budget-invalid",
      "authority.remainingBudget",
      "Server remaining budget must be a valid non-negative budget envelope.",
    );
    return undefined;
  }
  for (const [index, task] of plan.tasks.entries()) {
    const budget = task.budget;
    if (!validBudgetLimit(budget, false)) {
      invalid = true;
      issue(
        "budget-invalid",
        `plan.tasks[${index}].budget`,
        "Delegated budgets must use valid Agent budget limits.",
      );
      continue;
    }
    for (const field of fields) {
      totals[field] += budget[field];
      if (!Number.isSafeInteger(totals[field])) invalid = true;
    }
    creditMicros += BigInt(budget.maxCreditMicros);
    maxDurationMs += budget.maxDurationMs;
    if (!Number.isSafeInteger(maxDurationMs)) invalid = true;
  }
  if (invalid) return undefined;
  const envelope: AgentDelegationBudgetEnvelope = {
    ...totals,
    maxCreditMicros: creditMicros.toString(),
    maxDurationMs,
  };
  if (
    fields.some((field) => envelope[field] > authority.remainingBudget[field]) ||
    BigInt(envelope.maxCreditMicros) >
      BigInt(authority.remainingBudget.maxCreditMicros) ||
    envelope.maxDurationMs > authority.remainingBudget.maxDurationMs
  ) {
    issue(
      "budget-exceeded",
      "plan.tasks",
      "The aggregate child budget envelope exceeds parent remaining authority.",
    );
  }
  return envelope;
}

function orderTasks(tasks: readonly AgentDelegationTask[]) {
  const order: string[] = [];
  const taskIds = new Set(tasks.map(({ taskId }) => taskId));
  const taskIndex = new Map(
    tasks.map((task, index) => [task.taskId, index]),
  );
  const indegree = new Map(
    tasks.map((task) => [
      task.taskId,
      task.dependsOn.filter((dependency) => taskIds.has(dependency)).length,
    ]),
  );
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) continue;
      dependents.set(dependency, [
        ...(dependents.get(dependency) || []),
        task.taskId,
      ]);
    }
  }
  const ready = tasks
    .filter((task) => indegree.get(task.taskId) === 0)
    .map(({ taskId }) => taskId);
  while (ready.length > 0) {
    const taskId = ready.shift()!;
    order.push(taskId);
    for (const dependent of dependents.get(taskId) || []) {
      const next = (indegree.get(dependent) || 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort(
          (left, right) =>
            (taskIndex.get(left) || 0) - (taskIndex.get(right) || 0),
        );
      }
    }
  }
  return order;
}

function validDate(value: string) {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function validBudgetLimit(budget: AgentBudgetLimit, allowZero: boolean) {
  const minimum = allowZero ? 0 : 1;
  return (
    [
      budget.maxTurns,
      budget.maxModelCalls,
      budget.maxToolCalls,
      budget.maxInputTokens,
      budget.maxOutputTokens,
      budget.maxDurationMs,
    ].every(
      (value) => Number.isSafeInteger(value) && value >= minimum,
    ) && /^\d+$/.test(budget.maxCreditMicros)
  );
}

function positiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function isFailureMode(value: unknown): value is AgentDelegationPlan["failureMode"] {
  return value === "fail-fast" || value === "isolate";
}

function isContextClassification(
  value: unknown,
): value is AgentDelegationContextFact["classification"] {
  return value === "public" || value === "workspace" || value === "restricted";
}

function nonEmpty(value: string) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasDuplicates<T>(values: readonly T[]) {
  return new Set(values).size !== values.length;
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonCompatible(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const compatible = Array.isArray(value)
    ? value.every((item) => jsonCompatible(item, ancestors))
    : plainRecord(value) &&
      Object.values(value).every((item) => jsonCompatible(item, ancestors));
  ancestors.delete(value);
  return compatible;
}
