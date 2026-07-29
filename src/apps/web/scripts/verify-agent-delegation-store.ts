import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Pool } from "pg"

import {
  AGENT_CORE_SCHEMA_VERSION,
  AGENT_DELEGATION_SCHEMA_VERSION,
  AgentDelegationRuntimeError,
  type AgentBudgetLimit,
  type AgentBudgetUsage,
  type AgentDelegationAuthoritySnapshot,
  type AgentDelegationEventDraft,
  type AgentDelegationRecord,
  type AgentDelegationRunSnapshot,
  type AgentIdPort,
  type AgentRunSnapshot,
} from "@muses/agent-core"

import {
  PostgresAgentDelegationBudget,
  PostgresAgentDelegationStore,
} from "../lib/agent-delegation-store"
import { getDatabaseUrl } from "../lib/database"

const fixtureId = randomUUID().replaceAll("-", "")
const schemaName = `a10_delegation_${fixtureId}`
const workspaceId = `workspace_${fixtureId}`
const projectId = `project_${fixtureId}`
const userId = `user_${fixtureId}`
const rootRunId = `arun_root_${fixtureId}`
const sessionId = `session_${fixtureId}`
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db/migrations"
)

const admin = new Pool({ connectionString: getDatabaseUrl(), max: 1 })
const fixture = new Pool({
  connectionString: getDatabaseUrl(),
  max: 8,
  options: `-c search_path=${schemaName},public`,
})

async function main() {
  try {
    await admin.query(`create schema "${schemaName}"`)
    await applyMigrations()
    await seedAuthority()

    const store = new PostgresAgentDelegationStore({
      pool: fixture,
      ids: new FixedIds(),
    })
    const budget = new PostgresAgentDelegationBudget(fixture)
    const state = await verifyStateStore(store)
    const reservations = await verifyBudgetReservations(store, budget)

    console.log(
      JSON.stringify({
        passed: true,
        schemaIsolated: true,
        state,
        reservations,
      })
    )
  } finally {
    await fixture.end().catch(() => undefined)
    await admin
      .query(`drop schema if exists "${schemaName}" cascade`)
      .catch(() => undefined)
    await admin.end()
  }
}

async function applyMigrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
  for (const name of names) {
    await fixture.query(await readFile(join(migrationsDirectory, name), "utf8"))
  }
}

async function seedAuthority() {
  await fixture.query(
    `insert into muses_workspace (
       id, kind, name, personal_owner_user_id, created_by_user_id
     ) values ($1, 'personal', 'A10 delegation fixture', $2, $2)`,
    [workspaceId, userId]
  )
  await fixture.query(
    `insert into muses_project (id, workspace_id, name, created_by_user_id)
     values ($1, $2, 'A10 delegation fixture', $3)`,
    [projectId, workspaceId, userId]
  )
  const run = rootRun()
  await fixture.query(
    `insert into muses_agent_run (
       id, workspace_id, project_id, session_id, profile_id, profile_version,
       model_ref, status, revision, snapshot, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $10)`,
    [
      run.runId,
      workspaceId,
      projectId,
      sessionId,
      run.profile.profileId,
      run.profile.version,
      run.profile.modelRef,
      run.status,
      JSON.stringify(run),
      run.createdAt,
    ]
  )
}

async function verifyStateStore(store: PostgresAgentDelegationStore) {
  const first = delegationRecord("state-a", "state-submit")
  const second = delegationRecord("state-b", "state-submit")
  const created = await Promise.all([
    store.create(first, [event(first, "delegation.submitted")]),
    store.create(second, [event(second, "delegation.submitted")]),
  ])
  if (created.filter(({ created: inserted }) => inserted).length !== 1) {
    throw new Error("Concurrent delegation submission was not fenced.")
  }
  if (
    new Set(created.map(({ record }) => record.snapshot.delegationRunId))
      .size !== 1
  ) {
    throw new Error("Delegation submission replay did not converge on one Run.")
  }

  const record = created[0]!.record
  const next = updateSnapshot(record.snapshot, "running")
  const commits = await Promise.allSettled([
    store.commit({
      delegationRunId: record.snapshot.delegationRunId,
      expectedRevision: 0,
      snapshot: next,
      events: [event(record, "delegation.budget-reserved")],
    }),
    store.commit({
      delegationRunId: record.snapshot.delegationRunId,
      expectedRevision: 0,
      snapshot: next,
      events: [event(record, "delegation.budget-reserved")],
    }),
  ])
  if (commits.filter(({ status }) => status === "fulfilled").length !== 1) {
    throw new Error(
      "Delegation CAS allowed an invalid concurrent commit result."
    )
  }
  const rejected = commits.find(({ status }) => status === "rejected")
  if (
    rejected?.status !== "rejected" ||
    !(rejected.reason instanceof AgentDelegationRuntimeError) ||
    rejected.reason.code !== "delegation-revision-conflict"
  ) {
    throw new Error("Delegation CAS did not report a revision conflict.")
  }

  const events = await store.readEvents(record.snapshot.delegationRunId)
  if (
    events.length !== 2 ||
    events.some((item, index) => item.sequence !== index + 1)
  ) {
    throw new Error("Delegation events are not gap-free and ordered.")
  }
  const tail = await store.readEvents(record.snapshot.delegationRunId, 1)
  if (tail.length !== 1 || tail[0]?.sequence !== 2) {
    throw new Error(
      "Delegation event cursor did not resume at the expected sequence."
    )
  }
  await expectDelegationError(
    () => store.readEvents("delegation-missing"),
    "delegation-not-found"
  )

  return {
    concurrentCreate: "fenced",
    revisionConflict: "fenced",
    eventSequences: events.map(({ sequence }) => sequence),
  }
}

async function verifyBudgetReservations(
  store: PostgresAgentDelegationStore,
  budget: PostgresAgentDelegationBudget
) {
  const records = [
    delegationRecord("budget-a", "budget-submit-a"),
    delegationRecord("budget-b", "budget-submit-b"),
  ]
  await Promise.all(records.map((record) => store.create(record, [])))
  const envelope = budgetLimit(6)
  const remainingBudget = budgetLimit(10)
  const requests = records.map((record, index) => ({
    workspaceId,
    parentRunId: rootRunId,
    delegationRunId: record.snapshot.delegationRunId,
    reservationId: `envelope-${index}`,
    envelope,
    remainingBudget,
    idempotencyKey: `reserve-envelope-${index}`,
  }))
  const concurrent = await Promise.allSettled(
    requests.map((request) => budget.reserveEnvelope(request))
  )
  if (
    concurrent.filter(({ status }) => status === "fulfilled").length !== 1 ||
    concurrent.filter(({ status }) => status === "rejected").length !== 1
  ) {
    throw new Error("Concurrent parent budget envelopes were not bounded.")
  }
  const winnerIndex = concurrent.findIndex(
    ({ status }) => status === "fulfilled"
  )
  const winner = requests[winnerIndex]!
  await budget.reserveEnvelope(winner)
  await expectDelegationError(
    () =>
      budget.reserveEnvelope({
        ...winner,
        idempotencyKey: "reserve-envelope-drift",
      }),
    "delegation-idempotency-conflict"
  )

  const taskRequests = [4, 3].map((limit, index) => ({
    workspaceId,
    delegationRunId: winner.delegationRunId,
    envelopeReservationId: winner.reservationId,
    taskId: `task-${index}`,
    reservationId: `task-reservation-${index}`,
    budget: budgetLimit(limit),
    idempotencyKey: `reserve-task-${index}`,
  }))
  const taskAllocations = await Promise.allSettled(
    taskRequests.map((request) => budget.reserveTask(request))
  )
  if (
    taskAllocations.filter(({ status }) => status === "fulfilled").length !==
      1 ||
    taskAllocations.filter(({ status }) => status === "rejected").length !== 1
  ) {
    throw new Error("Concurrent task allocations exceeded their envelope.")
  }
  const taskIndex = taskAllocations.findIndex(
    ({ status }) => status === "fulfilled"
  )
  const task = taskRequests[taskIndex]!
  await budget.reserveTask(task)
  await expectDelegationError(
    () =>
      budget.reserveTask({
        ...task,
        budget: budgetLimit(2),
      }),
    "delegation-idempotency-conflict"
  )
  await expectDelegationError(
    () =>
      budget.finalizeEnvelope({
        workspaceId,
        delegationRunId: winner.delegationRunId,
        reservationId: winner.reservationId,
        outcome: "settle",
        idempotencyKey: "settle-envelope",
      }),
    "delegation-state-invalid"
  )

  const usage = budgetUsage()
  const taskFinalization = {
    workspaceId,
    delegationRunId: winner.delegationRunId,
    taskId: task.taskId,
    reservationId: task.reservationId,
    outcome: "settle" as const,
    usage,
    idempotencyKey: "settle-task",
  }
  await budget.finalizeTask(taskFinalization)
  await budget.finalizeTask(taskFinalization)
  await expectDelegationError(
    () =>
      budget.finalizeTask({
        ...taskFinalization,
        idempotencyKey: "settle-task-drift",
      }),
    "delegation-idempotency-conflict"
  )

  const envelopeFinalization = {
    workspaceId,
    delegationRunId: winner.delegationRunId,
    reservationId: winner.reservationId,
    outcome: "settle" as const,
    idempotencyKey: "settle-envelope",
  }
  await budget.finalizeEnvelope(envelopeFinalization)
  await budget.finalizeEnvelope(envelopeFinalization)
  await expectDelegationError(
    () =>
      budget.finalizeEnvelope({
        ...envelopeFinalization,
        outcome: "release",
      }),
    "delegation-idempotency-conflict"
  )

  const rows = (
    await fixture.query<{ scope: string; status: string }>(
      `select scope, status
       from muses_agent_delegation_budget_reservation
       where delegation_run_id = $1
       order by scope, task_id nulls first`,
      [winner.delegationRunId]
    )
  ).rows
  if (rows.some(({ status }) => status !== "settled")) {
    throw new Error(
      `Delegation reservation finalization drifted: ${JSON.stringify(rows)}`
    )
  }

  return {
    concurrentEnvelope: "bounded",
    concurrentTasks: "bounded",
    replay: "idempotent",
    prematureEnvelopeFinalization: "fenced",
    finalStatuses: rows,
  }
}

async function expectDelegationError(
  operation: () => Promise<unknown>,
  code: AgentDelegationRuntimeError["code"]
) {
  try {
    await operation()
  } catch (error) {
    if (error instanceof AgentDelegationRuntimeError && error.code === code)
      return
    throw error
  }
  throw new Error(`Expected delegation error ${code}.`)
}

function delegationRecord(
  suffix: string,
  idempotencyKey: string
): AgentDelegationRecord {
  const now = "2026-07-29T00:00:00.000Z"
  const delegationRunId = `delegation-${suffix}-${fixtureId}`
  const planId = `plan-${suffix}`
  const envelope = budgetLimit(6)
  return {
    plan: {
      schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
      planId,
      revision: 0,
      workspaceId,
      projectId,
      sessionId,
      rootRunId,
      delegatedByRunId: rootRunId,
      maxConcurrency: 1,
      failureMode: "isolate",
      tasks: [],
      createdAt: now,
    },
    authority: delegationAuthority(),
    submission: {
      receiptId: `receipt-${suffix}`,
      delegationRunId,
      idempotencyKey,
      planId,
      planRevision: 0,
      planFingerprint: `plan-fingerprint-${idempotencyKey}`,
      authorityFingerprint: "authority-fingerprint",
      submittedAt: now,
    },
    snapshot: {
      schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
      delegationRunId,
      planId,
      planRevision: 0,
      rootRunId,
      parentRunId: rootRunId,
      authorityFingerprint: "authority-fingerprint",
      status: "queued",
      revision: 0,
      maxConcurrency: 1,
      failureMode: "isolate",
      budgetEnvelope: envelope,
      budgetReservation: {
        reservationId: `budget-${suffix}`,
        status: "pending",
        updatedAt: now,
      },
      tasks: [],
      createdAt: now,
      updatedAt: now,
    },
  }
}

function event(
  record: AgentDelegationRecord,
  type: AgentDelegationEventDraft["type"]
): AgentDelegationEventDraft {
  return {
    schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
    delegationRunId: record.snapshot.delegationRunId,
    type,
    data: {},
    createdAt: "2026-07-29T00:00:00.000Z",
  }
}

function updateSnapshot(
  snapshot: AgentDelegationRunSnapshot,
  status: AgentDelegationRunSnapshot["status"]
): AgentDelegationRunSnapshot {
  return {
    ...snapshot,
    status,
    revision: snapshot.revision + 1,
    updatedAt: "2026-07-29T00:00:01.000Z",
  }
}

function delegationAuthority(): AgentDelegationAuthoritySnapshot {
  return {
    workspaceId,
    projectId,
    sessionId,
    rootRunId,
    delegatedByRunId: rootRunId,
    sourceContextVersion: 1,
    currentDepth: 0,
    policy: {
      maxDepth: 3,
      maxTasks: 8,
      maxConcurrency: 4,
      maxContextCharactersPerTask: 10_000,
      maxResultBytesPerTask: 64_000,
    },
    delegablePermissions: [],
    delegableToolNames: [],
    delegableSkillRefs: [],
    delegableMcpConnectionRefs: [],
    delegableComputeCapabilities: [],
    delegableContextClassifications: ["public"],
    delegableArtifactRefs: [],
    remainingBudget: budgetLimit(10),
  }
}

function rootRun(): AgentRunSnapshot {
  const now = "2026-07-29T00:00:00.000Z"
  return {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    runId: rootRunId,
    session: {
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      sessionId,
      workspaceId,
      projectId,
      createdAt: now,
      updatedAt: now,
    },
    profile: {
      profileId: "muses-agent",
      version: "1.0.0",
      modelRef: "fixture/model",
      instructions: "Fixture root Agent.",
      toolNames: [],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    status: "running",
    revision: 0,
    turn: 0,
    context: {
      version: 1,
      messages: [],
      artifactRefs: [],
      createdAt: now,
    },
    plan: {
      revision: 0,
      goal: "Verify delegation.",
      steps: [],
      updatedAt: now,
    },
    budget: { limit: budgetLimit(10), usage: budgetUsage() },
    permissions: [],
    metadata: { fixture: "a10-delegation" },
    pendingMessages: [],
    pendingToolCalls: [],
    createdAt: now,
    updatedAt: now,
  }
}

function budgetLimit(value: number): AgentBudgetLimit {
  return {
    maxTurns: value,
    maxModelCalls: value,
    maxToolCalls: value,
    maxInputTokens: value,
    maxOutputTokens: value,
    maxCreditMicros: String(value),
    maxDurationMs: value,
  }
}

function budgetUsage(): AgentBudgetUsage {
  return {
    turns: 1,
    modelCalls: 1,
    toolCalls: 1,
    inputTokens: 1,
    outputTokens: 1,
    creditMicros: "1",
    startedAt: "2026-07-29T00:00:00.000Z",
  }
}

class FixedIds implements AgentIdPort {
  private sequence = 0

  create(prefix: Parameters<AgentIdPort["create"]>[0]) {
    this.sequence += 1
    return `${prefix}-${fixtureId}-${this.sequence}`
  }
}

await main()
