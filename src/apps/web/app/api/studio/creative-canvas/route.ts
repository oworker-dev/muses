import { getCreativeCanvasProjection } from "@/lib/creative-canvas-projection"
import { getOrCreateOperationGatewaySnapshot } from "@/lib/operation-gateway-store"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const workspaceId = search.get("workspaceId") || undefined
  const projectId = search.get("projectId") || undefined
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response

  const snapshot = await getOrCreateOperationGatewaySnapshot({
    workspaceId: access.context.workspace.id,
    projectId,
    userId: access.user.id,
  })
  return Response.json(await getCreativeCanvasProjection(snapshot))
}
