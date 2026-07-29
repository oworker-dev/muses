import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import {
  AGENT_CORE_SCHEMA_VERSION,
  AgentRuntimeError,
  type AgentMessage,
  type AgentRunSnapshot,
} from "@muses/agent-core"

import {
  toPublicAgentEvent,
  toPublicAgentFailure,
} from "@/lib/agent-client-projection"
import { ensureAgentDriver } from "@/lib/agent-driver"
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
    reason: z.string().max(2000).optional(),
  }),
])

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return invalidRequest("A prompt and idempotency key are required.")
  const access = await requireStudioApiAccess(parsed.data.workspaceId)
  if (!access.ok) return access.response

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
  const events = await new PostgresAgentStateStore().readEvents(
    runId,
    afterSequence
  )
  return Response.json({
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    run: publicRun(owned.snapshot),
    events: events.map(toPublicAgentEvent),
    driver: {
      status: owned.driverStatus,
      runId: owned.driverRunId,
    },
  })
}

export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return invalidRequest("The AgentRun action is invalid.")
  const access = await requireStudioApiAccess(parsed.data.workspaceId)
  if (!access.ok) return access.response
  if (!(await authorizeAgentRun(parsed.data.workspaceId, parsed.data.runId))) {
    return runNotFound()
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
        await runtime.approve(parsed.data.runId, {
          approvalId: parsed.data.approvalId,
          decision: parsed.data.decision,
          reason: parsed.data.reason,
        })
        break
      case "resume":
        break
      case "cancel":
        await runtime.cancel(parsed.data.runId, parsed.data.reason)
        return Response.json({
          accepted: true,
          run: publicRun(await runtime.inspect(parsed.data.runId)),
        })
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
    throw error
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
