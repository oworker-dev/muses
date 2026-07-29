import type {
  AgentBudgetUsage,
  AgentProfileSnapshot,
} from "./contracts";
import {
  AGENT_DELEGATION_SCHEMA_VERSION,
  agentDelegationParentRef,
  validateAgentDelegationPlan,
  type AgentDelegationAuthoritySnapshot,
  type AgentDelegationBudgetEnvelope,
  type AgentDelegationBudgetReservationStatus,
  type AgentDelegationCancellationReceipt,
  type AgentDelegationChildSubmissionReceipt,
  type AgentDelegationContextPackage,
  type AgentDelegationEvent,
  type AgentDelegationEventDraft,
  type AgentDelegationGrant,
  type AgentDelegationPlan,
  type AgentDelegationProfileRegistryPort,
  type AgentDelegationRunSnapshot,
  type AgentDelegationSchedulerPort,
  type AgentDelegationSubmissionReceipt,
  type AgentDelegationTask,
  type AgentDelegationTaskResult,
  type AgentDelegationTaskRun,
} from "./orchestration";
import {
  RandomAgentIdPort,
  SystemAgentClock,
} from "./headless-runtime";
import type { AgentClockPort, AgentIdPort } from "./ports";

export type AgentDelegationRecord = {
  readonly plan: AgentDelegationPlan;
  readonly authority: AgentDelegationAuthoritySnapshot;
  readonly submission: AgentDelegationSubmissionReceipt;
  readonly snapshot: AgentDelegationRunSnapshot;
};

export type AgentDelegationStateStorePort = {
  create(
    record: AgentDelegationRecord,
    events: readonly AgentDelegationEventDraft[],
  ): Promise<{
    readonly created: boolean;
    readonly record: AgentDelegationRecord;
  }>;
  read(delegationRunId: string): Promise<AgentDelegationRecord | null>;
  commit(input: {
    readonly delegationRunId: string;
    readonly expectedRevision: number;
    readonly snapshot: AgentDelegationRunSnapshot;
    readonly events: readonly AgentDelegationEventDraft[];
  }): Promise<AgentDelegationRecord>;
  readEvents(
    delegationRunId: string,
    afterSequence?: number,
  ): Promise<readonly AgentDelegationEvent[]>;
};

export type AgentDelegationFingerprintPort = {
  fingerprint(value: unknown): string | Promise<string>;
};

export type AgentDelegationBudgetPort = {
  reserveEnvelope(input: {
    readonly workspaceId: string;
    readonly parentRunId: string;
    readonly delegationRunId: string;
    readonly reservationId: string;
    readonly envelope: AgentDelegationBudgetEnvelope;
    readonly remainingBudget: AgentDelegationAuthoritySnapshot["remainingBudget"];
    readonly idempotencyKey: string;
  }): Promise<void>;
  reserveTask(input: {
    readonly workspaceId: string;
    readonly delegationRunId: string;
    readonly envelopeReservationId: string;
    readonly taskId: string;
    readonly reservationId: string;
    readonly budget: AgentDelegationTask["budget"];
    readonly idempotencyKey: string;
  }): Promise<void>;
  finalizeTask(input: {
    readonly workspaceId: string;
    readonly delegationRunId: string;
    readonly taskId: string;
    readonly reservationId: string;
    readonly outcome: "settle" | "release" | "review";
    readonly usage?: AgentBudgetUsage;
    readonly idempotencyKey: string;
  }): Promise<void>;
  finalizeEnvelope(input: {
    readonly workspaceId: string;
    readonly delegationRunId: string;
    readonly reservationId: string;
    readonly outcome: "settle" | "release" | "review";
    readonly idempotencyKey: string;
  }): Promise<void>;
};

export type AgentDelegationChildSnapshot = {
  readonly childRunId: string;
  readonly childSandboxId: string;
  readonly status:
    | "queued"
    | "running"
    | "waiting-approval"
    | "completed"
    | "failed"
    | "cancelled";
  readonly result?: AgentDelegationTaskResult;
  readonly usage?: AgentBudgetUsage;
  readonly costOutcome?: "known" | "unknown";
  readonly failure?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
};

export type AgentDelegationChildRuntimePort = {
  start(input: {
    readonly childRunId: string;
    readonly parent: ReturnType<typeof agentDelegationParentRef>;
    readonly session: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly sessionId: string;
    };
    readonly taskId: string;
    readonly objective: string;
    readonly profile: AgentProfileSnapshot;
    readonly context: AgentDelegationContextPackage;
    readonly grant: AgentDelegationGrant;
    readonly budget: AgentDelegationTask["budget"];
    readonly idempotencyKey: string;
  }): Promise<AgentDelegationChildSnapshot>;
  inspect(childRunId: string): Promise<AgentDelegationChildSnapshot>;
  cancel(input: {
    readonly childRunId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  }): Promise<AgentDelegationChildSnapshot | null>;
};

export type AgentDelegationArtifactAuthorizationPort = {
  authorize(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly artifactRefs: readonly string[];
  }): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly unauthorized: readonly string[] }
  >;
};

export type AgentDelegationResultValidatorPort = {
  validate(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly task: AgentDelegationTask;
    readonly result: AgentDelegationTaskResult;
  }): Promise<
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly code: string;
        readonly message: string;
      }
  >;
};

export type AgentDelegationSchedulerDependencies = {
  readonly store: AgentDelegationStateStorePort;
  readonly profiles: AgentDelegationProfileRegistryPort;
  readonly budget: AgentDelegationBudgetPort;
  readonly children: AgentDelegationChildRuntimePort;
  readonly results: AgentDelegationResultValidatorPort;
  readonly fingerprints: AgentDelegationFingerprintPort;
  readonly clock?: AgentClockPort;
  readonly ids?: AgentIdPort;
  readonly taskLeaseMs?: number;
};

export class AgentDelegationRuntimeError extends Error {
  constructor(
    readonly code:
      | "delegation-invalid"
      | "delegation-not-found"
      | "delegation-state-invalid"
      | "delegation-idempotency-conflict"
      | "delegation-revision-conflict"
      | "delegation-profile-invalid"
      | "delegation-child-invalid",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentDelegationRuntimeError";
  }
}

const DEFAULT_TASK_LEASE_MS = 30_000;
const MAX_DRIVE_TRANSITIONS = 256;

export class DefaultAgentDelegationScheduler
  implements AgentDelegationSchedulerPort
{
  private readonly clock: AgentClockPort;
  private readonly ids: AgentIdPort;
  private readonly taskLeaseMs: number;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly dependencies: AgentDelegationSchedulerDependencies) {
    this.clock = dependencies.clock || new SystemAgentClock();
    this.ids = dependencies.ids || new RandomAgentIdPort();
    this.taskLeaseMs = dependencies.taskLeaseMs || DEFAULT_TASK_LEASE_MS;
  }

  async submit(input: {
    readonly plan: AgentDelegationPlan;
    readonly authority: AgentDelegationAuthoritySnapshot;
    readonly idempotencyKey: string;
  }) {
    if (!input.idempotencyKey.trim()) {
      throw new AgentDelegationRuntimeError(
        "delegation-invalid",
        "Delegation submission requires a non-empty idempotency key.",
      );
    }
    const validation = validateAgentDelegationPlan(input);
    if (!validation.ok) {
      throw new AgentDelegationRuntimeError(
        "delegation-invalid",
        "Delegation plan validation failed.",
        validation.issues,
      );
    }
    const [planFingerprint, authorityFingerprint] = await Promise.all([
      this.dependencies.fingerprints.fingerprint(input.plan),
      this.dependencies.fingerprints.fingerprint(input.authority),
    ]);
    if (!planFingerprint.trim() || !authorityFingerprint.trim()) {
      throw new AgentDelegationRuntimeError(
        "delegation-invalid",
        "Delegation fingerprints cannot be empty.",
      );
    }
    const now = this.now();
    const delegationRunId = this.ids.create("delegation");
    const receipt: AgentDelegationSubmissionReceipt = {
      receiptId: this.ids.create("delegation-receipt"),
      delegationRunId,
      idempotencyKey: input.idempotencyKey,
      planId: input.plan.planId,
      planRevision: input.plan.revision,
      planFingerprint,
      authorityFingerprint,
      submittedAt: now,
    };
    const budgetReservationId = this.ids.create("delegation-budget");
    const orderedTasks = validation.topologicalOrder.map((taskId) =>
      input.plan.tasks.find((task) => task.taskId === taskId)!,
    );
    const taskRuns = orderedTasks.map(
      (task): AgentDelegationTaskRun => ({
        taskId: task.taskId,
        status: task.dependsOn.length === 0 ? "ready" : "pending",
      }),
    );
    const snapshot: AgentDelegationRunSnapshot = {
      schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
      delegationRunId,
      planId: input.plan.planId,
      planRevision: input.plan.revision,
      rootRunId: input.plan.rootRunId,
      parentRunId: input.plan.delegatedByRunId,
      authorityFingerprint,
      status: "queued",
      revision: 0,
      maxConcurrency: input.plan.maxConcurrency,
      failureMode: input.plan.failureMode,
      budgetEnvelope: validation.budgetEnvelope,
      budgetReservation: {
        reservationId: budgetReservationId,
        status: "pending",
        updatedAt: now,
      },
      tasks: taskRuns,
      createdAt: now,
      updatedAt: now,
    };
    const record: AgentDelegationRecord = {
      plan: structuredClone(input.plan),
      authority: structuredClone(input.authority),
      submission: receipt,
      snapshot,
    };
    const created = await this.dependencies.store.create(record, [
      this.event(delegationRunId, "delegation.submitted", now, {
        planId: input.plan.planId,
        planRevision: input.plan.revision,
        rootRunId: input.plan.rootRunId,
        parentRunId: input.plan.delegatedByRunId,
        receiptId: receipt.receiptId,
      }),
      ...taskRuns
        .filter(({ status }) => status === "ready")
        .map(({ taskId }) =>
          this.event(delegationRunId, "task.ready", now, { taskId }),
        ),
    ]);
    this.assertIdempotentSubmission(
      created.record,
      input,
      planFingerprint,
      authorityFingerprint,
    );
    const reserved = await this.serialize(created.record.snapshot.delegationRunId, () =>
      this.ensureEnvelopeReservation(created.record.snapshot.delegationRunId),
    );
    return { receipt: reserved.submission, run: reserved.snapshot };
  }

  async inspect(delegationRunId: string) {
    return (await this.requireRecord(delegationRunId)).snapshot;
  }

  async resume(delegationRunId: string) {
    return this.serialize(delegationRunId, () => this.drive(delegationRunId));
  }

  async cancel(input: {
    readonly delegationRunId: string;
    readonly idempotencyKey: string;
    readonly reason: string;
  }) {
    return this.serialize(input.delegationRunId, async () => {
      let record = await this.requireRecord(input.delegationRunId);
      const existing = record.snapshot.cancellation;
      if (existing) {
        if (
          existing.idempotencyKey !== input.idempotencyKey ||
          existing.reason !== input.reason
        ) {
          throw new AgentDelegationRuntimeError(
            "delegation-idempotency-conflict",
            "Delegation cancellation already uses another request.",
          );
        }
        return this.drive(input.delegationRunId);
      }
      if (isTerminal(record.snapshot.status)) {
        throw new AgentDelegationRuntimeError(
          "delegation-state-invalid",
          "A terminal delegation run cannot be cancelled.",
        );
      }
      if (!input.idempotencyKey.trim() || !input.reason.trim()) {
        throw new AgentDelegationRuntimeError(
          "delegation-invalid",
          "Delegation cancellation requires an idempotency key and reason.",
        );
      }
      const now = this.now();
      const cancellation: AgentDelegationCancellationReceipt = {
        receiptId: this.ids.create("delegation-cancel"),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        requestedAt: now,
      };
      record = await this.commit(
        record,
        {
          ...record.snapshot,
          status: "cancelling",
          cancellation,
        },
        [
          this.event(
            input.delegationRunId,
            "delegation.cancellation-requested",
            now,
            { receiptId: cancellation.receiptId, reason: input.reason },
          ),
        ],
      );
      return this.drive(record.snapshot.delegationRunId);
    });
  }

  private async drive(delegationRunId: string) {
    const ownedAttempts = new Set<string>();
    for (let transition = 0; transition < MAX_DRIVE_TRANSITIONS; transition += 1) {
      try {
        let record = await this.requireRecord(delegationRunId);
        if (isTerminal(record.snapshot.status)) return record.snapshot;
        if (record.snapshot.budgetReservation.status === "pending") {
          record = await this.ensureEnvelopeReservation(delegationRunId);
          continue;
        }
        if (record.snapshot.status === "cancelling") {
          const reconciled = await this.reconcileCancellation(record);
          if (!reconciled.changed) return reconciled.record.snapshot;
          continue;
        }

        const actionableClaim = record.snapshot.tasks.find(
          (task) =>
            task.status === "claimed" &&
            (Boolean(task.childSubmission) ||
              ownedAttempts.has(task.claim!.attemptId) ||
              Date.parse(task.claim!.leaseExpiresAt) <=
                this.clock.now().getTime()),
        );
        if (actionableClaim) {
          const changed = await this.driveClaimedTask(
            record,
            actionableClaim,
            ownedAttempts,
          );
          if (!changed) return (await this.requireRecord(delegationRunId)).snapshot;
          continue;
        }

        const active = record.snapshot.tasks.filter(
          (task) =>
            task.status === "running" || task.status === "waiting-approval",
        );
        if (active.length > 0) {
          let changed = false;
          for (const taskRun of active) {
            const child = await this.dependencies.children.inspect(
              taskRun.childRunId!,
            );
            changed = await this.applyChildSnapshot(record, taskRun, child);
            if (changed) break;
          }
          if (!changed) {
            return (await this.requireRecord(delegationRunId)).snapshot;
          }
          continue;
        }

        const completed = await this.completeIfSettled(record);
        if (completed) return completed.snapshot;

        const claimed = await this.claimReadyTasks(record, ownedAttempts);
        if (!claimed) return record.snapshot;
      } catch (error) {
        if (isDelegationRevisionConflict(error)) continue;
        throw error;
      }
    }
    throw new AgentDelegationRuntimeError(
      "delegation-state-invalid",
      "Delegation scheduler exceeded its bounded transition count.",
    );
  }

  private async ensureEnvelopeReservation(delegationRunId: string) {
    let record = await this.requireRecord(delegationRunId);
    if (record.snapshot.budgetReservation.status !== "pending") return record;
    const reservation = record.snapshot.budgetReservation;
    await this.dependencies.budget.reserveEnvelope({
      workspaceId: record.plan.workspaceId,
      parentRunId: record.plan.delegatedByRunId,
      delegationRunId,
      reservationId: reservation.reservationId,
      envelope: record.snapshot.budgetEnvelope,
      remainingBudget: record.authority.remainingBudget,
      idempotencyKey: `reserve:${reservation.reservationId}`,
    });
    const now = this.now();
    record = await this.commit(
      record,
      {
        ...record.snapshot,
        status: "running",
        budgetReservation: {
          ...reservation,
          status: "reserved",
          updatedAt: now,
        },
      },
      [
        this.event(
          delegationRunId,
          "delegation.budget-reserved",
          now,
          { reservationId: reservation.reservationId },
        ),
      ],
    );
    return record;
  }

  private async claimReadyTasks(
    record: AgentDelegationRecord,
    ownedAttempts: Set<string>,
  ) {
    const activeCount = record.snapshot.tasks.filter((task) =>
      isActiveTask(task.status),
    ).length;
    const available = record.snapshot.maxConcurrency - activeCount;
    if (available <= 0) return false;
    const ready = record.snapshot.tasks
      .filter(({ status }) => status === "ready")
      .slice(0, available);
    if (ready.length === 0) return false;
    const now = this.now();
    const claimedIds = new Map(
      ready.map(({ taskId }) => {
        const attemptId = this.ids.create("delegation-attempt");
        ownedAttempts.add(attemptId);
        return [taskId, attemptId];
      }),
    );
    await this.commit(
      record,
      {
        ...record.snapshot,
        tasks: record.snapshot.tasks.map((task) => {
          const attemptId = claimedIds.get(task.taskId);
          return attemptId
            ? {
                ...task,
                status: "claimed" as const,
                claim: {
                  attemptId,
                  leaseExpiresAt: new Date(
                    Date.parse(now) + this.taskLeaseMs,
                  ).toISOString(),
                },
              }
            : task;
        }),
      },
      ready.map(({ taskId }) =>
        this.event(record.snapshot.delegationRunId, "task.claimed", now, {
          taskId,
          attemptId: claimedIds.get(taskId)!,
        }),
      ),
    );
    return true;
  }

  private async driveClaimedTask(
    record: AgentDelegationRecord,
    taskRun: AgentDelegationTaskRun,
    ownedAttempts: Set<string>,
  ) {
    const claim = taskRun.claim!;
    if (!taskRun.childSubmission && !ownedAttempts.has(claim.attemptId)) {
      if (Date.parse(claim.leaseExpiresAt) > this.clock.now().getTime()) {
        return false;
      }
      const now = this.now();
      const attemptId = this.ids.create("delegation-attempt");
      ownedAttempts.add(attemptId);
      await this.commit(
        record,
        {
          ...record.snapshot,
          tasks: replaceTask(record.snapshot.tasks, taskRun.taskId, {
            ...taskRun,
            claim: {
              attemptId,
              leaseExpiresAt: new Date(
                Date.parse(now) + this.taskLeaseMs,
              ).toISOString(),
            },
          }),
        },
        [
          this.event(
            record.snapshot.delegationRunId,
            "task.claimed",
            now,
            { taskId: taskRun.taskId, attemptId, recovered: true },
          ),
        ],
      );
      return true;
    }

    if (!taskRun.childSubmission) {
      return this.prepareChildSubmission(record, taskRun);
    }
    if (taskRun.budgetReservation?.status === "pending") {
      await this.dependencies.budget.reserveTask({
        workspaceId: record.plan.workspaceId,
        delegationRunId: record.snapshot.delegationRunId,
        envelopeReservationId:
          record.snapshot.budgetReservation.reservationId,
        taskId: taskRun.taskId,
        reservationId: taskRun.budgetReservation.reservationId,
        budget: taskFor(record, taskRun.taskId).budget,
        idempotencyKey: `reserve:${taskRun.budgetReservation.reservationId}`,
      });
      const now = this.now();
      await this.commit(
        record,
        {
          ...record.snapshot,
          tasks: replaceTask(record.snapshot.tasks, taskRun.taskId, {
            ...taskRun,
            budgetReservation: {
              ...taskRun.budgetReservation,
              status: "reserved",
              updatedAt: now,
            },
          }),
        },
        [],
      );
      return true;
    }
    const task = taskFor(record, taskRun.taskId);
    const child = await this.dependencies.children.start({
      childRunId: taskRun.childSubmission.childRunId,
      parent: agentDelegationParentRef({
        parentRunId: record.plan.delegatedByRunId,
        rootRunId: record.plan.rootRunId,
        planId: record.plan.planId,
        planRevision: record.plan.revision,
        taskId: task.taskId,
      }),
      session: {
        workspaceId: record.plan.workspaceId,
        projectId: record.plan.projectId,
        sessionId: record.plan.sessionId,
      },
      taskId: task.taskId,
      objective: task.objective,
      profile: taskRun.profileSnapshot!,
      context: task.context,
      grant: task.grant,
      budget: task.budget,
      idempotencyKey: taskRun.childSubmission.idempotencyKey,
    });
    return this.applyChildSnapshot(record, taskRun, child);
  }

  private async prepareChildSubmission(
    record: AgentDelegationRecord,
    taskRun: AgentDelegationTaskRun,
  ) {
    const task = taskFor(record, taskRun.taskId);
    const profile = await this.dependencies.profiles.resolve({
      workspaceId: record.plan.workspaceId,
      projectId: record.plan.projectId,
      profileId: task.profile.profileId,
      version: task.profile.version,
    });
    const profileIssue = validateResolvedProfile(task, profile);
    if (profileIssue) {
      await this.failTask(record, taskRun, {
        code: "profile-invalid",
        message: profileIssue,
        retryable: false,
      });
      return true;
    }
    const now = this.now();
    const childRunId = this.ids.create("arun");
    const budgetReservationId = this.ids.create("delegation-budget");
    const childSubmission: AgentDelegationChildSubmissionReceipt = {
      receiptId: this.ids.create("delegation-receipt"),
      taskId: task.taskId,
      attemptId: taskRun.claim!.attemptId,
      childRunId,
      idempotencyKey: `${record.snapshot.delegationRunId}:${task.taskId}:${taskRun.claim!.attemptId}`,
      budgetReservationId,
      submittedAt: now,
    };
    await this.commit(
      record,
      {
        ...record.snapshot,
        tasks: replaceTask(record.snapshot.tasks, task.taskId, {
          ...taskRun,
          childRunId,
          profileSnapshot: profile!,
          budgetReservation: {
            reservationId: budgetReservationId,
            status: "pending",
            updatedAt: now,
          },
          childSubmission,
        }),
      },
      [
        this.event(
          record.snapshot.delegationRunId,
          "task.child-submitted",
          now,
          {
            taskId: task.taskId,
            childRunId,
            receiptId: childSubmission.receiptId,
          },
        ),
      ],
    );
    return true;
  }

  private async applyChildSnapshot(
    record: AgentDelegationRecord,
    taskRun: AgentDelegationTaskRun,
    child: AgentDelegationChildSnapshot,
  ) {
    if (
      child.childRunId !== taskRun.childRunId ||
      !child.childSandboxId.trim()
    ) {
      throw new AgentDelegationRuntimeError(
        "delegation-child-invalid",
        "Child runtime returned an invalid Run or sandbox identity.",
      );
    }
    if (
      child.status === "queued" ||
      child.status === "running" ||
      child.status === "waiting-approval"
    ) {
      const status =
        child.status === "waiting-approval" ? "waiting-approval" : "running";
      if (
        taskRun.status === status &&
        taskRun.childSandboxId === child.childSandboxId
      ) {
        return false;
      }
      const now = this.now();
      await this.commit(
        record,
        {
          ...record.snapshot,
          tasks: replaceTask(record.snapshot.tasks, taskRun.taskId, {
            ...taskRun,
            status,
            childSandboxId: child.childSandboxId,
          }),
        },
        [
          this.event(
            record.snapshot.delegationRunId,
            "task.running",
            now,
            { taskId: taskRun.taskId, childRunId: child.childRunId },
          ),
        ],
      );
      return true;
    }

    const task = taskFor(record, taskRun.taskId);
    let failure = child.failure;
    if (child.status === "completed") {
      if (!child.result) {
        failure = {
          code: "child-result-missing",
          message: "A completed child Run did not return a structured result.",
          retryable: false,
        };
      } else {
        const validation = await this.dependencies.results.validate({
          workspaceId: record.plan.workspaceId,
          projectId: record.plan.projectId,
          task,
          result: child.result,
        });
        if (!validation.ok) {
          failure = {
            code: validation.code,
            message: validation.message,
            retryable: false,
          };
        }
      }
    }
    if (child.status !== "completed" && !failure) {
      failure = {
        code: `child-${child.status}`,
        message: `Child Run ended with status ${child.status}.`,
        retryable: false,
      };
    }
    const outcome = child.costOutcome === "unknown"
      ? "review"
      : child.usage
        ? "settle"
        : "release";
    await this.dependencies.budget.finalizeTask({
      workspaceId: record.plan.workspaceId,
      delegationRunId: record.snapshot.delegationRunId,
      taskId: task.taskId,
      reservationId: taskRun.budgetReservation!.reservationId,
      outcome,
      usage: child.usage,
      idempotencyKey: `${outcome}:${taskRun.budgetReservation!.reservationId}`,
    });
    const reservationStatus = budgetStatus(outcome);
    if (failure) {
      await this.failTask(
        record,
        taskRun,
        failure,
        child,
        reservationStatus,
      );
      return true;
    }
    const now = this.now();
    const completedTask: AgentDelegationTaskRun = {
      ...taskRun,
      status: "completed",
      childSandboxId: child.childSandboxId,
      budgetReservation: {
        ...taskRun.budgetReservation!,
        status: reservationStatus,
        updatedAt: now,
      },
      result: child.result,
      usage: child.usage,
    };
    const advanced = advanceGraph(record, completedTask);
    await this.commit(
      record,
      { ...record.snapshot, ...advanced.snapshot },
      [
        this.event(
          record.snapshot.delegationRunId,
          "task.completed",
          now,
          { taskId: task.taskId, childRunId: child.childRunId },
        ),
        ...advanced.events.map(({ type, taskId }) =>
          this.event(record.snapshot.delegationRunId, type, now, { taskId }),
        ),
      ],
    );
    return true;
  }

  private async failTask(
    record: AgentDelegationRecord,
    taskRun: AgentDelegationTaskRun,
    failure: NonNullable<AgentDelegationTaskRun["failure"]>,
    child?: AgentDelegationChildSnapshot,
    reservationStatus?: AgentDelegationBudgetReservationStatus,
  ) {
    const now = this.now();
    const failedTask: AgentDelegationTaskRun = {
      ...taskRun,
      status: "failed",
      ...(child?.childSandboxId
        ? { childSandboxId: child.childSandboxId }
        : {}),
      ...(taskRun.budgetReservation
        ? {
            budgetReservation: {
              ...taskRun.budgetReservation,
              status: reservationStatus || taskRun.budgetReservation.status,
              updatedAt: now,
            },
          }
        : {}),
      ...(child?.usage ? { usage: child.usage } : {}),
      failure,
    };
    const advanced = advanceGraph(record, failedTask);
    await this.commit(
      record,
      { ...record.snapshot, ...advanced.snapshot },
      [
        this.event(
          record.snapshot.delegationRunId,
          "task.failed",
          now,
          { taskId: taskRun.taskId, code: failure.code },
        ),
        ...advanced.events.map(({ type, taskId }) =>
          this.event(record.snapshot.delegationRunId, type, now, { taskId }),
        ),
      ],
    );
  }

  private async reconcileCancellation(record: AgentDelegationRecord) {
    const immediate = record.snapshot.tasks.filter(
      (task) =>
        !isTerminalTask(task.status) &&
        !task.childRunId,
    );
    if (immediate.length > 0) {
      const now = this.now();
      const ids = new Set(immediate.map(({ taskId }) => taskId));
      const next = await this.commit(
        record,
        {
          ...record.snapshot,
          tasks: record.snapshot.tasks.map((task) =>
            ids.has(task.taskId)
              ? { ...task, status: "cancelled" as const }
              : task,
          ),
        },
        immediate.map(({ taskId }) =>
          this.event(
            record.snapshot.delegationRunId,
            "task.cancelled",
            now,
            { taskId },
          ),
        ),
      );
      return { changed: true, record: next };
    }
    const active = record.snapshot.tasks.find(
      (task) => !isTerminalTask(task.status),
    );
    if (active) {
      const reason =
        record.snapshot.cancellation?.reason ||
        record.snapshot.failure?.message ||
        "Delegation stopped after a required task failed.";
      const child = await this.dependencies.children.cancel({
        childRunId: active.childRunId!,
        reason,
        idempotencyKey: `cancel:${record.snapshot.delegationRunId}:${active.taskId}`,
      });
      const outcome = child?.costOutcome === "unknown"
        ? "review"
        : child?.usage
          ? "settle"
          : "release";
      if (active.budgetReservation) {
        await this.dependencies.budget.finalizeTask({
          workspaceId: record.plan.workspaceId,
          delegationRunId: record.snapshot.delegationRunId,
          taskId: active.taskId,
          reservationId: active.budgetReservation.reservationId,
          outcome,
          usage: child?.usage,
          idempotencyKey: `${outcome}:${active.budgetReservation.reservationId}`,
        });
      }
      const now = this.now();
      const cancelled = await this.commit(
        record,
        {
          ...record.snapshot,
          tasks: replaceTask(record.snapshot.tasks, active.taskId, {
            ...active,
            status: "cancelled",
            ...(child?.childSandboxId
              ? { childSandboxId: child.childSandboxId }
              : {}),
            ...(child?.usage ? { usage: child.usage } : {}),
            ...(active.budgetReservation
              ? {
                  budgetReservation: {
                    ...active.budgetReservation,
                    status: budgetStatus(outcome),
                    updatedAt: now,
                  },
                }
              : {}),
          }),
        },
        [
          this.event(
            record.snapshot.delegationRunId,
            "task.cancelled",
            now,
            { taskId: active.taskId, childRunId: active.childRunId },
          ),
        ],
      );
      return { changed: true, record: cancelled };
    }
    const finalized = await this.finalizeRun(
      record,
      record.snapshot.cancellation ? "cancelled" : "failed",
    );
    return { changed: true, record: finalized };
  }

  private async completeIfSettled(record: AgentDelegationRecord) {
    if (record.snapshot.tasks.some((task) => !isTerminalTask(task.status))) {
      return null;
    }
    const hasFailures = record.snapshot.tasks.some(
      (task) =>
        task.status === "failed" ||
        task.status === "blocked" ||
        task.status === "cancelled",
    );
    return this.finalizeRun(
      record,
      hasFailures ? "completed-with-failures" : "completed",
    );
  }

  private async finalizeRun(
    record: AgentDelegationRecord,
    status: "completed" | "completed-with-failures" | "failed" | "cancelled",
  ) {
    const reservationStatus = envelopeBudgetStatus(record.snapshot.tasks);
    const outcome = reservationStatus === "review-required"
      ? "review"
      : reservationStatus === "released"
        ? "release"
        : "settle";
    await this.dependencies.budget.finalizeEnvelope({
      workspaceId: record.plan.workspaceId,
      delegationRunId: record.snapshot.delegationRunId,
      reservationId: record.snapshot.budgetReservation.reservationId,
      outcome,
      idempotencyKey: `${outcome}:${record.snapshot.budgetReservation.reservationId}`,
    });
    const now = this.now();
    return this.commit(
      record,
      {
        ...record.snapshot,
        status,
        budgetReservation: {
          ...record.snapshot.budgetReservation,
          status: reservationStatus,
          updatedAt: now,
        },
        completedAt: now,
      },
      [
        this.event(
          record.snapshot.delegationRunId,
          status === "completed-with-failures"
            ? "delegation.completed-with-failures"
            : `delegation.${status}`,
          now,
          { status },
        ),
      ],
    );
  }

  private async commit(
    record: AgentDelegationRecord,
    snapshot: AgentDelegationRunSnapshot,
    events: readonly AgentDelegationEventDraft[],
  ) {
    const now = this.now();
    return this.dependencies.store.commit({
      delegationRunId: record.snapshot.delegationRunId,
      expectedRevision: record.snapshot.revision,
      snapshot: {
        ...snapshot,
        revision: record.snapshot.revision + 1,
        updatedAt: now,
      },
      events,
    });
  }

  private async requireRecord(delegationRunId: string) {
    const record = await this.dependencies.store.read(delegationRunId);
    if (!record) {
      throw new AgentDelegationRuntimeError(
        "delegation-not-found",
        "Delegation run was not found.",
      );
    }
    return record;
  }

  private assertIdempotentSubmission(
    record: AgentDelegationRecord,
    input: {
      readonly plan: AgentDelegationPlan;
      readonly authority: AgentDelegationAuthoritySnapshot;
      readonly idempotencyKey: string;
    },
    planFingerprint: string,
    authorityFingerprint: string,
  ) {
    if (
      record.plan.workspaceId !== input.plan.workspaceId ||
      record.submission.idempotencyKey !== input.idempotencyKey ||
      record.submission.planFingerprint !== planFingerprint ||
      record.submission.authorityFingerprint !== authorityFingerprint
    ) {
      throw new AgentDelegationRuntimeError(
        "delegation-idempotency-conflict",
        "Delegation idempotency key already belongs to another request.",
      );
    }
  }

  private event(
    delegationRunId: string,
    type: AgentDelegationEventDraft["type"],
    createdAt: string,
    data: Readonly<Record<string, unknown>>,
  ): AgentDelegationEventDraft {
    return {
      schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
      delegationRunId,
      type,
      createdAt,
      data,
    };
  }

  private serialize<T>(
    delegationRunId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(delegationRunId) || Promise.resolve();
    const current = previous.then(operation, operation);
    const queued = current.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(delegationRunId, queued);
    return current.finally(() => {
      if (this.queues.get(delegationRunId) === queued) {
        this.queues.delete(delegationRunId);
      }
    });
  }

  private now() {
    return this.clock.now().toISOString();
  }
}

function validateResolvedProfile(
  task: AgentDelegationTask,
  profile: AgentProfileSnapshot | null,
) {
  if (!profile) return "The delegated Agent Profile does not exist.";
  if (
    profile.profileId !== task.profile.profileId ||
    profile.version !== task.profile.version
  ) {
    return "The resolved Agent Profile identity drifted from the plan.";
  }
  if (profile.toolNames.some((name) => !task.grant.toolNames.includes(name))) {
    return "The resolved Agent Profile requests tools outside the task grant.";
  }
  if (profile.skillRefs.some((ref) => !task.grant.skillRefs.includes(ref))) {
    return "The resolved Agent Profile requests Skills outside the task grant.";
  }
  if (
    profile.mcpConnectionRefs.some(
      (ref) => !task.grant.mcpConnectionRefs.includes(ref),
    )
  ) {
    return "The resolved Agent Profile requests MCP connections outside the task grant.";
  }
  return null;
}

function advanceGraph(
  record: AgentDelegationRecord,
  changedTask: AgentDelegationTaskRun,
) {
  let tasks = replaceTask(record.snapshot.tasks, changedTask.taskId, changedTask);
  const events: Array<{
    type: "task.ready" | "task.blocked" | "task.cancelled";
    taskId: string;
  }> = [];
  const failed =
    changedTask.status === "failed" || changedTask.status === "cancelled";
  if (failed && record.plan.failureMode === "fail-fast") {
    tasks = tasks.map((task) => {
      if (isTerminalTask(task.status) || task.taskId === changedTask.taskId) {
        return task;
      }
      if (!task.childRunId) {
        events.push({ type: "task.cancelled", taskId: task.taskId });
        return { ...task, status: "cancelled" as const };
      }
      return task;
    });
    return {
      snapshot: {
        status: "cancelling" as const,
        tasks,
        failure: {
          code: changedTask.failure?.code || "required-task-failed",
          message:
            changedTask.failure?.message || "A required delegated task failed.",
          taskId: changedTask.taskId,
        },
      },
      events,
    };
  }

  let changed = true;
  while (changed) {
    changed = false;
    const statuses = new Map(tasks.map((task) => [task.taskId, task.status]));
    tasks = tasks.map((task) => {
      if (task.status !== "pending" && task.status !== "ready") return task;
      const definition = taskFor(record, task.taskId);
      const dependencyStatuses = definition.dependsOn.map((id) =>
        statuses.get(id),
      );
      if (
        dependencyStatuses.some(
          (status) =>
            status === "failed" ||
            status === "blocked" ||
            status === "cancelled",
        )
      ) {
        events.push({ type: "task.blocked", taskId: task.taskId });
        changed = true;
        return { ...task, status: "blocked" as const };
      }
      if (
        task.status === "pending" &&
        dependencyStatuses.every((status) => status === "completed")
      ) {
        events.push({ type: "task.ready", taskId: task.taskId });
        changed = true;
        return { ...task, status: "ready" as const };
      }
      return task;
    });
  }
  return {
    snapshot: { status: "running" as const, tasks },
    events,
  };
}

function taskFor(record: AgentDelegationRecord, taskId: string) {
  const task = record.plan.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new AgentDelegationRuntimeError(
      "delegation-state-invalid",
      `Delegation task "${taskId}" is missing from its immutable plan.`,
    );
  }
  return task;
}

function replaceTask(
  tasks: readonly AgentDelegationTaskRun[],
  taskId: string,
  replacement: AgentDelegationTaskRun,
) {
  return tasks.map((task) => (task.taskId === taskId ? replacement : task));
}

function budgetStatus(
  outcome: "settle" | "release" | "review",
): AgentDelegationBudgetReservationStatus {
  if (outcome === "review") return "review-required";
  return outcome === "settle" ? "settled" : "released";
}

function envelopeBudgetStatus(
  tasks: readonly AgentDelegationTaskRun[],
): AgentDelegationBudgetReservationStatus {
  const statuses = tasks.map((task) => task.budgetReservation?.status);
  if (statuses.includes("review-required")) return "review-required";
  if (statuses.includes("settled")) return "settled";
  return "released";
}

function isActiveTask(status: AgentDelegationTaskRun["status"]) {
  return (
    status === "claimed" ||
    status === "running" ||
    status === "waiting-approval"
  );
}

function isTerminalTask(status: AgentDelegationTaskRun["status"]) {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  );
}

function isTerminal(status: AgentDelegationRunSnapshot["status"]) {
  return (
    status === "completed" ||
    status === "completed-with-failures" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function isDelegationRevisionConflict(error: unknown) {
  return (
    error instanceof AgentDelegationRuntimeError &&
    error.code === "delegation-revision-conflict"
  );
}
