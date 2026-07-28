import {
  requireStudioApiAccess,
  serializeStudioContext,
} from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") || undefined
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response
  return Response.json(serializeStudioContext(access.context))
}
