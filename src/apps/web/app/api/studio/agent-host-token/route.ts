import { createMusesAgentHostToken, isMusesAgentConfigured } from "@/lib/muses-agent-host"
import { getMusesAgentRuntimeConfig } from "@/lib/muses-agent-runtime-config"
import {
  AgentHostScopeError,
  requireAuthorizedAgentHostScope,
} from "@/lib/agent-host-scope"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const workspaceId = search.get("workspaceId") || undefined
  const projectId = search.get("projectId") || undefined
  const canvasId = search.get("canvasId") || undefined
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response
  if (!isMusesAgentConfigured()) {
    return Response.json(
      {
        error: "agent-host-not-configured",
        message: "The standalone Agent Host integration is not configured.",
      },
      { status: 503 },
    )
  }
  if (!projectId) {
    return Response.json(
      {
        error: "agent-host-project-required",
        message: "A Project scope is required for the Muses platform Agent.",
      },
      { status: 400 },
    )
  }
  let scope: Awaited<ReturnType<typeof requireAuthorizedAgentHostScope>>
  try {
    scope = await requireAuthorizedAgentHostScope({
      workspaceId: access.context.workspace.id,
      projectId,
      ...(canvasId ? { canvasId } : {}),
    })
  } catch (error) {
    if (error instanceof AgentHostScopeError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.status },
      )
    }
    throw error
  }
  const runtimeConfig = await getMusesAgentRuntimeConfig()
  const issued = createMusesAgentHostToken({
    userId: access.user.id,
    workspaceId: access.context.workspace.id,
    scope: {
      projectId: scope.projectId,
      canvasId: scope.canvasId,
    },
    runtimeConfig,
  })
  const publicServiceUrl = (
    process.env.MUSES_AGENT_PUBLIC_URL || process.env.MUSES_AGENT_SERVICE_URL || ""
  ).replace(/\/$/, "")
  return Response.json({
    contractVersion: "0.1.0-draft",
    accessToken: issued.token,
    expiresAt: issued.expiresAt,
    serviceUrl: publicServiceUrl,
    embedUrl: `${publicServiceUrl}/embed`,
    scope,
    runtimeConfig,
  })
}
