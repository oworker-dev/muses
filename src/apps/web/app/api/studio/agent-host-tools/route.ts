import { createHash } from "node:crypto"

import { z } from "zod"

const AGENT_HOST_CAPABILITY_CONTRACT_VERSION = "0.1.0-draft" as const
type AgentHostCapabilityDescriptor = {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly requiredPermissions: readonly string[]
  readonly sideEffect: "none" | "project-write" | "external"
}
import {
  type AgentToolCall,
  canvasInspectDefinition,
  canvasItemPutDefinition,
  imageGenerateDefinition,
  workflowDraftCommandDefinition,
  workflowDraftCreateDefinition,
  workflowInspectDefinition,
  workflowInvokeDefinition,
  workflowRunInspectDefinition,
  workflowRunWaitDefinition,
  workflowListDefinition,
  workflowPublishDefinition,
  workflowValidateDefinition,
  MusesAgentToolRegistry,
} from "@/lib/agent-tools"
import { authenticateAgentHostCapabilityRequest } from "@/lib/agent-host-capability-auth"
import { AgentHostCapabilityAuthError } from "@oworker/open-agent-host/signature"
import { getOrCreateOperationGatewaySnapshot } from "@/lib/operation-gateway-store"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const invokeRequestSchema = z.object({
  capability: z.string().trim().min(1).max(160),
  input: z.record(z.string(), z.unknown()).default({}),
  runId: z.string().trim().min(1).max(240),
  sessionId: z.string().trim().min(1).max(240),
  correlationId: z.string().trim().min(1).max(240).optional(),
})

const capabilityDefinitions = [
  canvasInspectDefinition,
  canvasItemPutDefinition,
  imageGenerateDefinition,
  workflowListDefinition,
  workflowInspectDefinition,
  workflowInvokeDefinition,
  workflowRunInspectDefinition,
  workflowRunWaitDefinition,
  workflowDraftCreateDefinition,
  workflowDraftCommandDefinition,
  workflowValidateDefinition,
  workflowPublishDefinition,
] as const

const capabilityByName = new Map(
  capabilityDefinitions.map((definition) => [definition.name, definition])
)

export async function GET(request: Request) {
  try {
    await authenticateAgentHostCapabilityRequest(request)
    return Response.json({
      contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
      capabilities: capabilityDefinitions.map(toCapabilityDescriptor),
    })
  } catch (error) {
    return capabilityErrorResponse(error)
  }
}

export async function POST(request: Request) {
  let actor: Awaited<ReturnType<typeof authenticateAgentHostCapabilityRequest>>
  try {
    actor = await authenticateAgentHostCapabilityRequest(request)
  } catch (error) {
    return capabilityErrorResponse(error)
  }

  const parsed = invokeRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return Response.json(
      {
        contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
        error: "invalid-host-capability-request",
        message:
          "A capability, run id, session id, and JSON input are required.",
        issues: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  const definition = capabilityByName.get(parsed.data.capability)
  if (!definition) {
    return Response.json(
      {
        contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
        error: "host-capability-not-found",
        message: "The requested Host capability is not registered.",
      },
      { status: 404 }
    )
  }
  if (actor.role === "viewer" && definition.sideEffect !== "none") {
    return Response.json(
      {
        contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
        error: "workspace-write-forbidden",
        message: "Viewer access is limited to read-only Host capabilities.",
      },
      { status: 403 }
    )
  }

  try {
    const projectId = actor.scope?.projectId
    if (!projectId) {
      return Response.json(
        {
          contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
          error: "host-capability-project-required",
          message: "A Project scope is required for Muses Host capabilities.",
        },
        { status: 400 },
      )
    }
    const gateway = await getOrCreateOperationGatewaySnapshot({
      workspaceId: actor.workspaceId,
      projectId,
      userId: actor.userId,
    })
    const call: AgentToolCall = {
      id: parsed.data.correlationId || stableCallId(parsed.data),
      name: parsed.data.capability,
      input: parsed.data.input,
    }
    const result = await new MusesAgentToolRegistry().execute(call, {
      workspaceId: gateway.workspaceId,
      projectId: gateway.project.id,
      canvasId: gateway.creativeCanvas.canvasId,
      sessionId: parsed.data.sessionId,
      runId: parsed.data.runId,
      permissions: definition.requiredPermissions,
      metadata: {
        initiatedByUserId: actor.userId,
        actorType: actor.actorType,
        agentRuntime: "standalone",
        hostCapabilityContractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
      },
      idempotencyKey: `${parsed.data.runId}:${call.id}:${parsed.data.capability}`,
      abortSignal: request.signal,
    })
    if (!result.ok) {
      return Response.json(
        {
          contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
          capability: parsed.data.capability,
          error: result.error?.code || "host-capability-failed",
          message: result.error?.message || "The Host capability failed.",
          retryable: result.error?.retryable ?? false,
        },
        { status: 422 }
      )
    }
    return Response.json({
      contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
      capability: parsed.data.capability,
      output: toJsonValue(result.output),
    })
  } catch (error) {
    console.error("Agent Host capability failed", {
      capability: parsed.data.capability,
      error,
    })
    return Response.json(
      {
        contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
        capability: parsed.data.capability,
        error: "host-capability-execution-failed",
        message: "The Host capability could not be completed.",
        retryable: true,
      },
      { status: 500 }
    )
  }
}

function toCapabilityDescriptor(
  definition: (typeof capabilityDefinitions)[number]
): AgentHostCapabilityDescriptor {
  return {
    name: definition.name,
    version: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
    description: definition.description,
    inputSchema: toJsonValue(definition.inputSchema) as Readonly<
      Record<string, unknown>
    >,
    requiredPermissions: definition.requiredPermissions,
    sideEffect: definition.sideEffect,
  }
}

function stableCallId(input: z.infer<typeof invokeRequestSchema>) {
  return `host_${createHash("sha256")
    .update(
      `${input.runId}:${input.sessionId}:${input.capability}:${JSON.stringify(input.input)}`
    )
    .digest("hex")
    .slice(0, 24)}`
}

function toJsonValue(value: unknown): unknown {
  if (value === undefined) return null
  return JSON.parse(
    JSON.stringify(value, (_key, nested) =>
      typeof nested === "bigint" ? nested.toString() : nested
    )
  )
}

function capabilityErrorResponse(error: unknown) {
  if (error instanceof AgentHostCapabilityAuthError) {
    return Response.json(
      {
        contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
        error: error.code,
        message: error.message,
      },
      { status: error.status }
    )
  }
  console.error("Agent Host capability authentication failed", error)
  return Response.json(
    {
      contractVersion: AGENT_HOST_CAPABILITY_CONTRACT_VERSION,
      error: "host-capability-unavailable",
      message: "The Host capability service is temporarily unavailable.",
    },
    { status: 503 }
  )
}
