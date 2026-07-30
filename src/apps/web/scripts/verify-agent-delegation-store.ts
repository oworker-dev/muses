import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Pool } from "pg"

import {
  AGENT_CORE_SCHEMA_VERSION,
  AGENT_DELEGATION_SCHEMA_VERSION,
  AgentDelegationRuntimeError,
  DefaultAgentPolicy,
  HeadlessAgentRuntime,
  type AgentBudgetLimit,
  type AgentBudgetUsage,
  type AgentDelegationAuthoritySnapshot,
  type AgentDelegationChildRuntimePort,
  type AgentDelegationEventDraft,
  type AgentDelegationRecord,
  type AgentDelegationRunSnapshot,
  type AgentIdPort,
  type AgentModelPort,
  type AgentProfileSnapshot,
  type AgentRunSnapshot,
  type AgentToolRegistryPort,
} from "@muses/agent-core"

import { authorizeAgentDelegationExecution } from "../lib/agent-delegation-authorization"
import {
  MusesAgentDelegationChildRuntime,
  PostgresAgentDelegationChildCostOutcome,
} from "../lib/agent-delegation-child-runtime"
import {
  continueAgentDelegationParentWithDependencies,
  createAgentDelegationContinuationIdentity,
} from "../lib/agent-delegation-continuation"
import { PostgresAgentDelegationContinuationStore } from "../lib/agent-delegation-continuation-store"
import { readAgentDelegationLineage } from "../lib/agent-delegation-trace"
import {
  PostgresAgentDelegationBudget,
  PostgresAgentDelegationStore,
} from "../lib/agent-delegation-store"
import { PostgresAgentDelegationDriverStore } from "../lib/agent-delegation-driver-store"
import {
  Sha256AgentDelegationFingerprint,
  createAgentDelegationScheduler,
} from "../lib/agent-delegation-runtime"
import { PostgresAgentStateStore } from "../lib/agent-state-store"
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
    const driver = await verifyDriverOwnership(store)
    const childRuntime = await verifyChildRuntime()
    const continuation = await verifyParentContinuation(store)
    const cancellation = await verifyIndependentCancellation(store)

    console.log(
      JSON.stringify({
        passed: true,
        schemaIsolated: true,
        state,
        reservations,
        driver,
        childRuntime,
        continuation,
        cancellation,
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

async function verifyIndependentCancellation(
  delegations: PostgresAgentDelegationStore
) {
  const stateStore = new PostgresAgentStateStore({ pool: fixture })
  const root = await stateStore.read(rootRunId)
  if (!root) throw new Error("Cancellation fixture lost its root AgentRun.")
  const completedAt = "2026-07-29T00:00:03.000Z"
  const completedRoot: AgentRunSnapshot = {
    ...root,
    status: "completed",
    revision: root.revision + 1,
    completedAt,
    updatedAt: completedAt,
  }
  await fixture.query(
    `update muses_agent_run
     set status = 'completed', revision = $2, snapshot = $3,
         completed_at = $4, updated_at = $4
     where id = $1`,
    [
      rootRunId,
      completedRoot.revision,
      JSON.stringify(completedRoot),
      completedAt,
    ]
  )

  const pending = delegationRecord(
    "independent-cancel",
    "independent-cancel-submit"
  )
  await delegations.create(pending, [event(pending, "delegation.submitted")])
  const children: AgentDelegationChildRuntimePort = {
    start: async () => {
      throw new Error("Cancellation fixture must not start a Child AgentRun.")
    },
    inspect: async () => {
      throw new Error("Cancellation fixture has no Child AgentRun to inspect.")
    },
    cancel: async () => {
      throw new Error("Cancellation fixture has no Child AgentRun to cancel.")
    },
  }
  const scheduler = createAgentDelegationScheduler({
    pool: fixture,
    children,
    profiles: [],
  })
  const authorized = await authorizeAgentDelegationExecution({
    workspaceId,
    projectId,
    sessionId,
    rootRunId,
    delegationRunId: pending.snapshot.delegationRunId,
    pool: fixture,
  })
  const hidden = await authorizeAgentDelegationExecution({
    workspaceId,
    projectId,
    sessionId,
    rootRunId: "run-wrong-root",
    delegationRunId: pending.snapshot.delegationRunId,
    pool: fixture,
  })
  if (!authorized || hidden) {
    throw new Error(
      "Delegation cancellation scope authorization failed closed."
    )
  }
  const cancelled = await scheduler.cancel({
    delegationRunId: pending.snapshot.delegationRunId,
    idempotencyKey: "independent-cancel-request",
    reason: "Cancelled by the fixture user after parent completion.",
  })
  const replay = await scheduler.cancel({
    delegationRunId: pending.snapshot.delegationRunId,
    idempotencyKey: "independent-cancel-request",
    reason: "Cancelled by the fixture user after parent completion.",
  })
  await expectDelegationError(
    () =>
      scheduler.cancel({
        delegationRunId: pending.snapshot.delegationRunId,
        idempotencyKey: "independent-cancel-request",
        reason: "A conflicting cancellation reason.",
      }),
    "delegation-idempotency-conflict"
  )
  const cancelledRecord = await delegations.read(
    pending.snapshot.delegationRunId
  )
  if (!cancelledRecord || cancelledRecord.snapshot.status !== "cancelled") {
    throw new Error(
      `Cancelled delegation restored with another state: ${JSON.stringify(cancelledRecord?.snapshot)}`
    )
  }
  const continuation = await continueAgentDelegationParentWithDependencies(
    cancelledRecord,
    {
      store: new PostgresAgentDelegationContinuationStore(fixture),
      runtime: {
        followUp: async () => {
          throw new Error(
            "Cancelled delegation unexpectedly resumed its parent."
          )
        },
      } as unknown as HeadlessAgentRuntime,
      ensureDriver: async () => {
        throw new Error(
          "Cancelled delegation unexpectedly started a parent driver."
        )
      },
    }
  )
  const reservations = (
    await fixture.query<{ status: string }>(
      `select status from muses_agent_delegation_budget_reservation
       where delegation_run_id = $1`,
      [pending.snapshot.delegationRunId]
    )
  ).rows
  if (
    cancelled.status !== "cancelled" ||
    replay.status !== "cancelled" ||
    continuation.state !== "skipped" ||
    reservations.length !== 1 ||
    reservations[0]?.status !== "released"
  ) {
    throw new Error(
      `Independent cancellation did not settle: ${JSON.stringify({ cancelled, replay, continuation, reservations })}`
    )
  }
  return {
    completedParent: "authorized",
    crossRoot: "hidden",
    schedulerTerminal: cancelled.status,
    replay: "idempotent",
    conflict: "fenced",
    parentContinuation: continuation.state,
    envelopeBudget: reservations[0].status,
  }
}

async function verifyParentContinuation(
  delegations: PostgresAgentDelegationStore
) {
  const terminal = await createTerminalDelegation(
    delegations,
    "continuation",
    "continuation-submit"
  )
  const continuations = new PostgresAgentDelegationContinuationStore(fixture)
  const continuationIds = new NamespacedIds("continuation")
  const runtime = new HeadlessAgentRuntime({
    model: new DelegatedFixtureModel(),
    tools: new NoDelegatedTools(),
    policy: new DefaultAgentPolicy(),
    store: new PostgresAgentStateStore({ pool: fixture, ids: continuationIds }),
    ids: continuationIds,
  })
  let driverAttempts = 0
  try {
    await continueAgentDelegationParentWithDependencies(terminal, {
      store: continuations,
      runtime,
      ensureDriver: async () => {
        driverAttempts += 1
        throw new Error("fixture-parent-driver-unavailable")
      },
    })
    throw new Error("Continuation recovery fixture did not interrupt.")
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "fixture-parent-driver-unavailable"
    ) {
      throw error
    }
  }
  const interrupted = await continuations.inspect(
    terminal.snapshot.delegationRunId
  )
  if (
    interrupted?.status !== "pending" ||
    !interrupted.messageCommittedAt ||
    interrupted.completedAt
  ) {
    throw new Error(
      `Continuation did not preserve its committed-message milestone: ${JSON.stringify(interrupted)}`
    )
  }
  const recovered = await continueAgentDelegationParentWithDependencies(
    terminal,
    {
      store: continuations,
      runtime,
      ensureDriver: async (runId) => {
        driverAttempts += 1
        return {
          state: "attached",
          runId,
          driverRunId: "fixture-parent-driver",
        }
      },
    }
  )
  const replay = await continueAgentDelegationParentWithDependencies(terminal, {
    store: continuations,
    runtime,
    ensureDriver: async () => {
      throw new Error("Completed continuation started another parent driver.")
    },
  })
  const parent = await new PostgresAgentStateStore({ pool: fixture }).read(
    rootRunId
  )
  const events = await new PostgresAgentStateStore({
    pool: fixture,
  }).readEvents(rootRunId)
  const messages = [
    ...(parent?.context.messages || []),
    ...(parent?.pendingMessages || []),
  ].filter(
    ({ metadata }) =>
      metadata?.kind === "agent-delegation-result" &&
      metadata.delegationRunId === terminal.snapshot.delegationRunId
  )
  const modelCalls = Number(
    (
      await fixture.query<{ count: string }>(
        `select count(*)::text as count
         from muses_agent_model_call where run_id = $1`,
        [rootRunId]
      )
    ).rows[0]?.count || "0"
  )
  if (
    recovered.state !== "completed" ||
    replay.state !== "completed" ||
    !replay.idempotentReplay ||
    driverAttempts !== 2 ||
    messages.length !== 1 ||
    events.filter(
      ({ type, data }) =>
        type === "message.follow-up" && data.messageId === recovered.messageId
    ).length !== 1 ||
    modelCalls !== 0
  ) {
    throw new Error(
      `Continuation replay duplicated a message, driver or charge: ${JSON.stringify({ recovered, replay, driverAttempts, messages: messages.length, modelCalls })}`
    )
  }

  const leaseTerminal = await createTerminalDelegation(
    delegations,
    "continuation-lease",
    "continuation-lease-submit"
  )
  const identity = createAgentDelegationContinuationIdentity(leaseTerminal)
  const claims = await Promise.all([
    continuations.claim(identity),
    continuations.claim(identity),
  ])
  const owner = claims.find(({ state }) => state === "claimed")
  if (
    !owner ||
    owner.state !== "claimed" ||
    claims.filter(({ state }) => state === "claimed").length !== 1 ||
    !claims.some(({ state }) => state === "in-progress")
  ) {
    throw new Error("Concurrent continuation claims were not fenced.")
  }
  await fixture.query(
    `update muses_agent_delegation_continuation
     set lease_expires_at = now() - interval '1 second'
     where delegation_run_id = $1`,
    [identity.delegationRunId]
  )
  const reclaimed = await continuations.claim(identity)
  if (
    reclaimed.state !== "claimed" ||
    reclaimed.receipt.attemptId === owner.receipt.attemptId ||
    !reclaimed.receipt.attemptId
  ) {
    throw new Error("An expired continuation lease was not reclaimed.")
  }
  await continuations.skip(
    identity.delegationRunId,
    reclaimed.receipt.attemptId,
    "fixture-complete"
  )

  return {
    trustedMessage: "committed-once",
    interruptedDriver: "recovered",
    completedReplay: "idempotent",
    concurrentClaim: "fenced",
    expiredLease: "reclaimed",
    modelCallsBeforeDriver: modelCalls,
  }
}

async function createTerminalDelegation(
  store: PostgresAgentDelegationStore,
  suffix: string,
  idempotencyKey: string
) {
  const pending = delegationRecord(suffix, idempotencyKey)
  await store.create(pending, [event(pending, "delegation.submitted")])
  const completedAt = "2026-07-29T00:00:02.000Z"
  return store.commit({
    delegationRunId: pending.snapshot.delegationRunId,
    expectedRevision: pending.snapshot.revision,
    snapshot: {
      ...pending.snapshot,
      status: "completed",
      revision: pending.snapshot.revision + 1,
      updatedAt: completedAt,
      completedAt,
      budgetReservation: {
        ...pending.snapshot.budgetReservation,
        status: "settled",
        updatedAt: completedAt,
      },
    },
    events: [
      {
        ...event(pending, "delegation.completed"),
        createdAt: completedAt,
      },
    ],
  })
}

async function verifyChildRuntime() {
  const runtime = new HeadlessAgentRuntime({
    model: new DelegatedFixtureModel(),
    tools: new NoDelegatedTools(),
    policy: new DefaultAgentPolicy(),
    store: new PostgresAgentStateStore({ pool: fixture, ids: new FixedIds() }),
  })
  const children = new MusesAgentDelegationChildRuntime({
    runtime,
    drivers: {
      ensure: async (runId) => runtime.resume(runId),
    },
    cancellations: {
      cancel: async ({ runId }) => {
        await runtime.cancel(runId)
        return "completed"
      },
    },
    costs: new PostgresAgentDelegationChildCostOutcome(fixture),
    fingerprints: new Sha256AgentDelegationFingerprint(),
  })
  const profile = delegatedProfile()
  const scheduler = createAgentDelegationScheduler({
    pool: fixture,
    children,
    profiles: [{ profile }],
  })
  const taskBudget: AgentBudgetLimit = {
    maxTurns: 2,
    maxModelCalls: 2,
    maxToolCalls: 2,
    maxInputTokens: 1_000,
    maxOutputTokens: 500,
    maxCreditMicros: "100",
    maxDurationMs: 30_000,
  }
  const submitted = await scheduler.submit({
    plan: {
      schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
      planId: `plan-child-runtime-${fixtureId}`,
      revision: 0,
      workspaceId,
      projectId,
      sessionId,
      rootRunId,
      delegatedByRunId: rootRunId,
      maxConcurrency: 1,
      failureMode: "isolate",
      tasks: [
        {
          taskId: "summarize",
          objective: "Return the verified fixture result.",
          profile: {
            profileId: profile.profileId,
            version: profile.version,
          },
          dependsOn: [],
          context: {
            sourceRunId: rootRunId,
            sourceContextVersion: 1,
            facts: [
              {
                key: "fixture",
                value: "authorized",
                classification: "public",
              },
            ],
            artifactRefs: [],
          },
          grant: {
            permissions: [],
            toolNames: [],
            skillRefs: [],
            mcpConnectionRefs: [],
            computeCapabilities: [],
          },
          budget: taskBudget,
          result: {
            outputSchema: {
              type: "object",
              properties: { verified: { const: true } },
              required: ["verified"],
              additionalProperties: false,
            },
            maxBytes: 1_024,
            requiredEvidenceKinds: [],
          },
        },
      ],
      createdAt: "2026-07-29T00:00:00.000Z",
    },
    authority: {
      ...delegationAuthority(),
      remainingBudget: {
        maxTurns: 10,
        maxModelCalls: 10,
        maxToolCalls: 10,
        maxInputTokens: 10_000,
        maxOutputTokens: 5_000,
        maxCreditMicros: "1000",
        maxDurationMs: 300_000,
      },
    },
    idempotencyKey: `child-runtime-${fixtureId}`,
  })
  const completed = await scheduler.resume(submitted.run.delegationRunId)
  const task = completed.tasks[0]
  if (
    completed.status !== "completed" ||
    task?.status !== "completed" ||
    !task.childRunId ||
    !task.childSandboxId ||
    (task.result?.data as { verified?: boolean } | undefined)?.verified !== true
  ) {
    throw new Error(
      `Delegated child runtime did not aggregate: ${JSON.stringify(completed)}`
    )
  }
  const child = (
    await fixture.query<{
      snapshot: AgentRunSnapshot
      workspaceId: string
      projectId: string
    }>(
      `select snapshot, workspace_id as "workspaceId", project_id as "projectId"
       from muses_agent_run where id = $1`,
      [task.childRunId]
    )
  ).rows[0]
  if (
    !child ||
    child.workspaceId !== workspaceId ||
    child.projectId !== projectId ||
    child.snapshot.parent?.runId !== rootRunId ||
    child.snapshot.parent.rootRunId !== rootRunId ||
    child.snapshot.extensions?.logicalSandbox.sandboxId !==
      task.childSandboxId ||
    child.snapshot.extensions.logicalSandbox.scope.runId !== task.childRunId
  ) {
    throw new Error("Delegated child AgentRun lost scope or sandbox lineage.")
  }
  const lineage = await readAgentDelegationLineage({
    workspaceId,
    run: rootRun(),
    pool: fixture,
  })
  const tracedDelegation = lineage.delegations.find(
    ({ delegationRunId }) => delegationRunId === completed.delegationRunId
  )
  const tracedChild = lineage.agentRuns.find(
    ({ runId }) => runId === task.childRunId
  )
  const tracedBudgets = lineage.budgetReservations.filter(
    ({ delegationRunId }) => delegationRunId === completed.delegationRunId
  )
  if (
    lineage.rootRunId !== rootRunId ||
    !tracedDelegation ||
    tracedDelegation.tasks[0]?.childRunId !== task.childRunId ||
    tracedDelegation.tasks[0]?.result?.artifactRefs.length !== 0 ||
    tracedChild?.parent?.runId !== rootRunId ||
    tracedChild.sandboxId !== task.childSandboxId ||
    tracedBudgets.length !== 2 ||
    tracedBudgets.some(({ status }) => status !== "settled") ||
    !lineage.events.some(
      (event) =>
        event.delegationRunId === completed.delegationRunId &&
        event.type === "task.completed" &&
        event.childRunId === task.childRunId
    )
  ) {
    throw new Error(
      `Delegation trace lost Run, task, budget or event lineage: ${JSON.stringify(lineage)}`
    )
  }
  return {
    childRun: "persisted",
    parentLineage: "pinned",
    logicalSandbox: "isolated",
    structuredResult: "validated",
    aggregateStatus: completed.status,
    traceLineage: "root-to-child",
    budgetLineage: "settled",
  }
}

async function verifyDriverOwnership(store: PostgresAgentDelegationStore) {
  const record = delegationRecord("driver", "driver-submit")
  await store.create(record, [])
  const drivers = new PostgresAgentDelegationDriverStore(fixture)
  const claims = await Promise.all([
    drivers.claim(record.snapshot.delegationRunId),
    drivers.claim(record.snapshot.delegationRunId),
  ])
  const claimed = claims.find(({ state }) => state === "claimed")
  if (!claimed || claimed.state !== "claimed") {
    throw new Error("Concurrent delegation driver claims had no owner.")
  }
  if (
    claims.filter(({ state }) => state === "claimed").length !== 1 ||
    !claims.some(({ state }) => state === "in-progress")
  ) {
    throw new Error("Concurrent delegation driver claims were not fenced.")
  }
  const firstDriverRunId = `workflow_driver_1_${fixtureId}`
  if (
    !(await drivers.attach(
      record.snapshot.delegationRunId,
      claimed.attemptId,
      firstDriverRunId
    ))
  ) {
    throw new Error("Delegation driver attachment was not persisted.")
  }
  if (
    !(await drivers.renew(
      record.snapshot.delegationRunId,
      claimed.attemptId,
      firstDriverRunId
    ))
  ) {
    throw new Error("Delegation driver lease was not renewed.")
  }
  await fixture.query(
    `update muses_agent_delegation_run
     set driver_lease_expires_at = now() - interval '1 second'
     where id = $1`,
    [record.snapshot.delegationRunId]
  )
  const stale = await drivers.claim(record.snapshot.delegationRunId)
  if (
    stale.state !== "stale-attached" ||
    stale.driverRunId !== firstDriverRunId
  ) {
    throw new Error("An expired delegation driver was not discoverable.")
  }
  const replacement = await drivers.reclaim(
    record.snapshot.delegationRunId,
    stale.attemptId,
    stale.driverRunId
  )
  if (replacement.state !== "claimed") {
    throw new Error("A terminal delegation driver could not be reclaimed.")
  }
  if (
    await drivers.attach(
      record.snapshot.delegationRunId,
      stale.attemptId,
      firstDriverRunId
    )
  ) {
    throw new Error("An orphan delegation driver attachment escaped fencing.")
  }
  const replacementDriverRunId = `workflow_driver_2_${fixtureId}`
  if (
    !(await drivers.attach(
      record.snapshot.delegationRunId,
      replacement.attemptId,
      replacementDriverRunId
    )) ||
    !(await drivers.finish(
      record.snapshot.delegationRunId,
      replacement.attemptId,
      replacementDriverRunId,
      "completed"
    ))
  ) {
    throw new Error("Replacement delegation driver did not complete.")
  }
  const final = await drivers.inspect(record.snapshot.delegationRunId)
  if (final?.status !== "completed" || final.runId !== replacementDriverRunId) {
    throw new Error(`Delegation driver state drifted: ${JSON.stringify(final)}`)
  }

  const cancellationRecord = delegationRecord(
    "driver-cancelled",
    "driver-cancelled-submit"
  )
  await store.create(cancellationRecord, [])
  const cancellationClaim = await drivers.claim(
    cancellationRecord.snapshot.delegationRunId
  )
  if (cancellationClaim.state !== "claimed") {
    throw new Error("Cancellation driver fixture could not claim its Run.")
  }
  const cancelledDriverRunId = `workflow_driver_cancelled_${fixtureId}`
  if (
    !(await drivers.attach(
      cancellationRecord.snapshot.delegationRunId,
      cancellationClaim.attemptId,
      cancelledDriverRunId
    )) ||
    !(await drivers.finish(
      cancellationRecord.snapshot.delegationRunId,
      cancellationClaim.attemptId,
      cancelledDriverRunId,
      "cancelled"
    ))
  ) {
    throw new Error("Cancelled delegation driver state was not persisted.")
  }
  const cancelled = await drivers.inspect(
    cancellationRecord.snapshot.delegationRunId
  )
  if (
    cancelled?.status !== "cancelled" ||
    cancelled.runId !== cancelledDriverRunId
  ) {
    throw new Error(
      `Cancelled delegation driver state drifted: ${JSON.stringify(cancelled)}`
    )
  }
  return {
    concurrentClaim: "fenced",
    leaseRenewal: "persisted",
    expiredAttachment: "reclaimed",
    orphanAttachment: "fenced",
    finalStatus: final.status,
    cancelledStatus: cancelled.status,
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
    metadata: {
      fixture: "a10-delegation",
      initiatedByUserId: userId,
    },
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

class NamespacedIds implements AgentIdPort {
  private sequence = 0

  constructor(private readonly namespace: string) {}

  create(prefix: Parameters<AgentIdPort["create"]>[0]) {
    this.sequence += 1
    return `${prefix}-${fixtureId}-${this.namespace}-${this.sequence}`
  }
}

function delegatedProfile(): AgentProfileSnapshot {
  return {
    profileId: "fixture-specialist",
    version: "1.0.0",
    modelRef: "fixture/model",
    instructions: "Return one structured delegated fixture result.",
    toolNames: [],
    skillRefs: [],
    mcpConnectionRefs: [],
  }
}

class DelegatedFixtureModel implements AgentModelPort {
  estimate() {
    return { inputTokens: 1, outputTokens: 1, creditMicros: "1" }
  }

  async complete() {
    return {
      content: JSON.stringify({
        data: { verified: true },
        artifactRefs: [],
        evidence: [],
      }),
      finishReason: "stop" as const,
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, creditMicros: "1" },
    }
  }
}

class NoDelegatedTools implements AgentToolRegistryPort {
  async list() {
    return []
  }

  async execute(): Promise<never> {
    throw new Error("The delegated fixture exposes no tools.")
  }
}

await main()
