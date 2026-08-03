import type { Pool, PoolClient } from "pg"

import { getPgPool } from "./database"

type WorkflowAgentRunMapping = {
  readonly workspaceId: string
  readonly workflowRunId: string
  readonly workflowNodeId: string
  readonly agentRunId: string
}

type WorkflowAgentRunPool = {
  connect(): Promise<Pick<PoolClient, "query" | "release">>
}

type WorkflowAgentRunQueryable = Pick<Pool, "query"> | Pick<PoolClient, "query">

export async function recordWorkflowAgentRun(
  mapping: WorkflowAgentRunMapping,
  pool: WorkflowAgentRunPool = getPgPool()
) {
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [mapping.workflowRunId]
    )
    const parent = await client.query<{
      status: string
      cancellationRequested: boolean
    }>(
      `
        select
          run.status,
          exists (
            select 1
            from workflow_run_cancel_receipt receipt
            where receipt.workspace_id = run.workspace_id
              and receipt.run_id = run.sdk_run_id
          ) as "cancellationRequested"
        from muses_workflow_run run
        where run.workspace_id = $1 and run.sdk_run_id = $2
        limit 1
      `,
      [mapping.workspaceId, mapping.workflowRunId]
    )
    const parentState = parent.rows[0]
    if (!parentState) {
      throw new Error(
        "Workflow AgentRun mapping requires an attached parent Workflow run."
      )
    }

    await client.query(
      `
        insert into muses_workflow_agent_run (
          workspace_id,
          workflow_run_id,
          workflow_node_id,
          agent_run_id
        )
        values ($1, $2, $3, $4)
        on conflict (workspace_id, workflow_run_id, workflow_node_id) do nothing
      `,
      [
        mapping.workspaceId,
        mapping.workflowRunId,
        mapping.workflowNodeId,
        mapping.agentRunId,
      ]
    )
    const persisted = await client.query<{ agentRunId: string }>(
      `
        select agent_run_id as "agentRunId"
        from muses_workflow_agent_run
        where workspace_id = $1
          and workflow_run_id = $2
          and workflow_node_id = $3
        limit 1
      `,
      [mapping.workspaceId, mapping.workflowRunId, mapping.workflowNodeId]
    )
    if (persisted.rows[0]?.agentRunId !== mapping.agentRunId) {
      throw new Error(
        "Workflow node is already mapped to a different AgentRun."
      )
    }
    await client.query("commit")
    return {
      shouldCancelAgentRun:
        parentState.cancellationRequested ||
        ["completed", "failed", "cancelled"].includes(parentState.status),
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function listWorkflowAgentRunIds(
  input: { readonly workspaceId: string; readonly workflowRunId: string },
  database: WorkflowAgentRunQueryable = getPgPool()
) {
  const result = await database.query<{ agentRunId: string }>(
    `
      select agent_run_id as "agentRunId"
      from muses_workflow_agent_run
      where workspace_id = $1 and workflow_run_id = $2
      order by created_at, workflow_node_id
    `,
    [input.workspaceId, input.workflowRunId]
  )
  return result.rows.map((row) => row.agentRunId)
}
