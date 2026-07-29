import { isDeepStrictEqual } from "node:util"

import type { Pool, PoolClient } from "pg"

import {
  AGENT_DELEGATION_SCHEMA_VERSION,
  AgentDelegationRuntimeError,
  RandomAgentIdPort,
  type AgentBudgetUsage,
  type AgentDelegationBudgetEnvelope,
  type AgentDelegationBudgetPort,
  type AgentDelegationEvent,
  type AgentDelegationEventDraft,
  type AgentDelegationRecord,
  type AgentDelegationStateStorePort,
  type AgentIdPort,
} from "@muses/agent-core"

import { getPgPool } from "@/lib/database"

type DelegationRow = {
  record: AgentDelegationRecord
  revision: number
}

type DelegationEventRow = {
  eventId: string
  delegationRunId: string
  sequence: number
  schemaVersion: typeof AGENT_DELEGATION_SCHEMA_VERSION
  type: AgentDelegationEvent["type"]
  data: Readonly<Record<string, unknown>>
  createdAt: Date | string
}

type BudgetReservationRow = {
  id: string
  delegationRunId: string
  workspaceId: string
  parentRunId: string
  parentReservationId: string | null
  taskId: string | null
  scope: "envelope" | "task"
  status: "active" | "settled" | "released" | "review_required"
  reservationIdempotencyKey: string
  finalizationIdempotencyKey: string | null
  limitSnapshot: AgentDelegationBudgetEnvelope
  usageSnapshot: AgentBudgetUsage | null
}

export class PostgresAgentDelegationStore implements AgentDelegationStateStorePort {
  private readonly pool: Pool
  private readonly ids: AgentIdPort

  constructor(options: { pool?: Pool; ids?: AgentIdPort } = {}) {
    this.pool = options.pool || getPgPool()
    this.ids = options.ids || new RandomAgentIdPort()
  }

  async create(
    record: AgentDelegationRecord,
    drafts: readonly AgentDelegationEventDraft[]
  ) {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const inserted = await client.query(
        `
          insert into muses_agent_delegation_run (
            id, workspace_id, project_id, session_id, root_run_id, parent_run_id,
            plan_id, plan_revision, idempotency_key, plan_fingerprint,
            authority_fingerprint, status, revision, record,
            created_at, updated_at, completed_at
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16, $17
          )
          on conflict (workspace_id, idempotency_key) do nothing
        `,
        [
          record.snapshot.delegationRunId,
          record.plan.workspaceId,
          record.plan.projectId,
          record.plan.sessionId,
          record.plan.rootRunId,
          record.plan.delegatedByRunId,
          record.plan.planId,
          record.plan.revision,
          record.submission.idempotencyKey,
          record.submission.planFingerprint,
          record.submission.authorityFingerprint,
          record.snapshot.status,
          record.snapshot.revision,
          JSON.stringify(record),
          record.snapshot.createdAt,
          record.snapshot.updatedAt,
          record.snapshot.completedAt || null,
        ]
      )
      if (inserted.rowCount === 1) {
        await insertEvents(
          client,
          this.ids,
          record.snapshot.delegationRunId,
          0,
          drafts
        )
        await client.query("commit")
        return { created: true, record: cloneRecord(record) }
      }
      const existing = (
        await client.query<DelegationRow>(
          `
            select record, revision
            from muses_agent_delegation_run
            where workspace_id = $1 and idempotency_key = $2
            for update
          `,
          [record.plan.workspaceId, record.submission.idempotencyKey]
        )
      ).rows[0]
      if (!existing) {
        throw new AgentDelegationRuntimeError(
          "delegation-revision-conflict",
          "Delegation submission conflicted but could not be reloaded."
        )
      }
      await client.query("commit")
      return { created: false, record: cloneRecord(existing.record) }
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async read(delegationRunId: string) {
    const row = (
      await this.pool.query<DelegationRow>(
        `select record, revision from muses_agent_delegation_run where id = $1`,
        [delegationRunId]
      )
    ).rows[0]
    return row ? cloneRecord(row.record) : null
  }

  async commit(input: Parameters<AgentDelegationStateStorePort["commit"]>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const current = (
        await client.query<DelegationRow>(
          `
            select record, revision
            from muses_agent_delegation_run
            where id = $1
            for update
          `,
          [input.delegationRunId]
        )
      ).rows[0]
      if (!current) {
        throw new AgentDelegationRuntimeError(
          "delegation-not-found",
          "Delegation run was not found."
        )
      }
      if (
        current.revision !== input.expectedRevision ||
        input.snapshot.revision !== input.expectedRevision + 1 ||
        input.snapshot.delegationRunId !== input.delegationRunId ||
        input.snapshot.planId !== current.record.snapshot.planId ||
        input.snapshot.planRevision !== current.record.snapshot.planRevision ||
        input.snapshot.rootRunId !== current.record.snapshot.rootRunId ||
        input.snapshot.parentRunId !== current.record.snapshot.parentRunId
      ) {
        throw new AgentDelegationRuntimeError(
          "delegation-revision-conflict",
          "Delegation run changed before commit."
        )
      }
      const sequence = Number(
        (
          await client.query<{ sequence: string | number }>(
            `
              select coalesce(max(sequence), 0) as sequence
              from muses_agent_delegation_event
              where delegation_run_id = $1
            `,
            [input.delegationRunId]
          )
        ).rows[0]?.sequence || 0
      )
      await insertEvents(
        client,
        this.ids,
        input.delegationRunId,
        sequence,
        input.events
      )
      const record = {
        ...current.record,
        snapshot: input.snapshot,
      }
      const updated = await client.query(
        `
          update muses_agent_delegation_run
          set status = $3,
              revision = $4,
              record = $5,
              updated_at = $6,
              completed_at = $7
          where id = $1 and revision = $2
        `,
        [
          input.delegationRunId,
          input.expectedRevision,
          input.snapshot.status,
          input.snapshot.revision,
          JSON.stringify(record),
          input.snapshot.updatedAt,
          input.snapshot.completedAt || null,
        ]
      )
      if (updated.rowCount !== 1) {
        throw new AgentDelegationRuntimeError(
          "delegation-revision-conflict",
          "Delegation run changed while its events were committed."
        )
      }
      await client.query("commit")
      return cloneRecord(record)
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async readEvents(delegationRunId: string, afterSequence = 0) {
    if (!(await this.read(delegationRunId))) {
      throw new AgentDelegationRuntimeError(
        "delegation-not-found",
        "Delegation run was not found."
      )
    }
    const rows = (
      await this.pool.query<DelegationEventRow>(
        `
          select event_id as "eventId",
                 delegation_run_id as "delegationRunId",
                 sequence,
                 schema_version as "schemaVersion",
                 type,
                 data,
                 created_at as "createdAt"
          from muses_agent_delegation_event
          where delegation_run_id = $1 and sequence > $2
          order by sequence
        `,
        [delegationRunId, afterSequence]
      )
    ).rows
    return rows.map((row) => ({
      ...row,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(row.createdAt).toISOString(),
    }))
  }
}

export class PostgresAgentDelegationBudget implements AgentDelegationBudgetPort {
  constructor(private readonly pool: Pool = getPgPool()) {}

  async reserveEnvelope(
    input: Parameters<AgentDelegationBudgetPort["reserveEnvelope"]>[0]
  ) {
    assertBudget(input.envelope, "Delegation budget envelope", false)
    assertBudget(input.remainingBudget, "Parent remaining budget", true)
    assertIdempotencyKey(input.idempotencyKey)
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      await lockDelegationScope(client, {
        delegationRunId: input.delegationRunId,
        parentRunId: input.parentRunId,
        workspaceId: input.workspaceId,
      })
      const existing = await readReservation(client, input.reservationId)
      if (existing) {
        assertReservation(existing, {
          delegationRunId: input.delegationRunId,
          workspaceId: input.workspaceId,
          parentRunId: input.parentRunId,
          parentReservationId: null,
          scope: "envelope",
          taskId: null,
          idempotencyKey: input.idempotencyKey,
          limit: input.envelope,
        })
        await client.query("commit")
        return
      }
      const active = (
        await client.query<BudgetReservationRow>(
          `
            select ${reservationSelect}
            from muses_agent_delegation_budget_reservation
            where workspace_id = $1 and parent_run_id = $2
              and scope = 'envelope' and status = 'active'
            for update
          `,
          [input.workspaceId, input.parentRunId]
        )
      ).rows
      const allocated = sumBudgets(
        active.map(({ limitSnapshot }) => limitSnapshot)
      )
      if (!fits(addBudgets(allocated, input.envelope), input.remainingBudget)) {
        throw new AgentDelegationRuntimeError(
          "delegation-state-invalid",
          "Concurrent delegations exceed the parent Run remaining budget."
        )
      }
      await client.query(
        `
          insert into muses_agent_delegation_budget_reservation (
            id, delegation_run_id, workspace_id, parent_run_id,
            scope, status, reservation_idempotency_key, limit_snapshot
          ) values ($1, $2, $3, $4, 'envelope', 'active', $5, $6)
        `,
        [
          input.reservationId,
          input.delegationRunId,
          input.workspaceId,
          input.parentRunId,
          input.idempotencyKey,
          JSON.stringify(input.envelope),
        ]
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async reserveTask(
    input: Parameters<AgentDelegationBudgetPort["reserveTask"]>[0]
  ) {
    assertBudget(input.budget, "Delegated task budget", false)
    assertIdempotencyKey(input.idempotencyKey)
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const envelope = await readReservation(
        client,
        input.envelopeReservationId,
        true
      )
      if (
        !envelope ||
        envelope.scope !== "envelope" ||
        envelope.delegationRunId !== input.delegationRunId ||
        envelope.workspaceId !== input.workspaceId ||
        envelope.status !== "active"
      ) {
        throw new AgentDelegationRuntimeError(
          "delegation-state-invalid",
          "Delegation envelope reservation is not active."
        )
      }
      const existing = await readReservation(client, input.reservationId)
      if (existing) {
        assertReservation(existing, {
          delegationRunId: input.delegationRunId,
          workspaceId: input.workspaceId,
          parentRunId: envelope.parentRunId,
          parentReservationId: input.envelopeReservationId,
          scope: "task",
          taskId: input.taskId,
          idempotencyKey: input.idempotencyKey,
          limit: input.budget,
        })
        await client.query("commit")
        return
      }
      const allocations = (
        await client.query<BudgetReservationRow>(
          `
            select ${reservationSelect}
            from muses_agent_delegation_budget_reservation
            where parent_reservation_id = $1
            for update
          `,
          [input.envelopeReservationId]
        )
      ).rows
      if (
        !fits(
          addBudgets(
            sumBudgets(allocations.map(({ limitSnapshot }) => limitSnapshot)),
            input.budget
          ),
          envelope.limitSnapshot
        )
      ) {
        throw new AgentDelegationRuntimeError(
          "delegation-state-invalid",
          "Task allocations exceed the delegation budget envelope."
        )
      }
      await client.query(
        `
          insert into muses_agent_delegation_budget_reservation (
            id, delegation_run_id, workspace_id, parent_run_id,
            parent_reservation_id, task_id, scope, status,
            reservation_idempotency_key, limit_snapshot
          ) values ($1, $2, $3, $4, $5, $6, 'task', 'active', $7, $8)
        `,
        [
          input.reservationId,
          input.delegationRunId,
          input.workspaceId,
          envelope.parentRunId,
          input.envelopeReservationId,
          input.taskId,
          input.idempotencyKey,
          JSON.stringify(input.budget),
        ]
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async finalizeTask(
    input: Parameters<AgentDelegationBudgetPort["finalizeTask"]>[0]
  ) {
    assertIdempotencyKey(input.idempotencyKey)
    await finalizeReservation(this.pool, {
      reservationId: input.reservationId,
      delegationRunId: input.delegationRunId,
      workspaceId: input.workspaceId,
      scope: "task",
      taskId: input.taskId,
      status: databaseBudgetStatus(input.outcome),
      usage: input.usage,
      idempotencyKey: input.idempotencyKey,
    })
  }

  async finalizeEnvelope(
    input: Parameters<AgentDelegationBudgetPort["finalizeEnvelope"]>[0]
  ) {
    assertIdempotencyKey(input.idempotencyKey)
    await finalizeReservation(this.pool, {
      reservationId: input.reservationId,
      delegationRunId: input.delegationRunId,
      workspaceId: input.workspaceId,
      scope: "envelope",
      taskId: null,
      status: databaseBudgetStatus(input.outcome),
      idempotencyKey: input.idempotencyKey,
    })
  }
}

async function insertEvents(
  client: PoolClient,
  ids: AgentIdPort,
  delegationRunId: string,
  currentSequence: number,
  drafts: readonly AgentDelegationEventDraft[]
) {
  for (const [index, draft] of drafts.entries()) {
    await client.query(
      `
        insert into muses_agent_delegation_event (
          delegation_run_id, sequence, event_id, schema_version,
          type, data, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        delegationRunId,
        currentSequence + index + 1,
        ids.create("delegation-event"),
        AGENT_DELEGATION_SCHEMA_VERSION,
        draft.type,
        JSON.stringify(draft.data),
        draft.createdAt,
      ]
    )
  }
}

async function lockDelegationScope(
  client: PoolClient,
  input: {
    delegationRunId: string
    parentRunId: string
    workspaceId: string
  }
) {
  const result = await client.query(
    `
      select delegation.id
      from muses_agent_delegation_run delegation
      join muses_agent_run parent
        on parent.id = delegation.parent_run_id
       and parent.workspace_id = delegation.workspace_id
       and parent.project_id = delegation.project_id
       and parent.session_id = delegation.session_id
      where delegation.id = $1
        and delegation.workspace_id = $2
        and delegation.parent_run_id = $3
      for update of delegation, parent
    `,
    [input.delegationRunId, input.workspaceId, input.parentRunId]
  )
  if (result.rowCount !== 1) {
    throw new AgentDelegationRuntimeError(
      "delegation-state-invalid",
      "Delegation budget scope does not match its authorized parent Run."
    )
  }
}

const reservationSelect = `
  id,
  delegation_run_id as "delegationRunId",
  workspace_id as "workspaceId",
  parent_run_id as "parentRunId",
  parent_reservation_id as "parentReservationId",
  task_id as "taskId",
  scope,
  status,
  reservation_idempotency_key as "reservationIdempotencyKey",
  finalization_idempotency_key as "finalizationIdempotencyKey",
  limit_snapshot as "limitSnapshot",
  usage_snapshot as "usageSnapshot"
`

async function readReservation(
  client: PoolClient,
  reservationId: string,
  lock = false
) {
  return (
    await client.query<BudgetReservationRow>(
      `
        select ${reservationSelect}
        from muses_agent_delegation_budget_reservation
        where id = $1
        ${lock ? "for update" : ""}
      `,
      [reservationId]
    )
  ).rows[0]
}

function assertReservation(
  existing: BudgetReservationRow,
  expected: {
    delegationRunId: string
    workspaceId: string
    parentRunId: string
    parentReservationId: string | null
    scope: "envelope" | "task"
    taskId: string | null
    idempotencyKey: string
    limit: AgentDelegationBudgetEnvelope
  }
) {
  if (
    existing.delegationRunId !== expected.delegationRunId ||
    existing.workspaceId !== expected.workspaceId ||
    existing.parentRunId !== expected.parentRunId ||
    existing.parentReservationId !== expected.parentReservationId ||
    existing.scope !== expected.scope ||
    existing.taskId !== expected.taskId ||
    existing.reservationIdempotencyKey !== expected.idempotencyKey ||
    !isDeepStrictEqual(existing.limitSnapshot, expected.limit)
  ) {
    throw new AgentDelegationRuntimeError(
      "delegation-idempotency-conflict",
      "Delegation budget reservation identity drifted."
    )
  }
}

async function finalizeReservation(
  pool: Pool,
  input: {
    reservationId: string
    delegationRunId: string
    workspaceId: string
    scope: "envelope" | "task"
    taskId: string | null
    status: "settled" | "released" | "review_required"
    usage?: AgentBudgetUsage
    idempotencyKey: string
  }
) {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const existing = await readReservation(client, input.reservationId, true)
    if (
      !existing ||
      existing.delegationRunId !== input.delegationRunId ||
      existing.workspaceId !== input.workspaceId ||
      existing.scope !== input.scope ||
      existing.taskId !== input.taskId
    ) {
      throw new AgentDelegationRuntimeError(
        "delegation-state-invalid",
        "Delegation budget reservation was not found in its expected scope."
      )
    }
    if (existing.status !== "active") {
      if (
        existing.status !== input.status ||
        existing.finalizationIdempotencyKey !== input.idempotencyKey ||
        !isDeepStrictEqual(existing.usageSnapshot, input.usage || null)
      ) {
        throw new AgentDelegationRuntimeError(
          "delegation-idempotency-conflict",
          "Delegation budget reservation already has another outcome."
        )
      }
      await client.query("commit")
      return
    }
    if (input.scope === "envelope") {
      const activeTasks = await client.query(
        `
          select 1
          from muses_agent_delegation_budget_reservation
          where parent_reservation_id = $1 and status = 'active'
          limit 1
        `,
        [input.reservationId]
      )
      if (activeTasks.rowCount !== 0) {
        throw new AgentDelegationRuntimeError(
          "delegation-state-invalid",
          "Delegation envelope cannot finalize while task allocations are active."
        )
      }
    }
    await client.query(
      `
        update muses_agent_delegation_budget_reservation
        set status = $2,
            usage_snapshot = $3,
            finalization_idempotency_key = $4,
            updated_at = now(),
            finalized_at = now()
        where id = $1 and status = 'active'
      `,
      [
        input.reservationId,
        input.status,
        input.usage ? JSON.stringify(input.usage) : null,
        input.idempotencyKey,
      ]
    )
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function databaseBudgetStatus(outcome: "settle" | "release" | "review") {
  if (outcome === "review") return "review_required" as const
  return outcome === "settle" ? ("settled" as const) : ("released" as const)
}

function sumBudgets(budgets: readonly AgentDelegationBudgetEnvelope[]) {
  return budgets.reduce(addBudgets, zeroBudget())
}

function addBudgets(
  left: AgentDelegationBudgetEnvelope,
  right: AgentDelegationBudgetEnvelope
): AgentDelegationBudgetEnvelope {
  return {
    maxTurns: safeAdd(left.maxTurns, right.maxTurns),
    maxModelCalls: safeAdd(left.maxModelCalls, right.maxModelCalls),
    maxToolCalls: safeAdd(left.maxToolCalls, right.maxToolCalls),
    maxInputTokens: safeAdd(left.maxInputTokens, right.maxInputTokens),
    maxOutputTokens: safeAdd(left.maxOutputTokens, right.maxOutputTokens),
    maxCreditMicros: (
      BigInt(left.maxCreditMicros) + BigInt(right.maxCreditMicros)
    ).toString(),
    maxDurationMs: safeAdd(left.maxDurationMs, right.maxDurationMs),
  }
}

function safeAdd(left: number, right: number) {
  const total = left + right
  if (!Number.isSafeInteger(total)) {
    throw new AgentDelegationRuntimeError(
      "delegation-state-invalid",
      "Delegation budget arithmetic exceeded safe integer bounds."
    )
  }
  return total
}

function assertBudget(
  budget: AgentDelegationBudgetEnvelope,
  label: string,
  allowZero: boolean
) {
  const minimum = allowZero ? 0 : 1
  const numeric = [
    budget.maxTurns,
    budget.maxModelCalls,
    budget.maxToolCalls,
    budget.maxInputTokens,
    budget.maxOutputTokens,
    budget.maxDurationMs,
  ]
  if (
    numeric.some((value) => !Number.isSafeInteger(value) || value < minimum) ||
    !/^\d+$/.test(budget.maxCreditMicros)
  ) {
    throw new AgentDelegationRuntimeError(
      "delegation-state-invalid",
      `${label} is malformed.`
    )
  }
}

function assertIdempotencyKey(value: string) {
  if (!value.trim()) {
    throw new AgentDelegationRuntimeError(
      "delegation-state-invalid",
      "Delegation budget operation requires an idempotency key."
    )
  }
}

function fits(
  requested: AgentDelegationBudgetEnvelope,
  available: AgentDelegationBudgetEnvelope
) {
  return (
    requested.maxTurns <= available.maxTurns &&
    requested.maxModelCalls <= available.maxModelCalls &&
    requested.maxToolCalls <= available.maxToolCalls &&
    requested.maxInputTokens <= available.maxInputTokens &&
    requested.maxOutputTokens <= available.maxOutputTokens &&
    BigInt(requested.maxCreditMicros) <= BigInt(available.maxCreditMicros) &&
    requested.maxDurationMs <= available.maxDurationMs
  )
}

function zeroBudget(): AgentDelegationBudgetEnvelope {
  return {
    maxTurns: 0,
    maxModelCalls: 0,
    maxToolCalls: 0,
    maxInputTokens: 0,
    maxOutputTokens: 0,
    maxCreditMicros: "0",
    maxDurationMs: 0,
  }
}

function cloneRecord(record: AgentDelegationRecord) {
  return structuredClone(record)
}
