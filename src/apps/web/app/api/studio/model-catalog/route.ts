import { getStudioModelCatalog } from "@/lib/model-catalog"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) {
    return Response.json(
      {
        error: "workspace-required",
        message: "workspaceId is required.",
      },
      { status: 400 }
    )
  }
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response
  return Response.json(await getStudioModelCatalog(workspaceId))
}
