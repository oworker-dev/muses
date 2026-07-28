import {
  assertReferenceImageAssetId,
  readReferenceImageObject,
} from "@/lib/reference-image-storage"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await context.params
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") || ""
  const access = await requireStudioApiAccess(workspaceId || undefined)
  if (!access.ok) return access.response
  try {
    assertReferenceImageAssetId(assetId)
    const object = await readReferenceImageObject({ workspaceId, assetId })
    return new Response(object.body, {
      headers: {
        "cache-control": "private, max-age=300",
        "content-type": object.contentType,
        "content-disposition": `inline; filename="${assetId}"`,
        "x-content-type-options": "nosniff",
      },
    })
  } catch {
    return Response.json(
      {
        error: "reference-image-not-found",
        message: "Reference image was not found.",
      },
      { status: 404 }
    )
  }
}
