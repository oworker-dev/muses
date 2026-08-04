import { getPgPool } from "@/lib/database"
import {
  AgentHostCapabilityAuthError,
  verifyAgentHostCapabilityRequest,
} from "@oworker/open-agent-host/signature"
import {
  AgentHostScopeError,
  requireAuthorizedAgentHostScope,
} from "@/lib/agent-host-scope"

export type AgentHostCapabilityActor = {
  readonly userId: string
  readonly workspaceId: string
  readonly scope?: Readonly<Record<string, string>>
  readonly actorType: "user" | "service"
  readonly role: "owner" | "admin" | "member" | "viewer"
}

export async function authenticateAgentHostCapabilityRequest(
  request: Request,
): Promise<AgentHostCapabilityActor> {
  const secret = process.env.MUSES_AGENT_HOST_TOOLS_SECRET?.trim()
  if (!secret || secret.length < 32) {
    throw new AgentHostCapabilityAuthError(
      "host-capability-not-configured",
      "The Host capability service is not configured.",
      503,
    )
  }

  const body = request.method === "GET" ? "" : await request.clone().text()
  const identity = verifyAgentHostCapabilityRequest({
    body,
    headers: request.headers,
    method: request.method,
    secret,
    url: request.url,
  })
  const tenantId = identity.tenantId
  const principalId = identity.principalId
  const actorTypeHeader = identity.actorType

  const membership = await getPgPool().query<{
    role: "owner" | "admin" | "member" | "viewer"
  }>(
    `
      select role
      from muses_workspace_member
      where workspace_id = $1 and user_id = $2 and status = 'active'
      limit 1
    `,
    [tenantId, principalId],
  )
  const row = membership.rows[0]
  if (!row) {
    throw new AgentHostCapabilityAuthError(
      "host-capability-workspace-forbidden",
      "The Agent principal is not an active member of this Workspace.",
      403,
    )
  }
  if (actorTypeHeader === "service" && row.role !== "owner" && row.role !== "admin") {
    throw new AgentHostCapabilityAuthError(
      "host-capability-service-forbidden",
      "Service actors require Workspace owner or admin access.",
      403,
    )
  }
  const projectId = identity.scope?.projectId
  const canvasId = identity.scope?.canvasId
  let scope: { readonly projectId?: string; readonly canvasId?: string } = {}
  if (canvasId && !projectId) {
    throw new AgentHostCapabilityAuthError(
      "host-capability-project-required",
      "A Canvas-scoped request must also contain a Project scope.",
      401,
    )
  }
  if (projectId) {
    try {
      scope = await requireAuthorizedAgentHostScope({
        workspaceId: tenantId,
        projectId,
        ...(canvasId ? { canvasId } : {}),
      })
    } catch (error) {
      if (error instanceof AgentHostScopeError) {
        throw new AgentHostCapabilityAuthError(error.code, error.message, 403)
      }
      throw error
    }
  }
  return {
    userId: principalId,
    workspaceId: tenantId,
    scope,
    actorType: actorTypeHeader,
    role: row.role,
  }
}
