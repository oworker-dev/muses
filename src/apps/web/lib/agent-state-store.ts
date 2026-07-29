import { randomUUID } from "node:crypto"

import type { Pool, PoolClient } from "pg"

import {
  AGENT_CORE_SCHEMA_VERSION,
  AgentRuntimeError,
  RandomAgentIdPort,
  type AgentEvent,
  type AgentEventDraft,
  type AgentIdPort,
  type AgentRunSnapshot,
  type AgentStateStorePort,
} from "@muses/agent-core"

import { getPgPool } from "@/lib/database"

type AgentRunRow = {
  snapshot: AgentRunSnapshot
  revision: number
  driverStatus: AgentDriverStatus
  driverRunId: string | null
  driverAttemptId: string | null
  driverLeaseExpiresAt: Date | string | null
}

type AgentEventRow = {
  eventId: string
  runId: string
  sequence: number
  schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION
  type: AgentEvent["type"]
  data: Readonly<Record<string, unknown>>
  createdAt: Date | string
}

export type AgentDriverStatus =
  | "unclaimed"
  | "starting"
  | "running"
  | "completed"
  | "failed"

export type AgentDriverClaim =
  | { state: "claimed"; attemptId: string; leaseExpiresAt: string }
  | {
      state: "attached"
      attemptId: string
      driverRunId: string
      leaseExpiresAt: string
    }
  | { state: "in-progress"; attemptId: string; leaseExpiresAt: string }
  | {
      state: "stale-attached"
      attemptId: string
      driverRunId: string
    }
  | {
      state: "suspended"
      status: "waiting-approval" | "waiting-input"
    }
  | { state: "terminal"; status: AgentRunSnapshot["status"] }

export type AgentDriverReclaim = AgentDriverClaim | { state: "changed" }

export const AGENT_DRIVER_LEASE_MS = 30_000

export class PostgresAgentStateStore implements AgentStateStorePort {
  private readonly pool: Pool
  private readonly ids: AgentIdPort

  constructor(options: { pool?: Pool; ids?: AgentIdPort } = {}) {
    this.pool = options.pool || getPgPool()
    this.ids = options.ids || new RandomAgentIdPort()
  }

  async create(snapshot: AgentRunSnapshot, drafts: readonly AgentEventDraft[]) {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const inserted = await client.query(
        `
          insert into muses_agent_run (
            id,
            workspace_id,
            project_id,
            canvas_id,
            session_id,
            profile_id,
            profile_version,
            model_ref,
            status,
            revision,
            snapshot,
            created_at,
            updated_at,
            completed_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          on conflict (id) do nothing
        `,
        [
          snapshot.runId,
          snapshot.session.workspaceId,
          snapshot.session.projectId,
          snapshot.session.canvasId || null,
          snapshot.session.sessionId,
          snapshot.profile.profileId,
          snapshot.profile.version,
          snapshot.profile.modelRef,
          snapshot.status,
          snapshot.revision,
          JSON.stringify(snapshot),
          snapshot.createdAt,
          snapshot.updatedAt,
          snapshot.completedAt || null,
        ]
      )
      if (inserted.rowCount !== 1) {
        throw new AgentRuntimeError(
          "revision-conflict",
          `AgentRun "${snapshot.runId}" already exists.`
        )
      }
      await insertEvents(client, this.ids, snapshot.runId, 0, drafts)
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async read(runId: string) {
    const result = await this.pool.query<AgentRunRow>(
      `select snapshot, revision from muses_agent_run where id = $1 limit 1`,
      [runId]
    )
    const row = result.rows[0]
    return row ? cloneSnapshot(row.snapshot) : null
  }

  async commit(input: {
    readonly runId: string
    readonly expectedRevision: number
    readonly snapshot: AgentRunSnapshot
    readonly events: readonly AgentEventDraft[]
  }) {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const current = (
        await client.query<AgentRunRow>(
          `
            select snapshot, revision
            from muses_agent_run
            where id = $1
            for update
          `,
          [input.runId]
        )
      ).rows[0]
      if (!current) {
        throw new AgentRuntimeError("run-not-found", "AgentRun was not found.")
      }
      if (current.revision !== input.expectedRevision) {
        throw new AgentRuntimeError(
          "revision-conflict",
          `Expected AgentRun revision ${input.expectedRevision}; current revision is ${current.revision}.`
        )
      }
      if (
        input.snapshot.runId !== input.runId ||
        input.snapshot.revision !== input.expectedRevision + 1
      ) {
        throw new AgentRuntimeError(
          "revision-conflict",
          "The committed AgentRun snapshot does not advance the expected revision."
        )
      }
      const sequence = Number(
        (
          await client.query<{ sequence: string | number }>(
            `
              select coalesce(max(sequence), 0) as sequence
              from muses_agent_event
              where run_id = $1
            `,
            [input.runId]
          )
        ).rows[0]?.sequence || 0
      )
      await insertEvents(client, this.ids, input.runId, sequence, input.events)
      const updated = await client.query(
        `
          update muses_agent_run
          set status = $3,
              revision = $4,
              snapshot = $5,
              updated_at = $6,
              completed_at = $7
          where id = $1 and revision = $2
        `,
        [
          input.runId,
          input.expectedRevision,
          input.snapshot.status,
          input.snapshot.revision,
          JSON.stringify(input.snapshot),
          input.snapshot.updatedAt,
          input.snapshot.completedAt || null,
        ]
      )
      if (updated.rowCount !== 1) {
        throw new AgentRuntimeError(
          "revision-conflict",
          "AgentRun changed while its checkpoint was being committed."
        )
      }
      await client.query("commit")
      return cloneSnapshot(input.snapshot)
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async readEvents(runId: string, afterSequence = 0) {
    if (!(await this.read(runId))) {
      throw new AgentRuntimeError("run-not-found", "AgentRun was not found.")
    }
    const result = await this.pool.query<AgentEventRow>(
      `
        select
          event_id as "eventId",
          run_id as "runId",
          sequence,
          schema_version as "schemaVersion",
          type,
          data,
          created_at as "createdAt"
        from muses_agent_event
        where run_id = $1 and sequence > $2
        order by sequence
      `,
      [runId, afterSequence]
    )
    return result.rows.map(toAgentEvent)
  }

  async *stream(runId: string, afterSequence = 0): AsyncIterable<AgentEvent> {
    let cursor = afterSequence
    while (true) {
      const events = await this.readEvents(runId, cursor)
      for (const event of events) {
        cursor = event.sequence
        yield event
      }
      const run = await this.read(runId)
      if (!run) {
        throw new AgentRuntimeError("run-not-found", "AgentRun was not found.")
      }
      if (isTerminal(run.status)) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

export async function authorizeAgentRun(workspaceId: string, runId: string) {
  const result = await getPgPool().query<AgentRunRow>(
    `
      select
        snapshot,
        revision,
        driver_status as "driverStatus",
        driver_run_id as "driverRunId",
        driver_attempt_id as "driverAttemptId",
        driver_lease_expires_at as "driverLeaseExpiresAt"
      from muses_agent_run
      where workspace_id = $1 and id = $2
      limit 1
    `,
    [workspaceId, runId]
  )
  const row = result.rows[0]
  return row
    ? {
        snapshot: cloneSnapshot(row.snapshot),
        driverStatus: row.driverStatus,
        driverRunId: row.driverRunId,
        driverLeaseExpiresAt: toIsoString(row.driverLeaseExpiresAt),
      }
    : null
}

export async function claimAgentDriver(
  runId: string
): Promise<AgentDriverClaim> {
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const row = (
      await client.query<AgentRunRow>(
        `
          select
            snapshot,
            revision,
            driver_status as "driverStatus",
            driver_run_id as "driverRunId",
            driver_attempt_id as "driverAttemptId",
            driver_lease_expires_at as "driverLeaseExpiresAt"
          from muses_agent_run
          where id = $1
          for update
        `,
        [runId]
      )
    ).rows[0]
    if (!row) {
      throw new AgentRuntimeError("run-not-found", "AgentRun was not found.")
    }
    if (isTerminal(row.snapshot.status)) {
      await client.query("commit")
      return { state: "terminal", status: row.snapshot.status }
    }
    if (isSuspended(row.snapshot.status)) {
      await client.query("commit")
      return { state: "suspended", status: row.snapshot.status }
    }
    const leaseExpiresAt = toIsoString(row.driverLeaseExpiresAt)
    const activeLease =
      Boolean(row.driverAttemptId && leaseExpiresAt) &&
      Date.parse(leaseExpiresAt!) > Date.now()
    if (
      row.driverAttemptId &&
      row.driverRunId &&
      (row.driverStatus === "starting" || row.driverStatus === "running")
    ) {
      await client.query("commit")
      return activeLease
        ? {
            state: "attached",
            attemptId: row.driverAttemptId,
            driverRunId: row.driverRunId,
            leaseExpiresAt: leaseExpiresAt!,
          }
        : {
            state: "stale-attached",
            attemptId: row.driverAttemptId,
            driverRunId: row.driverRunId,
          }
    }
    if (row.driverStatus === "starting" && row.driverAttemptId && activeLease) {
      await client.query("commit")
      return {
        state: "in-progress",
        attemptId: row.driverAttemptId,
        leaseExpiresAt: leaseExpiresAt!,
      }
    }
    const claim = await writeAgentDriverClaim(client, runId)
    await client.query("commit")
    return claim
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function reclaimAgentDriver(
  runId: string,
  expectedAttemptId: string,
  expectedDriverRunId: string
): Promise<AgentDriverReclaim> {
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const row = (
      await client.query<AgentRunRow>(
        `
          select
            snapshot,
            revision,
            driver_status as "driverStatus",
            driver_run_id as "driverRunId",
            driver_attempt_id as "driverAttemptId",
            driver_lease_expires_at as "driverLeaseExpiresAt"
          from muses_agent_run
          where id = $1
          for update
        `,
        [runId]
      )
    ).rows[0]
    if (!row) {
      throw new AgentRuntimeError("run-not-found", "AgentRun was not found.")
    }
    if (
      row.driverAttemptId !== expectedAttemptId ||
      row.driverRunId !== expectedDriverRunId
    ) {
      await client.query("commit")
      return { state: "changed" }
    }
    if (isTerminal(row.snapshot.status)) {
      await client.query("commit")
      return { state: "terminal", status: row.snapshot.status }
    }
    if (isSuspended(row.snapshot.status)) {
      await client.query("commit")
      return { state: "suspended", status: row.snapshot.status }
    }
    const claim = await writeAgentDriverClaim(client, runId)
    await client.query("commit")
    return claim
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function attachAgentDriver(
  runId: string,
  attemptId: string,
  driverRunId: string
) {
  const leaseExpiresAt = createLeaseExpiration()
  const result = await getPgPool().query(
    `
      update muses_agent_run
      set driver_status = 'running',
          driver_run_id = $3,
          driver_lease_expires_at = $4,
          driver_last_heartbeat_at = now(),
          updated_at = now()
      where id = $1
        and driver_attempt_id = $2
        and driver_status in ('starting', 'running')
        and (driver_run_id is null or driver_run_id = $3)
    `,
    [runId, attemptId, driverRunId, leaseExpiresAt]
  )
  return result.rowCount === 1
}

export async function renewAgentDriverLease(
  runId: string,
  attemptId: string,
  driverRunId: string
) {
  const leaseExpiresAt = createLeaseExpiration()
  const result = await getPgPool().query(
    `
      update muses_agent_run
      set driver_lease_expires_at = $4,
          driver_last_heartbeat_at = now(),
          updated_at = now()
      where id = $1
        and driver_attempt_id = $2
        and driver_run_id = $3
        and driver_status = 'running'
    `,
    [runId, attemptId, driverRunId, leaseExpiresAt]
  )
  return result.rowCount === 1 ? leaseExpiresAt : null
}

export async function releaseAgentDriverClaim(
  runId: string,
  attemptId: string
) {
  const result = await getPgPool().query(
    `
      update muses_agent_run
      set driver_status = 'unclaimed',
          driver_run_id = null,
          driver_attempt_id = null,
          driver_lease_expires_at = null,
          driver_last_heartbeat_at = null,
          updated_at = now()
      where id = $1
        and driver_attempt_id = $2
        and driver_status = 'starting'
        and driver_run_id is null
    `,
    [runId, attemptId]
  )
  return result.rowCount === 1
}

export async function finishAgentDriver(
  runId: string,
  attemptId: string,
  driverRunId: string,
  status: "completed" | "failed"
) {
  const result = await getPgPool().query(
    `
      update muses_agent_run
      set driver_status = $4,
          driver_lease_expires_at = null,
          driver_last_heartbeat_at = now(),
          updated_at = now()
      where id = $1
        and driver_attempt_id = $2
        and driver_run_id = $3
        and driver_status = 'running'
    `,
    [runId, attemptId, driverRunId, status]
  )
  return result.rowCount === 1
}

async function writeAgentDriverClaim(client: PoolClient, runId: string) {
  const attemptId = `adriver_${randomUUID().replaceAll("-", "")}`
  const leaseExpiresAt = createLeaseExpiration()
  await client.query(
    `
      update muses_agent_run
      set driver_status = 'starting',
          driver_run_id = null,
          driver_attempt_id = $2,
          driver_lease_expires_at = $3,
          driver_last_heartbeat_at = now(),
          updated_at = now()
      where id = $1
    `,
    [runId, attemptId, leaseExpiresAt]
  )
  return {
    state: "claimed" as const,
    attemptId,
    leaseExpiresAt,
  }
}

function createLeaseExpiration() {
  return new Date(Date.now() + AGENT_DRIVER_LEASE_MS).toISOString()
}

function toIsoString(value: Date | string | null) {
  if (!value) return null
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

async function insertEvents(
  client: PoolClient,
  ids: AgentIdPort,
  runId: string,
  afterSequence: number,
  drafts: readonly AgentEventDraft[]
) {
  for (const [index, draft] of drafts.entries()) {
    await client.query(
      `
        insert into muses_agent_event (
          run_id,
          sequence,
          event_id,
          schema_version,
          type,
          data,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        runId,
        afterSequence + index + 1,
        ids.create("aevent"),
        AGENT_CORE_SCHEMA_VERSION,
        draft.type,
        JSON.stringify(draft.data),
        draft.createdAt,
      ]
    )
  }
}

function toAgentEvent(row: AgentEventRow): AgentEvent {
  return {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    eventId: row.eventId,
    runId: row.runId,
    sequence: Number(row.sequence),
    type: row.type,
    data: row.data,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
  }
}

function cloneSnapshot(snapshot: AgentRunSnapshot) {
  return structuredClone(snapshot)
}

function isTerminal(status: AgentRunSnapshot["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function isSuspended(
  status: AgentRunSnapshot["status"]
): status is "waiting-approval" | "waiting-input" {
  return status === "waiting-approval" || status === "waiting-input"
}
