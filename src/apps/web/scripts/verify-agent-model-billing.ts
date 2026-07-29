import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Pool } from "pg"

import {
  AGENT_CORE_SCHEMA_VERSION,
  type AgentModelResult,
  type AgentRunSnapshot,
} from "@muses/agent-core"

import { PostgresAgentModelCallStore } from "../lib/agent-model-call-store"
import { getDatabaseUrl } from "../lib/database"

const fixtureId = randomUUID().replaceAll("-", "")
const schemaName = `a9_agent_billing_${fixtureId}`
const workspaceId = `workspace_${fixtureId}`
const projectId = `project_${fixtureId}`
const accountId = `account_${fixtureId}`
const userId = `user_${fixtureId}`
const initialBalance = BigInt(100_000)
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db/migrations"
)

const admin = new Pool({ connectionString: getDatabaseUrl(), max: 1 })
const fixture = new Pool({
  connectionString: getDatabaseUrl(),
  max: 4,
  options: `-c search_path=${schemaName},public`,
})

async function main() {
  try {
    await admin.query(`create schema "${schemaName}"`)
    await applyMigrations()
    await seedAuthority()

    const store = new PostgresAgentModelCallStore(fixture)
    const completed = await verifyCompletedReplay(store)
    const reclaimed = await verifyExpiredClaimReclaim(store)
    const ambiguous = await verifyCallingExpiry(store)
    const rejected = await verifyDefinitiveFailure(store)
    const overage = await verifyOverReservation(store)
    const insufficient = await verifyInsufficientCredits(store)
    const balances = (
      await fixture.query<{
        postedMicros: string
        reservedMicros: string
      }>(
        `select posted_balance_micros as "postedMicros",
                reserved_balance_micros as "reservedMicros"
         from credit_account where id = $1`,
        [accountId]
      )
    ).rows[0]
    if (
      balances?.postedMicros !== "99400" ||
      balances.reservedMicros !== "1100"
    ) {
      throw new Error(`Agent billing balances drifted: ${JSON.stringify(balances)}`)
    }

    console.log(
      JSON.stringify({
        passed: true,
        schemaIsolated: true,
        completed,
        reclaimed,
        ambiguous,
        rejected,
        overage,
        insufficient,
        balances,
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
     ) values ($1, 'personal', 'A9 billing fixture', $2, $2)`,
    [workspaceId, userId]
  )
  await fixture.query(
    `insert into muses_project (id, workspace_id, name, created_by_user_id)
     values ($1, $2, 'A9 billing fixture', $3)`,
    [projectId, workspaceId, userId]
  )
  await fixture.query(
    `insert into credit_account (
       id, workspace_id, posted_balance_micros, reserved_balance_micros
     ) values ($1, $2, $3, 0)`,
    [accountId, workspaceId, initialBalance.toString()]
  )
}

async function verifyCompletedReplay(store: PostgresAgentModelCallStore) {
  const run = await createRun("completed")
  const callId = modelCallId(run)
  const estimate = usage(10, 100, 1_000)
  const first = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-completed",
    estimate,
  })
  if (first.state !== "claimed") throw new Error("Initial call was not claimed.")
  const duplicate = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-completed",
    estimate,
  })
  if (duplicate.state !== "in-progress") {
    throw new Error("An active duplicate call was not fenced.")
  }
  await store.begin(callId, first.attemptId)
  const result = modelResult("completed", usage(7, 3, 600))
  const completion = await store.complete({
    callId,
    attemptId: first.attemptId,
    result,
    providerRequestId: "provider-completed",
  })
  const replay = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-completed",
    estimate,
  })
  if (
    completion.state !== "completed" ||
    replay.state !== "replayed" ||
    replay.result.content !== result.content
  ) {
    throw new Error("A completed model receipt did not replay.")
  }
  const ledger = await ledgerKinds(callId)
  assertKinds(ledger, ["release", "reserve", "settle"])
  return { duplicate: duplicate.state, replay: replay.state, ledger }
}

async function verifyExpiredClaimReclaim(store: PostgresAgentModelCallStore) {
  const run = await createRun("reclaim")
  const callId = modelCallId(run)
  const estimate = usage(1, 1, 500)
  const first = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-reclaim",
    estimate,
  })
  if (first.state !== "claimed") throw new Error("Reclaim call was not claimed.")
  await expire(callId)
  const reclaimed = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-reclaim",
    estimate,
  })
  if (
    reclaimed.state !== "claimed" ||
    reclaimed.attemptId === first.attemptId
  ) {
    throw new Error("An expired pre-provider claim was not reclaimed.")
  }
  await store.failDefinitive({
    callId,
    attemptId: reclaimed.attemptId,
    failureCode: "fixture-pre-provider-stop",
  })
  assertKinds(await ledgerKinds(callId), ["release", "reserve"])
  return { state: reclaimed.state, attemptChanged: true }
}

async function verifyCallingExpiry(store: PostgresAgentModelCallStore) {
  const run = await createRun("ambiguous")
  const callId = modelCallId(run)
  const estimate = usage(1, 1, 700)
  const claim = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-ambiguous",
    estimate,
  })
  if (claim.state !== "claimed") throw new Error("Ambiguous call was not claimed.")
  await store.begin(callId, claim.attemptId)
  await expire(callId)
  const ambiguous = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-ambiguous",
    estimate,
  })
  const repeated = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-ambiguous",
    estimate,
  })
  if (ambiguous.state !== "ambiguous" || repeated.state !== "ambiguous") {
    throw new Error("An expired provider call did not remain ambiguous.")
  }
  assertKinds(await ledgerKinds(callId), ["reserve"])
  await assertStatuses(callId, "ambiguous", "review_required")
  return { state: ambiguous.state, automaticRetry: false }
}

async function verifyDefinitiveFailure(store: PostgresAgentModelCallStore) {
  const run = await createRun("rejected")
  const callId = modelCallId(run)
  const estimate = usage(1, 1, 800)
  const claim = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-rejected",
    estimate,
  })
  if (claim.state !== "claimed") throw new Error("Rejected call was not claimed.")
  await store.begin(callId, claim.attemptId)
  const failure = {
    callId,
    attemptId: claim.attemptId,
    failureCode: "provider-http-400",
    providerRequestId: "provider-rejected",
  }
  await store.failDefinitive(failure)
  await store.failDefinitive(failure)
  assertKinds(await ledgerKinds(callId), ["release", "reserve"])
  await assertStatuses(callId, "failed", "released")
  return { state: "failed", releaseEntries: 1 }
}

async function verifyOverReservation(store: PostgresAgentModelCallStore) {
  const run = await createRun("overage")
  const callId = modelCallId(run)
  const estimate = usage(1, 1, 400)
  const claim = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-overage",
    estimate,
  })
  if (claim.state !== "claimed") throw new Error("Overage call was not claimed.")
  await store.begin(callId, claim.attemptId)
  const completion = await store.complete({
    callId,
    attemptId: claim.attemptId,
    result: modelResult("retained for review", usage(2, 2, 500)),
    providerRequestId: "provider-overage",
  })
  if (completion.state !== "review-required") {
    throw new Error("An over-reservation result was silently completed.")
  }
  assertKinds(await ledgerKinds(callId), ["reserve"])
  await assertStatuses(callId, "ambiguous", "review_required")
  const retained = (
    await fixture.query<{ content: string }>(
      `select result->>'content' as content
       from muses_agent_model_call where id = $1`,
      [callId]
    )
  ).rows[0]
  if (retained?.content !== "retained for review") {
    throw new Error("The over-reservation result was not retained.")
  }
  return { state: completion.state, resultRetained: true }
}

async function verifyInsufficientCredits(store: PostgresAgentModelCallStore) {
  const run = await createRun("insufficient")
  const callId = modelCallId(run)
  const claim = await store.claim({
    callId,
    run,
    requestFingerprint: "fingerprint-insufficient",
    estimate: usage(1, 1, 200_000),
  })
  const receiptCount = Number(
    (
      await fixture.query<{ count: string }>(
        `select count(*)::text as count
         from muses_agent_model_call where id = $1`,
        [callId]
      )
    ).rows[0]?.count || 0
  )
  if (claim.state !== "insufficient-credits" || receiptCount !== 0) {
    throw new Error("Insufficient credits created a model side effect receipt.")
  }
  return { state: claim.state, receipts: receiptCount }
}

async function createRun(label: string): Promise<AgentRunSnapshot> {
  const runId = `arun_${label}_${fixtureId}`
  const now = "2026-07-29T00:00:00.000Z"
  const run: AgentRunSnapshot = {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    runId,
    session: {
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      sessionId: `session_${label}_${fixtureId}`,
      workspaceId,
      projectId,
      createdAt: now,
      updatedAt: now,
    },
    profile: {
      profileId: "a9-billing-fixture",
      version: "1.0.0",
      modelRef: "fixture/model",
      instructions: "Sanitized billing fixture.",
      toolNames: [],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    status: "queued",
    revision: 0,
    turn: 0,
    context: {
      version: 1,
      messages: [],
      artifactRefs: [],
      createdAt: now,
    },
    budget: {
      limit: {
        maxTurns: 8,
        maxModelCalls: 8,
        maxToolCalls: 8,
        maxInputTokens: 100_000,
        maxOutputTokens: 100_000,
        maxCreditMicros: "1000000",
        maxDurationMs: 60_000,
      },
      usage: {
        turns: 0,
        modelCalls: 0,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        creditMicros: "0",
        startedAt: now,
      },
    },
    permissions: [],
    metadata: { initiatedByUserId: userId, fixture: "a9-agent-billing" },
    pendingMessages: [],
    pendingToolCalls: [],
    createdAt: now,
    updatedAt: now,
  }
  await fixture.query(
    `insert into muses_agent_run (
       id, workspace_id, project_id, session_id, profile_id, profile_version,
       model_ref, status, revision, snapshot, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $10)`,
    [
      run.runId,
      workspaceId,
      projectId,
      run.session.sessionId,
      run.profile.profileId,
      run.profile.version,
      run.profile.modelRef,
      run.status,
      JSON.stringify(run),
      now,
    ]
  )
  return run
}

async function expire(callId: string) {
  await fixture.query(
    `update muses_agent_model_call
     set lease_expires_at = now() - interval '1 second'
     where id = $1`,
    [callId]
  )
}

async function ledgerKinds(callId: string) {
  return (
    await fixture.query<{ kind: string }>(
      `select kind from credit_ledger_entry
       where agent_model_call_id = $1 order by kind`,
      [callId]
    )
  ).rows.map(({ kind }) => kind)
}

function assertKinds(actual: string[], expected: string[]) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Agent ledger entries drifted: ${JSON.stringify({ actual, expected })}`
    )
  }
}

async function assertStatuses(
  callId: string,
  callStatus: string,
  reservationStatus: string
) {
  const row = (
    await fixture.query<{ callStatus: string; reservationStatus: string }>(
      `select call.status as "callStatus",
              reservation.status as "reservationStatus"
       from muses_agent_model_call call
       left join credit_reservation reservation
         on reservation.agent_model_call_id = call.id
       where call.id = $1`,
      [callId]
    )
  ).rows[0]
  if (
    row?.callStatus !== callStatus ||
    row.reservationStatus !== reservationStatus
  ) {
    throw new Error(`Agent model receipt status drifted: ${JSON.stringify(row)}`)
  }
}

function modelCallId(run: AgentRunSnapshot) {
  return `${run.runId}:model:1:context:1`
}

function usage(inputTokens: number, outputTokens: number, creditMicros: number) {
  return { inputTokens, outputTokens, creditMicros: String(creditMicros) }
}

function modelResult(
  content: string,
  modelUsage: ReturnType<typeof usage>
): AgentModelResult {
  return {
    content,
    finishReason: "stop",
    toolCalls: [],
    usage: modelUsage,
  }
}

await main()
