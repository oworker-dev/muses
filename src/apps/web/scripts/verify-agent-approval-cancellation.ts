import { randomUUID } from "node:crypto"

import {
  DefaultAgentPolicy,
  HeadlessAgentRuntime,
  type AgentModelPort,
  type AgentModelResult,
  type AgentToolCall,
  type AgentToolCallResult,
  type AgentToolDefinition,
  type AgentToolRegistryPort,
  type StartAgentRun,
} from "@muses/agent-core"
import {
  compileWorkflowDefinition,
  createHarnessWorkspace,
} from "@muses/domain"

import { cancelAgentRunAndChildren } from "../lib/agent-cancellation"
import { PostgresAgentStateStore } from "../lib/agent-state-store"
import { claimWorkflowSubmission } from "../lib/credit-ledger"
import { getPgPool } from "../lib/database"

const fixtureId = randomUUID().replaceAll("-", "")
const agentRunId = `arun_cancel_${fixtureId}`
const cancellationKey = `agent-cancel:${fixtureId}`
const pool = getPgPool()

async function main() {
  const target = await readTarget()
  const store = new PostgresAgentStateStore({ pool })
  const tools = new ExternalFixtureTools()
  const runtime = new HeadlessAgentRuntime({
    model: new ApprovalFixtureModel(),
    tools,
    policy: new DefaultAgentPolicy(),
    store,
  })
  try {
    await runtime.start(startInput(target))
    await runtime.resume(agentRunId)
    const waiting = await runtime.inspect(agentRunId)
    assert(
      waiting.status === "waiting-approval" &&
        waiting.pendingApproval?.toolCall.name === "fixture.external",
      "The external fixture did not wait for approval."
    )
    await runtime.approve(agentRunId, {
      approvalId: waiting.pendingApproval.approvalId,
      decision: "denied",
      reason: "A9 denial fixture",
      decidedBy: { kind: "user", actorId: target.userId },
    })
    await runtime.resume(agentRunId)
    assert(tools.executions === 0, "A denied external tool executed.")

    await runtime.followUp(agentRunId, {
      id: `amsg_cancel_${fixtureId}`,
      role: "user",
      content: "Start the cancellation fixture.",
      createdAt: new Date().toISOString(),
    })
    const cancellation = await cancelAgentRunAndChildren({
      workspaceId: target.workspaceId,
      runId: agentRunId,
      requestedByUserId: target.userId,
      idempotencyKey: cancellationKey,
      reason: "A9 linked child cancellation fixture",
    })
    assert(cancellation.state === "completed", "Cancellation did not complete.")
    const cancelledAgent = await runtime.inspect(agentRunId)
    assert(cancelledAgent.status === "cancelled", "AgentRun was not cancelled.")

    const replay = await cancelAgentRunAndChildren({
      workspaceId: target.workspaceId,
      runId: agentRunId,
      requestedByUserId: target.userId,
      idempotencyKey: cancellationKey,
      reason: "A9 linked child cancellation fixture",
    })
    assert(
      replay.state === "completed" && replay.idempotentReplay,
      "The cancellation receipt did not replay."
    )
    const conflict = await cancelAgentRunAndChildren({
      workspaceId: target.workspaceId,
      runId: agentRunId,
      requestedByUserId: target.userId,
      idempotencyKey: `${cancellationKey}:conflict`,
      reason: "Different cancellation identity",
    })
    assert(
      conflict.state === "idempotency-conflict",
      "A conflicting cancellation identity was accepted."
    )

    const blocked = await claimCancelledAgentChild(target)
    assert(
      blocked.state === "caller-inactive",
      "A cancelled AgentRun started another child Workflow."
    )

    const receipt = (
      await pool.query<{
        status: string
        childCount: number
        reviewRequired: boolean
      }>(
        `
          select
            status,
            jsonb_array_length(summary->'children') as "childCount",
            coalesce((summary->>'reviewRequired')::boolean, false) as "reviewRequired"
          from muses_agent_cancel_receipt
          where workspace_id = $1 and agent_run_id = $2
        `,
        [target.workspaceId, agentRunId]
      )
    ).rows[0]
    assert(
      receipt?.status === "completed" && Number(receipt.childCount) === 0,
      "The durable cancellation receipt is incomplete."
    )

    console.log(
      JSON.stringify({
        passed: true,
        approval: { denied: true, executions: tools.executions },
        agentStatus: cancelledAgent.status,
        idempotentReplay:
          replay.state === "completed" && replay.idempotentReplay,
        conflictingIdentity: conflict.state,
        newChildAfterCancel: blocked.state,
        receipt,
      })
    )
  } finally {
    await pool
      .query("delete from muses_agent_run where id = $1", [agentRunId])
      .catch(() => undefined)
    await pool.end()
  }
}

async function readTarget() {
  const target = (
    await pool.query<{
      workspaceId: string
      projectId: string
      canvasId: string | null
      userId: string
    }>(`
      select
        project.workspace_id as "workspaceId",
        project.id as "projectId",
        canvas.id as "canvasId",
        workspace.created_by_user_id as "userId"
      from muses_project project
      join muses_workspace workspace on workspace.id = project.workspace_id
      left join muses_creative_canvas canvas
        on canvas.workspace_id = project.workspace_id
       and canvas.project_id = project.id
      order by project.created_at
      limit 1
    `)
  ).rows[0]
  if (!target) throw new Error("A Muses project is required for this fixture.")
  return target
}

function startInput(
  target: Awaited<ReturnType<typeof readTarget>>
): StartAgentRun {
  return {
    runId: agentRunId,
    session: {
      sessionId: `asession_cancel_${fixtureId}`,
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      ...(target.canvasId ? { canvasId: target.canvasId } : {}),
    },
    profile: {
      profileId: "a9-approval-cancellation-fixture",
      version: "1.0.0",
      modelRef: "fixture/deterministic",
      instructions: "Execute only the sanitized fixture action.",
      toolNames: ["fixture.external"],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    input: "Request the external fixture action.",
    budget: {
      maxTurns: 8,
      maxModelCalls: 8,
      maxToolCalls: 4,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxCreditMicros: "0",
      maxDurationMs: 60_000,
    },
    permissions: ["fixture.external"],
    metadata: {
      initiatedByUserId: target.userId,
      fixture: "a9-approval-cancellation",
    },
  }
}

async function claimCancelledAgentChild(
  target: Awaited<ReturnType<typeof readTarget>>
) {
  const fixture = createHarnessWorkspace()
  const document = {
    ...fixture,
    id: target.workspaceId,
    workflow: { ...fixture.workflow, id: `a9-blocked-workflow-${fixtureId}` },
  }
  const compilation = compileWorkflowDefinition(document.workflow, {
    workspaceId: target.workspaceId,
    definitionId: `a9-blocked-definition-${fixtureId}`,
    version: 0,
  })
  if (!compilation.ok) throw new Error("The blocked Harness is invalid.")
  return claimWorkflowSubmission({
    workspaceId: target.workspaceId,
    userId: target.userId,
    idempotencyKey: `a9-blocked-child:${fixtureId}`,
    requestFingerprint: "blocked-after-cancel",
    definition: compilation.definition,
    caller: { kind: "agent", agentRunId },
  })
}

class ApprovalFixtureModel implements AgentModelPort {
  private call = 0

  estimate() {
    return { inputTokens: 1, outputTokens: 1, creditMicros: "0" }
  }

  async complete(): Promise<AgentModelResult> {
    this.call += 1
    return this.call === 1
      ? {
          content: "Requesting the external fixture action.",
          finishReason: "tool-calls",
          toolCalls: [
            {
              id: `fixture_call_${fixtureId}`,
              name: "fixture.external",
              input: {},
            },
          ],
          usage: { inputTokens: 1, outputTokens: 1, creditMicros: "0" },
        }
      : {
          content: "The external fixture action was denied.",
          finishReason: "stop",
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, creditMicros: "0" },
        }
  }
}

class ExternalFixtureTools implements AgentToolRegistryPort {
  executions = 0
  private readonly definition: AgentToolDefinition = {
    name: "fixture.external",
    description: "A sanitized external side effect fixture.",
    inputSchema: { type: "object", additionalProperties: false },
    requiredPermissions: ["fixture.external"],
    sideEffect: "external",
  }

  async list() {
    return [this.definition]
  }

  async execute(call: AgentToolCall): Promise<AgentToolCallResult> {
    this.executions += 1
    return { toolCallId: call.id, ok: true, output: { executed: true } }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

await main()
