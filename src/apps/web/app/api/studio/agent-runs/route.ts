import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import {
  AGENT_CORE_SCHEMA_VERSION,
  AgentDelegationRuntimeError,
  AgentRuntimeError,
  type AgentMessage,
  type AgentRunSnapshot,
} from "@muses/agent-core"

import {
  toPublicAgentEvent,
  toPublicAgentFailure,
} from "@/lib/agent-client-projection"
import { cancelAgentRunAndChildren } from "@/lib/agent-cancellation"
import { authorizeAgentDelegationExecution } from "@/lib/agent-delegation-authorization"
import { readAgentDelegationActivity } from "@/lib/agent-delegation-activity"
import { cancelAgentDelegationExecution } from "@/lib/agent-delegation-driver"
import { ensureAgentDriver } from "@/lib/agent-driver"
import { recordAuditLog } from "@/lib/audit"
import {
  createMusesAgentRuntime,
  defaultAgentBudget,
  musesAgentProfile,
} from "@/lib/agent-runtime"
import {
  PostgresAgentStateStore,
  authorizeAgentRun,
} from "@/lib/agent-state-store"
import { getOrCreateOperationGatewaySnapshot } from "@/lib/operation-gateway-store"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const startSchema = z.object({
  workspaceId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).max(8000),
  idempotencyKey: z.string().trim().min(8).max(200),
})

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("steer"),
    workspaceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    message: z.string().trim().min(1).max(8000),
  }),
  z.object({
    action: z.literal("follow-up"),
    workspaceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    message: z.string().trim().min(1).max(8000),
  }),
  z.object({
    action: z.literal("approve"),
    workspaceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    approvalId: z.string().trim().min(1),
    decision: z.enum(["approved", "denied"]),
    reason: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("resume"),
    workspaceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("cancel"),
    workspaceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("cancel-delegation"),
    workspaceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    delegationRunId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(1).max(2000),
  }),
])

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return invalidRequest("A prompt and idempotency key are required.")
  const access = await requireStudioApiAccess(parsed.data.workspaceId)
  if (!access.ok) return access.response
  if (access.context.workspace.role === "viewer") {
    return agentActionNotAuthorized()
  }

  const gateway = await getOrCreateOperationGatewaySnapshot({
    workspaceId: parsed.data.workspaceId,
    projectId: parsed.data.projectId,
    userId: access.user.id,
  })
  const runId = deterministicRunId(
    parsed.data.workspaceId,
    parsed.data.idempotencyKey
  )
  const runtime = createMusesAgentRuntime()
  const ref = await runtime.start({
    runId,
    session: {
      sessionId: `asession_${runId.slice("arun_".length)}`,
      workspaceId: gateway.workspaceId,
      projectId: gateway.project.id,
      canvasId: gateway.creativeCanvas.canvasId,
    },
    profile: musesAgentProfile(),
    input: parsed.data.prompt,
    budget: defaultAgentBudget(),
    permissions: [
      "canvas.read",
      "canvas.write",
      "image.generate",
      "workflow.read",
      "workflow.invoke",
      "agent.delegate",
    ],
    metadata: {
      initiatedByUserId: access.user.id,
      initiatedByEmail: access.user.email,
      requestIdempotencyKey: parsed.data.idempotencyKey,
    },
  })
  const driver = await ensureAgentDriver(ref.runId)
  return Response.json(
    {
      accepted: true,
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      run: publicRun(await runtime.inspect(ref.runId)),
      driver,
    },
    { status: 202 }
  )
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const workspaceId = search.get("workspaceId") || ""
  const runId = search.get("runId") || ""
  const afterSequence = parseAfterSequence(search.get("afterSequence"))
  if (!workspaceId || !runId || afterSequence === null) {
    return invalidRequest(
      "workspaceId, runId, and a valid event cursor are required."
    )
  }
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response
  const owned = await authorizeAgentRun(workspaceId, runId)
  if (!owned) return runNotFound()
  let driver: { status: string; runId: string | null } = {
    status: owned.driverStatus,
    runId: owned.driverRunId,
  }
  if (needsDriverRecovery(owned)) {
    const recovered = await ensureAgentDriver(runId).catch(() => null)
    driver = recovered
      ? {
          status: recovered.state,
          runId:
            "driverRunId" in recovered
              ? recovered.driverRunId
              : owned.driverRunId,
        }
      : { status: "recovery-deferred", runId: owned.driverRunId }
  }
  const events = await new PostgresAgentStateStore().readEvents(
    runId,
    afterSequence
  )
  const delegation = await readAgentDelegationActivity({
    workspaceId,
    run: owned.snapshot,
  })
  return Response.json({
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    run: publicRun(owned.snapshot),
    events: events.map(toPublicAgentEvent),
    driver,
    delegation,
  })
}

export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return invalidRequest("The AgentRun action is invalid.")
  const access = await requireStudioApiAccess(parsed.data.workspaceId)
  if (!access.ok) return access.response
  const owned = await authorizeAgentRun(
    parsed.data.workspaceId,
    parsed.data.runId
  )
  if (!owned) return runNotFound()
  if (access.context.workspace.role === "viewer") {
    return agentActionNotAuthorized()
  }
  const runtime = createMusesAgentRuntime()
  try {
    switch (parsed.data.action) {
      case "steer":
        await runtime.steer(parsed.data.runId, userMessage(parsed.data.message))
        break
      case "follow-up":
        await runtime.followUp(
          parsed.data.runId,
          userMessage(parsed.data.message)
        )
        break
      case "approve":
        await decideApprovalWithRetry(runtime, parsed.data.runId, {
          approvalId: parsed.data.approvalId,
          decision: parsed.data.decision,
          reason: parsed.data.reason,
          decidedBy: { kind: "user", actorId: access.user.id },
        })
        break
      case "resume":
        break
      case "cancel":
        const cancellation = await cancelAgentRunAndChildren({
          workspaceId: parsed.data.workspaceId,
          runId: parsed.data.runId,
          requestedByUserId: access.user.id,
          idempotencyKey: parsed.data.idempotencyKey,
          reason: parsed.data.reason,
        })
        if (cancellation.state === "in-progress") {
          return Response.json(
            {
              accepted: false,
              error: "agent-cancellation-in-progress",
              message: "Agent cancellation is still being coordinated.",
            },
            { status: 409, headers: { "retry-after": "2" } }
          )
        }
        if (cancellation.state === "idempotency-conflict") {
          return Response.json(
            {
              accepted: false,
              error: "idempotency-key-conflict",
              message:
                "This Agent cancellation has a different request identity.",
            },
            { status: 409 }
          )
        }
        if (cancellation.state === "run-state-conflict") {
          return Response.json(
            {
              accepted: false,
              error: "agent-run-state-conflict",
              message: "This AgentRun can no longer be cancelled.",
            },
            { status: 409 }
          )
        }
        return Response.json({
          accepted: true,
          run: publicRun(await runtime.inspect(parsed.data.runId)),
          cancellation: {
            idempotentReplay: cancellation.idempotentReplay,
            summary: cancellation.summary,
          },
        })
      case "cancel-delegation": {
        const rootRunId =
          owned.snapshot.parent?.rootRunId || owned.snapshot.runId
        const delegation = await authorizeAgentDelegationExecution({
          workspaceId: parsed.data.workspaceId,
          projectId: owned.snapshot.session.projectId,
          sessionId: owned.snapshot.session.sessionId,
          rootRunId,
          delegationRunId: parsed.data.delegationRunId,
        })
        if (!delegation) return delegationNotFound()
        const idempotentReplay = Boolean(delegation.snapshot.cancellation)
        const cancellation = await cancelAgentDelegationExecution({
          delegationRunId: parsed.data.delegationRunId,
          idempotencyKey: parsed.data.idempotencyKey,
          reason: parsed.data.reason,
        })
        await recordAuditLog({
          actor: { userId: access.user.id, email: access.user.email },
          action: "muses.agent-delegation.cancelled",
          targetType: "agent-delegation-run",
          targetId: parsed.data.delegationRunId,
          idempotencyKey: parsed.data.idempotencyKey,
          metadata: {
            workspaceId: parsed.data.workspaceId,
            projectId: owned.snapshot.session.projectId,
            rootRunId,
            status: cancellation.run.status,
          },
        })
        return Response.json({
          accepted: true,
          run: publicRun(await runtime.inspect(parsed.data.runId)),
          delegationCancellation: {
            delegationRunId: parsed.data.delegationRunId,
            status: cancellation.run.status,
            idempotentReplay,
          },
        })
      }
    }
    const driver = await ensureAgentDriver(parsed.data.runId)
    return Response.json({
      accepted: true,
      run: publicRun(await runtime.inspect(parsed.data.runId)),
      driver,
    })
  } catch (error) {
    if (error instanceof AgentRuntimeError) {
      return Response.json(
        { accepted: false, error: error.code, message: error.message },
        { status: error.code === "run-not-found" ? 404 : 409 }
      )
    }
    if (error instanceof AgentDelegationRuntimeError) {
      return Response.json(
        { accepted: false, error: error.code, message: error.message },
        { status: error.code === "delegation-not-found" ? 404 : 409 }
      )
    }
    throw error
  }
}

async function decideApprovalWithRetry(
  runtime: ReturnType<typeof createMusesAgentRuntime>,
  runId: string,
  decision: Parameters<typeof runtime.approve>[1]
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await runtime.approve(runId, decision)
      return
    } catch (error) {
      if (
        !(error instanceof AgentRuntimeError) ||
        error.code !== "revision-conflict" ||
        attempt === 2
      ) {
        throw error
      }
    }
  }
}

function userMessage(content: string): AgentMessage {
  return {
    id: `amsg_${randomUUID().replaceAll("-", "")}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  }
}

function publicRun<T extends { failure?: AgentRunSnapshot["failure"] }>(
  run: T
) {
  return { ...run, failure: toPublicAgentFailure(run.failure) }
}

function deterministicRunId(workspaceId: string, idempotencyKey: string) {
  return `arun_${createHash("sha256")
    .update(`${workspaceId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`
}

function parseAfterSequence(value: string | null) {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function needsDriverRecovery(owned: {
  snapshot: AgentRunSnapshot
  driverStatus: string
  driverLeaseExpiresAt: string | null
}) {
  if (
    owned.snapshot.status !== "queued" &&
    owned.snapshot.status !== "running"
  ) {
    return false
  }
  if (owned.driverStatus !== "starting" && owned.driverStatus !== "running") {
    return true
  }
  return (
    !owned.driverLeaseExpiresAt ||
    Date.parse(owned.driverLeaseExpiresAt) <= Date.now()
  )
}

function invalidRequest(message: string) {
  return Response.json(
    { accepted: false, error: "invalid-agent-request", message },
    { status: 400 }
  )
}

function runNotFound() {
  return Response.json(
    {
      accepted: false,
      error: "agent-run-not-found",
      message: "AgentRun was not found.",
    },
    { status: 404 }
  )
}

function delegationNotFound() {
  return Response.json(
    {
      accepted: false,
      error: "agent-delegation-not-found",
      message: "DelegationRun was not found in this Agent scope.",
    },
    { status: 404 }
  )
}

function agentActionNotAuthorized() {
  return Response.json(
    {
      accepted: false,
      error: "agent-action-not-authorized",
      message: "This Workspace role cannot change Agent runs.",
    },
    { status: 403 }
  )
}
