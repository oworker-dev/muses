import type { Pool } from "pg"

import type { AgentDelegationRecord } from "@muses/agent-core"

import { getPgPool } from "./database"

export async function authorizeAgentDelegationExecution(input: {
  readonly workspaceId: string
  readonly projectId: string
  readonly sessionId: string
  readonly rootRunId: string
  readonly delegationRunId: string
  readonly pool?: Pool
}) {
  const result = await (input.pool || getPgPool()).query<{
    status: string
    record: AgentDelegationRecord
  }>(
    `
      select status, record
      from muses_agent_delegation_run
      where id = $1 and workspace_id = $2 and project_id = $3
        and session_id = $4 and root_run_id = $5
      limit 1
    `,
    [
      input.delegationRunId,
      input.workspaceId,
      input.projectId,
      input.sessionId,
      input.rootRunId,
    ]
  )
  const row = result.rows[0]
  if (!row) return null
  if (
    row.record.snapshot.delegationRunId !== input.delegationRunId ||
    row.record.snapshot.status !== row.status ||
    row.record.plan.workspaceId !== input.workspaceId ||
    row.record.plan.projectId !== input.projectId ||
    row.record.plan.sessionId !== input.sessionId ||
    row.record.plan.rootRunId !== input.rootRunId
  ) {
    throw new Error("Persisted Agent delegation scope is inconsistent.")
  }
  return row.record
}
