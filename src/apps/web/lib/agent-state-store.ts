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
  | { state: "claimed" }
  | { state: "attached"; driverRunId: string }
  | { state: "in-progress" }
  | { state: "terminal"; status: AgentRunSnapshot["status"] }

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
        driver_run_id as "driverRunId"
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
      }
    : null
}

export async function claimAgentDriver(runId: string): Promise<AgentDriverClaim> {
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
            driver_run_id as "driverRunId"
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
    if (
      row.driverRunId &&
      (row.driverStatus === "starting" || row.driverStatus === "running")
    ) {
      await client.query("commit")
      return { state: "attached", driverRunId: row.driverRunId }
    }
    if (row.driverStatus === "starting") {
      await client.query("commit")
      return { state: "in-progress" }
    }
    await client.query(
      `
        update muses_agent_run
        set driver_status = 'starting', driver_run_id = null, updated_at = now()
        where id = $1
      `,
      [runId]
    )
    await client.query("commit")
    return { state: "claimed" }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function attachAgentDriver(runId: string, driverRunId: string) {
  const result = await getPgPool().query(
    `
      update muses_agent_run
      set driver_status = 'running', driver_run_id = $2, updated_at = now()
      where id = $1
        and driver_status = 'starting'
        and (driver_run_id is null or driver_run_id = $2)
    `,
    [runId, driverRunId]
  )
  if (result.rowCount !== 1) {
    throw new Error("AgentRun could not be attached to its Workflow SDK driver.")
  }
}

export async function releaseAgentDriverClaim(runId: string) {
  await getPgPool().query(
    `
      update muses_agent_run
      set driver_status = 'unclaimed', updated_at = now()
      where id = $1 and driver_status = 'starting' and driver_run_id is null
    `,
    [runId]
  )
}

export async function finishAgentDriver(
  runId: string,
  status: "completed" | "failed"
) {
  await getPgPool().query(
    `update muses_agent_run set driver_status = $2, updated_at = now() where id = $1`,
    [runId, status]
  )
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
