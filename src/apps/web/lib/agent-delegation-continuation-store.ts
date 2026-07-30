import { randomUUID } from "node:crypto"

import type { Pool, PoolClient } from "pg"

import type { AgentDelegationRunSnapshot } from "@muses/agent-core"

import { getPgPool } from "./database"

export const AGENT_DELEGATION_CONTINUATION_LEASE_MS = 60_000

export type AgentDelegationContinuationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "skipped"
  | "failed"

export type AgentDelegationContinuationProjection = {
  schemaVersion: "0.1.0-draft"
  kind: "agent-delegation-terminal"
  delegationRunId: string
  status: Extract<
    AgentDelegationRunSnapshot["status"],
    "completed" | "completed-with-failures" | "failed" | "cancelled"
  >
  failureCode?: string
  tasks: Array<{
    taskId: string
    status: string
    profile: { profileId: string; version: string }
    artifactRefs: string[]
    failureCode?: string
  }>
  artifactRefs: string[]
}

export type AgentDelegationContinuationIdentity = {
  delegationRunId: string
  workspaceId: string
  projectId: string
  sessionId: string
  rootRunId: string
  parentRunId: string
  terminalStatus: AgentDelegationContinuationProjection["status"]
  projectionFingerprint: string
  projection: AgentDelegationContinuationProjection
  messageId: string
  messageCreatedAt: string
}

export type AgentDelegationContinuationReceipt =
  AgentDelegationContinuationIdentity & {
    status: AgentDelegationContinuationStatus
    attemptId: string | null
    leaseExpiresAt: string | null
    messageCommittedAt: string | null
    parentDriver: unknown
    failureCode: string | null
    completedAt: string | null
  }

export type AgentDelegationContinuationClaim =
  | { state: "claimed"; receipt: AgentDelegationContinuationReceipt }
  | {
      state: "in-progress"
      attemptId: string
      leaseExpiresAt: string
    }
  | {
      state: "terminal"
      receipt: AgentDelegationContinuationReceipt
    }

type ContinuationRow = {
  delegationRunId: string
  workspaceId: string
  projectId: string
  sessionId: string
  rootRunId: string
  parentRunId: string
  terminalStatus: AgentDelegationContinuationProjection["status"]
  projectionFingerprint: string
  projection: AgentDelegationContinuationProjection
  messageId: string
  messageCreatedAt: Date | string
  status: AgentDelegationContinuationStatus
  attemptId: string | null
  leaseExpiresAt: Date | string | null
  messageCommittedAt: Date | string | null
  parentDriver: unknown
  failureCode: string | null
  completedAt: Date | string | null
}

export class PostgresAgentDelegationContinuationStore {
  constructor(private readonly pool: Pool = getPgPool()) {}

  async inspect(delegationRunId: string) {
    const row = await this.read(delegationRunId)
    return row ? toReceipt(row) : null
  }

  async claim(
    input: AgentDelegationContinuationIdentity
  ): Promise<AgentDelegationContinuationClaim> {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      await client.query(
        `
          insert into muses_agent_delegation_continuation (
            delegation_run_id, workspace_id, project_id, session_id,
            root_run_id, parent_run_id, terminal_status,
            projection_fingerprint, projection, message_id, message_created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          on conflict (delegation_run_id) do nothing
        `,
        [
          input.delegationRunId,
          input.workspaceId,
          input.projectId,
          input.sessionId,
          input.rootRunId,
          input.parentRunId,
          input.terminalStatus,
          input.projectionFingerprint,
          JSON.stringify(input.projection),
          input.messageId,
          input.messageCreatedAt,
        ]
      )
      const row = await this.readForUpdate(client, input.delegationRunId)
      if (!row) throw new Error("Delegation continuation receipt was not found.")
      assertIdentity(row, input)
      if (isTerminalReceipt(row.status)) {
        await client.query("commit")
        return { state: "terminal", receipt: toReceipt(row) }
      }
      const leaseExpiresAt = iso(row.leaseExpiresAt)
      if (
        row.status === "processing" &&
        row.attemptId &&
        leaseExpiresAt &&
        Date.parse(leaseExpiresAt) > Date.now()
      ) {
        await client.query("commit")
        return {
          state: "in-progress",
          attemptId: row.attemptId,
          leaseExpiresAt,
        }
      }
      const attemptId = `acont_${randomUUID().replaceAll("-", "")}`
      const nextLease = new Date(
        Date.now() + AGENT_DELEGATION_CONTINUATION_LEASE_MS
      ).toISOString()
      const claimed = (
        await client.query<ContinuationRow>(
          `
            update muses_agent_delegation_continuation
            set status = 'processing', attempt_id = $2, lease_expires_at = $3,
                failure_code = null, updated_at = now()
            where delegation_run_id = $1
            returning ${continuationColumns}
          `,
          [input.delegationRunId, attemptId, nextLease]
        )
      ).rows[0]
      if (!claimed) throw new Error("Delegation continuation could not be claimed.")
      await client.query("commit")
      return { state: "claimed", receipt: toReceipt(claimed) }
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async markMessageCommitted(delegationRunId: string, attemptId: string) {
    const result = await this.pool.query(
      `
        update muses_agent_delegation_continuation
        set message_committed_at = coalesce(message_committed_at, now()),
            updated_at = now()
        where delegation_run_id = $1 and attempt_id = $2
          and status = 'processing'
      `,
      [delegationRunId, attemptId]
    )
    if (result.rowCount !== 1) throw continuationOwnershipLost()
  }

  async complete(
    delegationRunId: string,
    attemptId: string,
    parentDriver: unknown
  ) {
    return this.finish(
      delegationRunId,
      attemptId,
      "completed",
      null,
      parentDriver
    )
  }

  async skip(delegationRunId: string, attemptId: string, failureCode: string) {
    return this.finish(
      delegationRunId,
      attemptId,
      "skipped",
      failureCode,
      null
    )
  }

  async fail(delegationRunId: string, attemptId: string, failureCode: string) {
    return this.finish(
      delegationRunId,
      attemptId,
      "failed",
      failureCode,
      null
    )
  }

  async release(delegationRunId: string, attemptId: string, failureCode: string) {
    const result = await this.pool.query(
      `
        update muses_agent_delegation_continuation
        set status = 'pending', attempt_id = null, lease_expires_at = null,
            failure_code = $3, updated_at = now()
        where delegation_run_id = $1 and attempt_id = $2
          and status = 'processing'
      `,
      [delegationRunId, attemptId, failureCode]
    )
    return result.rowCount === 1
  }

  private async finish(
    delegationRunId: string,
    attemptId: string,
    status: Extract<AgentDelegationContinuationStatus, "completed" | "skipped" | "failed">,
    failureCode: string | null,
    parentDriver: unknown
  ) {
    const row = (
      await this.pool.query<ContinuationRow>(
        `
          update muses_agent_delegation_continuation
          set status = $3, attempt_id = null, lease_expires_at = null,
              parent_driver = $4, failure_code = $5,
              completed_at = now(), updated_at = now()
          where delegation_run_id = $1 and attempt_id = $2
            and status = 'processing'
          returning ${continuationColumns}
        `,
        [
          delegationRunId,
          attemptId,
          status,
          parentDriver === undefined ? null : JSON.stringify(parentDriver),
          failureCode,
        ]
      )
    ).rows[0]
    if (!row) throw continuationOwnershipLost()
    return toReceipt(row)
  }

  private async read(delegationRunId: string) {
    return (
      await this.pool.query<ContinuationRow>(
        `select ${continuationColumns}
         from muses_agent_delegation_continuation
         where delegation_run_id = $1`,
        [delegationRunId]
      )
    ).rows[0]
  }

  private async readForUpdate(client: PoolClient, delegationRunId: string) {
    return (
      await client.query<ContinuationRow>(
        `select ${continuationColumns}
         from muses_agent_delegation_continuation
         where delegation_run_id = $1
         for update`,
        [delegationRunId]
      )
    ).rows[0]
  }
}

const continuationColumns = `
  delegation_run_id as "delegationRunId",
  workspace_id as "workspaceId",
  project_id as "projectId",
  session_id as "sessionId",
  root_run_id as "rootRunId",
  parent_run_id as "parentRunId",
  terminal_status as "terminalStatus",
  projection_fingerprint as "projectionFingerprint",
  projection,
  message_id as "messageId",
  message_created_at as "messageCreatedAt",
  status,
  attempt_id as "attemptId",
  lease_expires_at as "leaseExpiresAt",
  message_committed_at as "messageCommittedAt",
  parent_driver as "parentDriver",
  failure_code as "failureCode",
  completed_at as "completedAt"
`

function assertIdentity(
  row: ContinuationRow,
  input: AgentDelegationContinuationIdentity
) {
  if (
    row.delegationRunId !== input.delegationRunId ||
    row.workspaceId !== input.workspaceId ||
    row.projectId !== input.projectId ||
    row.sessionId !== input.sessionId ||
    row.rootRunId !== input.rootRunId ||
    row.parentRunId !== input.parentRunId ||
    row.terminalStatus !== input.terminalStatus ||
    row.projectionFingerprint !== input.projectionFingerprint ||
    row.messageId !== input.messageId ||
    iso(row.messageCreatedAt) !== new Date(input.messageCreatedAt).toISOString()
  ) {
    throw new Error(
      "Delegation continuation already has a different immutable identity."
    )
  }
}

function toReceipt(row: ContinuationRow): AgentDelegationContinuationReceipt {
  return {
    delegationRunId: row.delegationRunId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    rootRunId: row.rootRunId,
    parentRunId: row.parentRunId,
    terminalStatus: row.terminalStatus,
    projectionFingerprint: row.projectionFingerprint,
    projection: structuredClone(row.projection),
    messageId: row.messageId,
    messageCreatedAt: iso(row.messageCreatedAt)!,
    status: row.status,
    attemptId: row.attemptId,
    leaseExpiresAt: iso(row.leaseExpiresAt),
    messageCommittedAt: iso(row.messageCommittedAt),
    parentDriver: structuredClone(row.parentDriver),
    failureCode: row.failureCode,
    completedAt: iso(row.completedAt),
  }
}

function iso(value: Date | string | null) {
  if (!value) return null
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function isTerminalReceipt(status: AgentDelegationContinuationStatus) {
  return status === "completed" || status === "skipped" || status === "failed"
}

function continuationOwnershipLost() {
  return new Error("Delegation continuation ownership changed during execution.")
}
