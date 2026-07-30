import { randomUUID } from "node:crypto"

import type { Pool, PoolClient } from "pg"

import {
  AgentDelegationRuntimeError,
  type AgentDelegationRunSnapshot,
} from "@muses/agent-core"

import { getPgPool } from "./database"

export type AgentDelegationDriverClaim =
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
  | { state: "terminal"; status: AgentDelegationRunSnapshot["status"] }

export type AgentDelegationDriverReclaim =
  | AgentDelegationDriverClaim
  | { state: "changed" }

type DriverRow = {
  status: AgentDelegationRunSnapshot["status"]
  driverStatus:
    | "unclaimed"
    | "starting"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
  driverRunId: string | null
  driverAttemptId: string | null
  driverLeaseExpiresAt: Date | string | null
}

export const AGENT_DELEGATION_DRIVER_LEASE_MS = 30_000

export class PostgresAgentDelegationDriverStore {
  constructor(private readonly pool: Pool = getPgPool()) {}

  async inspect(delegationRunId: string) {
    const row = await this.read(delegationRunId)
    return row
      ? {
          status: row.driverStatus,
          runId: row.driverRunId,
          attemptId: row.driverAttemptId,
          leaseExpiresAt: iso(row.driverLeaseExpiresAt),
        }
      : null
  }

  async claim(delegationRunId: string): Promise<AgentDelegationDriverClaim> {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const row = await this.readForUpdate(client, delegationRunId)
      if (!row) throw delegationNotFound()
      if (isTerminal(row.status)) {
        await client.query("commit")
        return { state: "terminal", status: row.status }
      }
      const leaseExpiresAt = iso(row.driverLeaseExpiresAt)
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
      const claim = await this.writeClaim(client, delegationRunId)
      await client.query("commit")
      return claim
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async reclaim(
    delegationRunId: string,
    expectedAttemptId: string,
    expectedDriverRunId: string
  ): Promise<AgentDelegationDriverReclaim> {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const row = await this.readForUpdate(client, delegationRunId)
      if (!row) throw delegationNotFound()
      if (
        row.driverAttemptId !== expectedAttemptId ||
        row.driverRunId !== expectedDriverRunId
      ) {
        await client.query("commit")
        return { state: "changed" }
      }
      if (isTerminal(row.status)) {
        await client.query("commit")
        return { state: "terminal", status: row.status }
      }
      const claim = await this.writeClaim(client, delegationRunId)
      await client.query("commit")
      return claim
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async attach(
    delegationRunId: string,
    attemptId: string,
    driverRunId: string
  ) {
    const leaseExpiresAt = leaseExpiration()
    const result = await this.pool.query(
      `
        update muses_agent_delegation_run
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
      [delegationRunId, attemptId, driverRunId, leaseExpiresAt]
    )
    return result.rowCount === 1
  }

  async renew(
    delegationRunId: string,
    attemptId: string,
    driverRunId: string
  ) {
    const leaseExpiresAt = leaseExpiration()
    const result = await this.pool.query(
      `
        update muses_agent_delegation_run
        set driver_lease_expires_at = $4,
            driver_last_heartbeat_at = now(),
            updated_at = now()
        where id = $1
          and driver_attempt_id = $2
          and driver_run_id = $3
          and driver_status = 'running'
      `,
      [delegationRunId, attemptId, driverRunId, leaseExpiresAt]
    )
    return result.rowCount === 1 ? leaseExpiresAt : null
  }

  async release(delegationRunId: string, attemptId: string) {
    const result = await this.pool.query(
      `
        update muses_agent_delegation_run
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
      [delegationRunId, attemptId]
    )
    return result.rowCount === 1
  }

  async finish(
    delegationRunId: string,
    attemptId: string,
    driverRunId: string,
    status: "completed" | "failed" | "cancelled"
  ) {
    const result = await this.pool.query(
      `
        update muses_agent_delegation_run
        set driver_status = $4,
            driver_lease_expires_at = null,
            driver_last_heartbeat_at = now(),
            updated_at = now()
        where id = $1
          and driver_attempt_id = $2
          and driver_run_id = $3
          and driver_status = 'running'
      `,
      [delegationRunId, attemptId, driverRunId, status]
    )
    return result.rowCount === 1
  }

  private async read(delegationRunId: string) {
    return (
      await this.pool.query<DriverRow>(
        `select ${driverColumns}
         from muses_agent_delegation_run
         where id = $1`,
        [delegationRunId]
      )
    ).rows[0]
  }

  private async readForUpdate(client: PoolClient, delegationRunId: string) {
    return (
      await client.query<DriverRow>(
        `select ${driverColumns}
         from muses_agent_delegation_run
         where id = $1
         for update`,
        [delegationRunId]
      )
    ).rows[0]
  }

  private async writeClaim(client: PoolClient, delegationRunId: string) {
    const attemptId = `ddriver_${randomUUID().replaceAll("-", "")}`
    const leaseExpiresAt = leaseExpiration()
    await client.query(
      `
        update muses_agent_delegation_run
        set driver_status = 'starting',
            driver_run_id = null,
            driver_attempt_id = $2,
            driver_lease_expires_at = $3,
            driver_last_heartbeat_at = now(),
            updated_at = now()
        where id = $1
      `,
      [delegationRunId, attemptId, leaseExpiresAt]
    )
    return { state: "claimed" as const, attemptId, leaseExpiresAt }
  }
}

const driverColumns = `
  status,
  driver_status as "driverStatus",
  driver_run_id as "driverRunId",
  driver_attempt_id as "driverAttemptId",
  driver_lease_expires_at as "driverLeaseExpiresAt"
`

function leaseExpiration() {
  return new Date(Date.now() + AGENT_DELEGATION_DRIVER_LEASE_MS).toISOString()
}

function iso(value: Date | string | null) {
  if (!value) return null
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function isTerminal(status: AgentDelegationRunSnapshot["status"]) {
  return (
    status === "completed" ||
    status === "completed-with-failures" ||
    status === "failed" ||
    status === "cancelled"
  )
}

function delegationNotFound() {
  return new AgentDelegationRuntimeError(
    "delegation-not-found",
    "Delegation run was not found."
  )
}
