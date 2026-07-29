import type { Pool } from "pg"

import type {
  AgentBudgetUsage,
  AgentDelegationEvent,
  AgentDelegationRecord,
  AgentRunSnapshot,
} from "@muses/agent-core"

import { getPgPool } from "./database"

type DelegationTraceRow = {
  delegationRunId: string
  workspaceId: string
  projectId: string
  sessionId: string
  rootRunId: string
  parentRunId: string
  planId: string
  planRevision: number
  status: string
  revision: number
  record: AgentDelegationRecord
  driverStatus: string
  driverRunId: string | null
  driverAttemptId: string | null
  driverLeaseExpiresAt: Date | string | null
  driverLastHeartbeatAt: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
  completedAt: Date | string | null
}

type DelegationEventTraceRow = {
  eventId: string
  delegationRunId: string
  sequence: number
  type: AgentDelegationEvent["type"]
  data: Readonly<Record<string, unknown>>
  createdAt: Date | string
}

type DelegationBudgetTraceRow = {
  reservationId: string
  delegationRunId: string
  parentReservationId: string | null
  taskId: string | null
  scope: "envelope" | "task"
  status: "active" | "settled" | "released" | "review_required"
  limitSnapshot: Readonly<Record<string, unknown>>
  usageSnapshot: AgentBudgetUsage | null
  createdAt: Date | string
  updatedAt: Date | string
  finalizedAt: Date | string | null
}

type AgentRunTraceRow = {
  runId: string
  snapshot: AgentRunSnapshot
  driverStatus: string
  driverRunId: string | null
  driverAttemptId: string | null
  driverLeaseExpiresAt: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
  completedAt: Date | string | null
}

export async function readAgentDelegationLineage(input: {
  workspaceId: string
  run: AgentRunSnapshot
  pool?: Pool
}) {
  if (input.run.session.workspaceId !== input.workspaceId) {
    throw new Error(
      "Agent delegation trace scope does not match its authorized Run."
    )
  }
  const pool = input.pool || getPgPool()
  const rootRunId = input.run.parent?.rootRunId || input.run.runId
  const scope = [
    input.workspaceId,
    input.run.session.projectId,
    input.run.session.sessionId,
    rootRunId,
  ]
  const [delegationsResult, agentRunsResult] = await Promise.all([
    pool.query<DelegationTraceRow>(
      `
        select id as "delegationRunId", workspace_id as "workspaceId",
               project_id as "projectId", session_id as "sessionId",
               root_run_id as "rootRunId", parent_run_id as "parentRunId",
               plan_id as "planId", plan_revision as "planRevision", status,
               revision, record, driver_status as "driverStatus",
               driver_run_id as "driverRunId",
               driver_attempt_id as "driverAttemptId",
               driver_lease_expires_at as "driverLeaseExpiresAt",
               driver_last_heartbeat_at as "driverLastHeartbeatAt",
               created_at as "createdAt", updated_at as "updatedAt",
               completed_at as "completedAt"
        from muses_agent_delegation_run
        where workspace_id = $1 and project_id = $2 and session_id = $3
          and root_run_id = $4
        order by created_at, id
      `,
      scope
    ),
    pool.query<AgentRunTraceRow>(
      `
        select id as "runId", snapshot, driver_status as "driverStatus",
               driver_run_id as "driverRunId",
               driver_attempt_id as "driverAttemptId",
               driver_lease_expires_at as "driverLeaseExpiresAt",
               created_at as "createdAt", updated_at as "updatedAt",
               completed_at as "completedAt"
        from muses_agent_run
        where workspace_id = $1 and project_id = $2 and session_id = $3
          and (id = $4 or snapshot #>> '{parent,rootRunId}' = $4)
        order by case when id = $4 then 0 else 1 end, created_at, id
      `,
      scope
    ),
  ])

  const delegationRunIds = delegationsResult.rows.map(
    ({ delegationRunId }) => delegationRunId
  )
  const [eventsResult, budgetsResult] = await Promise.all([
    pool.query<DelegationEventTraceRow>(
      `
        select event_id as "eventId", delegation_run_id as "delegationRunId",
               sequence, type, data, created_at as "createdAt"
        from muses_agent_delegation_event
        where delegation_run_id = any($1::text[])
        order by delegation_run_id, sequence
      `,
      [delegationRunIds]
    ),
    pool.query<DelegationBudgetTraceRow>(
      `
        select id as "reservationId", delegation_run_id as "delegationRunId",
               parent_reservation_id as "parentReservationId", task_id as "taskId",
               scope, status, limit_snapshot as "limitSnapshot",
               usage_snapshot as "usageSnapshot", created_at as "createdAt",
               updated_at as "updatedAt", finalized_at as "finalizedAt"
        from muses_agent_delegation_budget_reservation
        where workspace_id = $1 and delegation_run_id = any($2::text[])
        order by delegation_run_id, scope, task_id nulls first
      `,
      [input.workspaceId, delegationRunIds]
    ),
  ])

  const agentRuns = agentRunsResult.rows.map((row) => projectAgentRun(row))
  return {
    rootRunId,
    requestedRunId: input.run.runId,
    agentRunIds: agentRuns.map(({ runId }) => runId),
    agentRuns,
    delegations: delegationsResult.rows.map(projectDelegation),
    events: eventsResult.rows.map((event) => ({
      eventId: event.eventId,
      delegationRunId: event.delegationRunId,
      sequence: event.sequence,
      type: event.type,
      createdAt: iso(event.createdAt),
      ...projectEventLinks(event.data),
    })),
    budgetReservations: budgetsResult.rows.map((reservation) => ({
      ...reservation,
      createdAt: iso(reservation.createdAt),
      updatedAt: iso(reservation.updatedAt),
      finalizedAt: optionalIso(reservation.finalizedAt),
    })),
    workflowDriverRefs: [
      ...agentRunsResult.rows.flatMap((run) =>
        run.driverRunId
          ? [{ kind: "agent-driver" as const, runId: run.driverRunId }]
          : []
      ),
      ...delegationsResult.rows.flatMap((delegation) =>
        delegation.driverRunId
          ? [
              {
                kind: "delegation-driver" as const,
                runId: delegation.driverRunId,
              },
            ]
          : []
      ),
    ],
  }
}

function projectDelegation(row: DelegationTraceRow) {
  const snapshot = row.record.snapshot
  if (
    snapshot.delegationRunId !== row.delegationRunId ||
    snapshot.rootRunId !== row.rootRunId ||
    snapshot.parentRunId !== row.parentRunId ||
    snapshot.planId !== row.planId ||
    snapshot.planRevision !== row.planRevision ||
    snapshot.status !== row.status ||
    snapshot.revision !== row.revision
  ) {
    throw new Error(
      "Persisted Agent delegation trace identity is inconsistent."
    )
  }
  return {
    delegationRunId: row.delegationRunId,
    planId: row.planId,
    planRevision: row.planRevision,
    rootRunId: row.rootRunId,
    parentRunId: row.parentRunId,
    status: snapshot.status,
    revision: snapshot.revision,
    submissionReceiptId: row.record.submission.receiptId,
    maxConcurrency: snapshot.maxConcurrency,
    failureMode: snapshot.failureMode,
    budgetEnvelope: snapshot.budgetEnvelope,
    budgetReservation: snapshot.budgetReservation,
    driver: {
      status: row.driverStatus,
      runId: row.driverRunId,
      attemptId: row.driverAttemptId,
      leaseExpiresAt: optionalIso(row.driverLeaseExpiresAt),
      lastHeartbeatAt: optionalIso(row.driverLastHeartbeatAt),
    },
    tasks: snapshot.tasks.map((task) => ({
      taskId: task.taskId,
      status: task.status,
      ...(task.claim ? { claimAttemptId: task.claim.attemptId } : {}),
      ...(task.childRunId ? { childRunId: task.childRunId } : {}),
      ...(task.childSandboxId ? { childSandboxId: task.childSandboxId } : {}),
      ...(task.profileSnapshot
        ? {
            profile: {
              profileId: task.profileSnapshot.profileId,
              version: task.profileSnapshot.version,
              modelRef: task.profileSnapshot.modelRef,
            },
          }
        : {}),
      ...(task.budgetReservation
        ? { budgetReservation: task.budgetReservation }
        : {}),
      ...(task.usage ? { usage: task.usage } : {}),
      ...(task.failure
        ? {
            failure: {
              code: task.failure.code,
              retryable: task.failure.retryable,
            },
          }
        : {}),
      ...(task.result
        ? {
            result: {
              artifactRefs: task.result.artifactRefs,
              evidence: task.result.evidence,
            },
          }
        : {}),
    })),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    completedAt: optionalIso(row.completedAt),
  }
}

function projectAgentRun(row: AgentRunTraceRow) {
  const run = row.snapshot
  if (run.runId !== row.runId) {
    throw new Error("Persisted AgentRun trace identity is inconsistent.")
  }
  return {
    runId: run.runId,
    ...(run.parent ? { parent: run.parent } : {}),
    status: run.status,
    revision: run.revision,
    profile: {
      profileId: run.profile.profileId,
      version: run.profile.version,
      modelRef: run.profile.modelRef,
    },
    budget: run.budget,
    sandboxId: run.extensions?.logicalSandbox.sandboxId || null,
    driver: {
      status: row.driverStatus,
      runId: row.driverRunId,
      attemptId: row.driverAttemptId,
      leaseExpiresAt: optionalIso(row.driverLeaseExpiresAt),
    },
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    completedAt: optionalIso(row.completedAt),
  }
}

function projectEventLinks(data: Readonly<Record<string, unknown>>): {
  taskId?: string
  childRunId?: string
  receiptId?: string
} {
  const taskId = stringFact(data.taskId)
  const childRunId = stringFact(data.childRunId)
  const receiptId = stringFact(data.receiptId)
  return {
    ...(taskId ? { taskId } : {}),
    ...(childRunId ? { childRunId } : {}),
    ...(receiptId ? { receiptId } : {}),
  }
}

function stringFact(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function optionalIso(value: Date | string | null) {
  return value ? iso(value) : null
}
