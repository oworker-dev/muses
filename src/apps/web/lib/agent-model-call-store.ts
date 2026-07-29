import { createHash, randomUUID } from "node:crypto"

import type { Pool, PoolClient } from "pg"
import { z } from "zod"

import type {
  AgentModelResult,
  AgentModelUsage,
  AgentRunSnapshot,
} from "@muses/agent-core"

import { getPgPool } from "./database"

const ZERO = BigInt(0)
export const AGENT_MODEL_CALL_LEASE_MS = 5 * 60 * 1000

export type AgentModelCallClaim =
  | { state: "claimed"; attemptId: string }
  | { state: "replayed"; result: AgentModelResult }
  | { state: "in-progress" }
  | { state: "ambiguous" }
  | { state: "failed"; failureCode?: string }
  | { state: "idempotency-conflict" }
  | {
      state: "insufficient-credits"
      requiredMicros: bigint
      availableMicros: bigint
    }

export type AgentModelCallCompletion =
  | { state: "completed" }
  | { state: "review-required" }

export type AgentModelCallStore = {
  claim(input: {
    callId: string
    run: AgentRunSnapshot
    requestFingerprint: string
    estimate: AgentModelUsage
  }): Promise<AgentModelCallClaim>
  begin(callId: string, attemptId: string): Promise<void>
  complete(input: {
    callId: string
    attemptId: string
    result: AgentModelResult
    providerRequestId?: string
  }): Promise<AgentModelCallCompletion>
  failDefinitive(input: {
    callId: string
    attemptId: string
    failureCode: string
    providerRequestId?: string
  }): Promise<void>
  markAmbiguous(input: {
    callId: string
    attemptId: string
    failureCode: string
    providerRequestId?: string
  }): Promise<void>
}

type ModelCallRow = {
  id: string
  status: "claimed" | "calling" | "completed" | "failed" | "ambiguous"
  attemptId: string
  leaseExpiresAt: Date | string
  requestFingerprint: string
  result: unknown
  failureCode: string | null
}

export function fingerprintAgentModelCall(input: unknown) {
  return createHash("sha256").update(stableJson(input)).digest("hex")
}

export class PostgresAgentModelCallStore implements AgentModelCallStore {
  constructor(private readonly pool: Pool = getPgPool()) {}

  async claim(input: {
    callId: string
    run: AgentRunSnapshot
    requestFingerprint: string
    estimate: AgentModelUsage
  }): Promise<AgentModelCallClaim> {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 11))",
        [input.callId]
      )
      const existing = (
        await client.query<ModelCallRow>(
          `
            select
              id, status, attempt_id as "attemptId",
              lease_expires_at as "leaseExpiresAt",
              request_fingerprint as "requestFingerprint", result,
              failure_code as "failureCode"
            from muses_agent_model_call
            where id = $1
            for update
          `,
          [input.callId]
        )
      ).rows[0]
      if (existing) {
        const claim = await this.resolveExistingClaim(
          client,
          existing,
          input.requestFingerprint
        )
        await client.query("commit")
        return claim
      }

      const account = (
        await client.query<{
          id: string
          postedMicros: string
          reservedMicros: string
        }>(
          `
            select id, posted_balance_micros as "postedMicros",
                   reserved_balance_micros as "reservedMicros"
            from credit_account
            where workspace_id = $1
            for update
          `,
          [input.run.session.workspaceId]
        )
      ).rows[0]
      if (!account) throw new Error("Agent credit account was not found.")
      const estimatedMicros = BigInt(input.estimate.creditMicros)
      const postedMicros = BigInt(account.postedMicros)
      const reservedMicros = BigInt(account.reservedMicros)
      const availableMicros = postedMicros - reservedMicros
      if (estimatedMicros > availableMicros) {
        await client.query("rollback")
        return {
          state: "insufficient-credits",
          requiredMicros: estimatedMicros,
          availableMicros,
        }
      }

      const attemptId = createAttemptId()
      const leaseExpiresAt = new Date(
        Date.now() + AGENT_MODEL_CALL_LEASE_MS
      ).toISOString()
      await client.query(
        `
          insert into muses_agent_model_call (
            id, run_id, workspace_id, turn, context_version, model_ref,
            request_fingerprint, attempt_id, lease_expires_at,
            estimated_input_tokens, estimated_output_tokens,
            estimated_credit_micros
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          input.callId,
          input.run.runId,
          input.run.session.workspaceId,
          input.run.turn + 1,
          input.run.context.version,
          input.run.profile.modelRef,
          input.requestFingerprint,
          attemptId,
          leaseExpiresAt,
          input.estimate.inputTokens,
          input.estimate.outputTokens,
          estimatedMicros.toString(),
        ]
      )
      if (estimatedMicros > ZERO) {
        await reserveModelCredits(client, {
          account,
          callId: input.callId,
          run: input.run,
          estimate: input.estimate,
          estimatedMicros,
        })
      }
      await client.query("commit")
      return { state: "claimed", attemptId }
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async begin(callId: string, attemptId: string) {
    const result = await this.pool.query(
      `
        update muses_agent_model_call
        set status = 'calling', started_at = coalesce(started_at, now()),
            lease_expires_at = now() + ($3 * interval '1 millisecond'),
            updated_at = now()
        where id = $1 and attempt_id = $2 and status = 'claimed'
      `,
      [callId, attemptId, AGENT_MODEL_CALL_LEASE_MS]
    )
    if (result.rowCount !== 1) {
      throw new Error("Agent model call ownership changed before provider start.")
    }
  }

  async complete(input: {
    callId: string
    attemptId: string
    result: AgentModelResult
    providerRequestId?: string
  }): Promise<AgentModelCallCompletion> {
    const persistedResult = parseModelResult(input.result)
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const call = (
        await client.query<{ status: string; attemptId: string }>(
          `select status, attempt_id as "attemptId"
           from muses_agent_model_call where id = $1 for update`,
          [input.callId]
        )
      ).rows[0]
      if (!call || call.status !== "calling" || call.attemptId !== input.attemptId) {
        throw new Error("Agent model call ownership changed before completion.")
      }
      const settlement = await settleModelCredits(
        client,
        input.callId,
        persistedResult.usage
      )
      const status =
        settlement === "review-required" ? "ambiguous" : "completed"
      const failureCode =
        settlement === "review-required"
          ? "actual-usage-exceeded-reservation"
          : null
      const completed = await client.query(
        `
          update muses_agent_model_call
          set status = $3, result = $4, provider_request_id = $5,
              actual_input_tokens = $6, actual_output_tokens = $7,
              actual_credit_micros = $8, failure_code = $9,
              completed_at = now(), updated_at = now()
          where id = $1 and attempt_id = $2 and status = 'calling'
        `,
        [
          input.callId,
          input.attemptId,
          status,
          JSON.stringify(persistedResult),
          input.providerRequestId || null,
          persistedResult.usage.inputTokens,
          persistedResult.usage.outputTokens,
          persistedResult.usage.creditMicros,
          failureCode,
        ]
      )
      if (completed.rowCount !== 1) {
        throw new Error("Agent model call ownership changed before completion.")
      }
      await client.query("commit")
      return settlement === "review-required"
        ? { state: "review-required" }
        : { state: "completed" }
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async failDefinitive(input: {
    callId: string
    attemptId: string
    failureCode: string
    providerRequestId?: string
  }) {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const call = (
        await client.query<{ status: string; attemptId: string }>(
          `select status, attempt_id as "attemptId"
           from muses_agent_model_call where id = $1 for update`,
          [input.callId]
        )
      ).rows[0]
      if (
        call?.status === "failed" &&
        call.attemptId === input.attemptId
      ) {
        await client.query("commit")
        return
      }
      if (
        !call ||
        (call.status !== "claimed" && call.status !== "calling") ||
        call.attemptId !== input.attemptId
      ) {
        throw new Error("Agent model call ownership changed before failure.")
      }
      await releaseModelCredits(client, input.callId, input.failureCode)
      const failed = await client.query(
        `update muses_agent_model_call
         set status = 'failed', failure_code = $3,
             provider_request_id = coalesce(provider_request_id, $4),
             completed_at = now(), updated_at = now()
         where id = $1 and attempt_id = $2
           and status in ('claimed', 'calling')`,
        [
          input.callId,
          input.attemptId,
          input.failureCode,
          input.providerRequestId || null,
        ]
      )
      if (failed.rowCount !== 1) {
        throw new Error("Agent model call ownership changed before failure.")
      }
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async markAmbiguous(input: {
    callId: string
    attemptId: string
    failureCode: string
    providerRequestId?: string
  }) {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const call = (
        await client.query<{ status: string; attemptId: string }>(
          `select status, attempt_id as "attemptId"
           from muses_agent_model_call where id = $1 for update`,
          [input.callId]
        )
      ).rows[0]
      if (
        !call ||
        call.attemptId !== input.attemptId ||
        (call.status !== "calling" && call.status !== "ambiguous")
      ) {
        throw new Error("Agent model call ownership changed before review.")
      }
      if (call.status === "calling") {
        await markCallAmbiguous(
          client,
          input.callId,
          input.attemptId,
          input.failureCode
        )
      }
      await client.query(
        `update muses_agent_model_call
         set provider_request_id = coalesce(provider_request_id, $3)
         where id = $1 and attempt_id = $2`,
        [input.callId, input.attemptId, input.providerRequestId || null]
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async resolveExistingClaim(
    client: PoolClient,
    existing: ModelCallRow,
    requestFingerprint: string
  ): Promise<AgentModelCallClaim> {
    if (existing.requestFingerprint !== requestFingerprint) {
      return { state: "idempotency-conflict" }
    }
    if (existing.status === "completed") {
      return { state: "replayed", result: parseModelResult(existing.result) }
    }
    if (existing.status === "ambiguous") return { state: "ambiguous" }
    if (existing.status === "failed") {
      return {
        state: "failed",
        ...(existing.failureCode ? { failureCode: existing.failureCode } : {}),
      }
    }
    if (new Date(existing.leaseExpiresAt).getTime() > Date.now()) {
      return { state: "in-progress" }
    }
    if (existing.status === "calling") {
      await markCallAmbiguous(
        client,
        existing.id,
        existing.attemptId,
        "provider-outcome-unknown-after-lease-expiry"
      )
      return { state: "ambiguous" }
    }
    const attemptId = createAttemptId()
    await client.query(
      `
        update muses_agent_model_call
        set attempt_id = $2,
            lease_expires_at = now() + ($3 * interval '1 millisecond'),
            updated_at = now()
        where id = $1 and status = 'claimed'
      `,
      [existing.id, attemptId, AGENT_MODEL_CALL_LEASE_MS]
    )
    return { state: "claimed", attemptId }
  }
}

async function reserveModelCredits(
  client: PoolClient,
  input: {
    account: { id: string; postedMicros: string; reservedMicros: string }
    callId: string
    run: AgentRunSnapshot
    estimate: AgentModelUsage
    estimatedMicros: bigint
  }
) {
  const reservationId = prefixedId("mcr")
  const nextReserved = BigInt(input.account.reservedMicros) + input.estimatedMicros
  const pricingSnapshot = {
    version: "agent-model-call-v1",
    modelRef: input.run.profile.modelRef,
    estimate: input.estimate,
  }
  await client.query(
    `
      insert into credit_reservation (
        id, account_id, workspace_id, submission_id, agent_model_call_id,
        idempotency_key, estimated_micros, pricing_snapshot
      ) values ($1, $2, $3, null, $4, $5, $6, $7)
    `,
    [
      reservationId,
      input.account.id,
      input.run.session.workspaceId,
      input.callId,
      `agent-model:${input.callId}`,
      input.estimatedMicros.toString(),
      JSON.stringify(pricingSnapshot),
    ]
  )
  await insertAgentLedgerEntry(client, {
    accountId: input.account.id,
    workspaceId: input.run.session.workspaceId,
    reservationId,
    runId: input.run.runId,
    callId: input.callId,
    kind: "reserve",
    balanceDeltaMicros: ZERO,
    reservedDeltaMicros: input.estimatedMicros,
    balanceAfterMicros: BigInt(input.account.postedMicros),
    reservedAfterMicros: nextReserved,
    idempotencyKey: `reserve:agent-model:${input.callId}`,
    actorUserId: stringMetadata(input.run.metadata, "initiatedByUserId"),
    reason: "Agent model usage reservation",
    metadata: pricingSnapshot,
  })
  await client.query(
    `update credit_account set reserved_balance_micros = $2, updated_at = now()
     where id = $1`,
    [input.account.id, nextReserved.toString()]
  )
}

async function settleModelCredits(
  client: PoolClient,
  callId: string,
  usage: AgentModelUsage
): Promise<"settled" | "review-required"> {
  const reservation = (
    await client.query<{
      id: string
      accountId: string
      workspaceId: string
      runId: string
      status: string
      estimatedMicros: string
      postedMicros: string
      reservedMicros: string
    }>(
      `
        select reservation.id, reservation.account_id as "accountId",
               reservation.workspace_id as "workspaceId", call.run_id as "runId",
               reservation.status, reservation.estimated_micros as "estimatedMicros",
               account.posted_balance_micros as "postedMicros",
               account.reserved_balance_micros as "reservedMicros"
        from credit_reservation reservation
        join muses_agent_model_call call on call.id = reservation.agent_model_call_id
        join credit_account account on account.id = reservation.account_id
        where reservation.agent_model_call_id = $1
        for update of reservation, account
      `,
      [callId]
    )
  ).rows[0]
  if (!reservation) {
    if (BigInt(usage.creditMicros) !== ZERO) {
      throw new Error("Agent model usage had no credit reservation.")
    }
    return "settled"
  }
  if (reservation.status === "review_required") return "review-required"
  if (reservation.status !== "active") return "settled"
  const estimated = BigInt(reservation.estimatedMicros)
  const actual = BigInt(usage.creditMicros)
  if (actual > estimated) {
    await client.query(
      `update credit_reservation
       set status = 'review_required', failure_reason = $2
       where id = $1`,
      [reservation.id, "Actual Agent model usage exceeded its reservation."]
    )
    return "review-required"
  }
  let posted = BigInt(reservation.postedMicros)
  let reserved = BigInt(reservation.reservedMicros)
  if (actual > ZERO) {
    posted -= actual
    reserved -= actual
    await insertAgentLedgerEntry(client, {
      accountId: reservation.accountId,
      workspaceId: reservation.workspaceId,
      reservationId: reservation.id,
      runId: reservation.runId,
      callId,
      kind: "settle",
      balanceDeltaMicros: -actual,
      reservedDeltaMicros: -actual,
      balanceAfterMicros: posted,
      reservedAfterMicros: reserved,
      idempotencyKey: `settle:agent-model:${callId}`,
      reason: "Agent model usage settled",
    })
  }
  const released = estimated - actual
  if (released > ZERO) {
    reserved -= released
    await insertAgentLedgerEntry(client, {
      accountId: reservation.accountId,
      workspaceId: reservation.workspaceId,
      reservationId: reservation.id,
      runId: reservation.runId,
      callId,
      kind: "release",
      balanceDeltaMicros: ZERO,
      reservedDeltaMicros: -released,
      balanceAfterMicros: posted,
      reservedAfterMicros: reserved,
      idempotencyKey: `release:agent-model:${callId}`,
      reason: "Unused Agent model reservation released",
    })
  }
  await client.query(
    `update credit_account
     set posted_balance_micros = $2, reserved_balance_micros = $3, updated_at = now()
     where id = $1`,
    [reservation.accountId, posted.toString(), reserved.toString()]
  )
  await client.query(
    `update credit_reservation
     set status = 'settled', settled_micros = $2, finalized_at = now()
     where id = $1`,
    [reservation.id, actual.toString()]
  )
  return "settled"
}

async function releaseModelCredits(
  client: PoolClient,
  callId: string,
  failureCode: string
) {
  const reservation = (
    await client.query<{
      id: string
      accountId: string
      workspaceId: string
      runId: string
      status: string
      estimatedMicros: string
      postedMicros: string
      reservedMicros: string
    }>(
      `
        select reservation.id, reservation.account_id as "accountId",
               reservation.workspace_id as "workspaceId", call.run_id as "runId",
               reservation.status, reservation.estimated_micros as "estimatedMicros",
               account.posted_balance_micros as "postedMicros",
               account.reserved_balance_micros as "reservedMicros"
        from credit_reservation reservation
        join muses_agent_model_call call on call.id = reservation.agent_model_call_id
        join credit_account account on account.id = reservation.account_id
        where reservation.agent_model_call_id = $1
        for update of reservation, account
      `,
      [callId]
    )
  ).rows[0]
  if (!reservation || reservation.status !== "active") return

  const released = BigInt(reservation.estimatedMicros)
  const reserved = BigInt(reservation.reservedMicros) - released
  await insertAgentLedgerEntry(client, {
    accountId: reservation.accountId,
    workspaceId: reservation.workspaceId,
    reservationId: reservation.id,
    runId: reservation.runId,
    callId,
    kind: "release",
    balanceDeltaMicros: ZERO,
    reservedDeltaMicros: -released,
    balanceAfterMicros: BigInt(reservation.postedMicros),
    reservedAfterMicros: reserved,
    idempotencyKey: `release:agent-model:${callId}`,
    reason: "Rejected Agent model call reservation released",
  })
  await client.query(
    `update credit_account
     set reserved_balance_micros = $2, updated_at = now()
     where id = $1`,
    [reservation.accountId, reserved.toString()]
  )
  await client.query(
    `update credit_reservation
     set status = 'released', settled_micros = 0,
         failure_reason = $2, finalized_at = now()
     where id = $1 and status = 'active'`,
    [reservation.id, failureCode]
  )
}

async function markCallAmbiguous(
  client: PoolClient,
  callId: string,
  attemptId: string,
  failureCode: string
) {
  await client.query(
    `
      update muses_agent_model_call
      set status = 'ambiguous', failure_code = $3, completed_at = now(), updated_at = now()
      where id = $1 and attempt_id = $2 and status = 'calling'
    `,
    [callId, attemptId, failureCode]
  )
  await client.query(
    `
      update credit_reservation
      set status = 'review_required', failure_reason = $2
      where agent_model_call_id = $1 and status = 'active'
    `,
    [callId, failureCode]
  )
}

async function insertAgentLedgerEntry(
  client: PoolClient,
  input: {
    accountId: string
    workspaceId: string
    reservationId: string
    runId: string
    callId: string
    kind: "reserve" | "settle" | "release"
    balanceDeltaMicros: bigint
    reservedDeltaMicros: bigint
    balanceAfterMicros: bigint
    reservedAfterMicros: bigint
    idempotencyKey: string
    actorUserId?: string
    reason: string
    metadata?: unknown
  }
) {
  await client.query(
    `
      insert into credit_ledger_entry (
        id, account_id, workspace_id, kind, balance_delta_micros,
        reserved_delta_micros, balance_after_micros, reserved_after_micros,
        reservation_id, agent_run_id, agent_model_call_id, idempotency_key,
        actor_user_id, reason, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      on conflict (account_id, idempotency_key) do nothing
    `,
    [
      prefixedId("mle"),
      input.accountId,
      input.workspaceId,
      input.kind,
      input.balanceDeltaMicros.toString(),
      input.reservedDeltaMicros.toString(),
      input.balanceAfterMicros.toString(),
      input.reservedAfterMicros.toString(),
      input.reservationId,
      input.runId,
      input.callId,
      input.idempotencyKey,
      input.actorUserId || null,
      input.reason,
      JSON.stringify(input.metadata || {}),
    ]
  )
}

const modelResultSchema = z.object({
  content: z.string(),
  finishReason: z.enum(["stop", "tool-calls"]),
  toolCalls: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
    })
  ),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    creditMicros: z.string().regex(/^\d+$/),
  }),
  plan: z
    .object({
      goal: z.string(),
      steps: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.enum([
            "pending",
            "in-progress",
            "completed",
            "blocked",
            "cancelled",
          ]),
          dependsOn: z.array(z.string()),
          evidenceRefs: z.array(z.string()),
        })
      ),
    })
    .optional(),
})

function parseModelResult(value: unknown): AgentModelResult {
  const parsed = modelResultSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error("Persisted Agent model result is invalid.")
  }
  return parsed.data
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`
}

function stringMetadata(metadata: Readonly<Record<string, unknown>>, key: string) {
  const value = metadata[key]
  return typeof value === "string" && value ? value : undefined
}

function createAttemptId() {
  return `amac_${randomUUID().replaceAll("-", "")}`
}

function prefixedId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`
}
