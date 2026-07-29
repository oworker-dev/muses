import type { Pool } from "pg"

import type { AgentDelegationRecord, AgentRunSnapshot } from "@muses/agent-core"

import { getPgPool } from "./database"

type DelegationActivityRow = {
  delegationRunId: string
  status: string
  record: AgentDelegationRecord
}

type ChildApprovalRow = {
  runId: string
  snapshot: AgentRunSnapshot
}

export type AgentDelegationActivityProjection = {
  rootRunId: string
  active: boolean
  runs: Array<{
    delegationRunId: string
    status: string
    failureMode: "fail-fast" | "isolate"
    tasks: Array<{
      taskId: string
      objective: string
      status: string
      childRunId?: string
      profile: { profileId: string; version: string }
      artifactRefs: readonly string[]
    }>
  }>
  approvals: Array<{
    runId: string
    taskId: string
    profile: { profileId: string; version: string }
    approvalId: string
    reason: string
    requestedAt: string
    toolCall: {
      name: string
      input: Readonly<Record<string, unknown>>
    }
  }>
}

export async function readAgentDelegationActivity(input: {
  workspaceId: string
  run: AgentRunSnapshot
  pool?: Pool
}): Promise<AgentDelegationActivityProjection> {
  if (input.run.session.workspaceId !== input.workspaceId) {
    throw new Error(
      "Agent delegation activity scope does not match its authorized Run."
    )
  }
  const pool = input.pool || getPgPool()
  const rootRunId = input.run.parent?.rootRunId || input.run.runId
  const scope = [
    input.workspaceId,
    input.run.session.projectId,
    input.run.session.sessionId,
    rootRunId,
  ]
  const [delegationsResult, childApprovalsResult] = await Promise.all([
    pool.query<DelegationActivityRow>(
      `
        select id as "delegationRunId", status, record
        from muses_agent_delegation_run
        where workspace_id = $1 and project_id = $2 and session_id = $3
          and root_run_id = $4
        order by created_at, id
      `,
      scope
    ),
    pool.query<ChildApprovalRow>(
      `
        select id as "runId", snapshot
        from muses_agent_run
        where workspace_id = $1 and project_id = $2 and session_id = $3
          and snapshot #>> '{parent,rootRunId}' = $4
          and status = 'waiting-approval'
        order by created_at, id
      `,
      scope
    ),
  ])
  const runs = delegationsResult.rows.map(
    ({ delegationRunId, status, record }) => {
      if (
        record.snapshot.delegationRunId !== delegationRunId ||
        record.snapshot.status !== status
      ) {
        throw new Error("Persisted Agent delegation activity is inconsistent.")
      }
      const tasksById = new Map(
        record.plan.tasks.map((task) => [task.taskId, task])
      )
      return {
        delegationRunId,
        status,
        failureMode: record.snapshot.failureMode,
        tasks: record.snapshot.tasks.map((task) => {
          const planned = tasksById.get(task.taskId)
          if (!planned) {
            throw new Error("Agent delegation task activity lost its plan.")
          }
          return {
            taskId: task.taskId,
            objective: planned.objective,
            status: task.status,
            ...(task.childRunId ? { childRunId: task.childRunId } : {}),
            profile: {
              profileId: planned.profile.profileId,
              version: planned.profile.version,
            },
            artifactRefs: task.result?.artifactRefs || [],
          }
        }),
      }
    }
  )
  const approvals = childApprovalsResult.rows.flatMap(({ runId, snapshot }) => {
    const approval = snapshot.pendingApproval
    if (
      snapshot.runId !== runId ||
      snapshot.parent?.rootRunId !== rootRunId ||
      !approval ||
      approval.status !== "pending"
    ) {
      return []
    }
    return [
      {
        runId,
        taskId: snapshot.parent.delegationTaskId,
        profile: {
          profileId: snapshot.profile.profileId,
          version: snapshot.profile.version,
        },
        approvalId: approval.approvalId,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
        toolCall: {
          name: approval.toolCall.name,
          input: approval.toolCall.input,
        },
      },
    ]
  })
  return {
    rootRunId,
    active: runs.some(
      ({ status }) => status === "queued" || status === "running"
    ),
    runs,
    approvals,
  }
}
