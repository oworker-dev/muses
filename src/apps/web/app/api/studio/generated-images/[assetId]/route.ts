import { getRun } from "workflow/api"

import type { WorkflowRuntimeImageAsset } from "@muses/domain"

import { authorizeWorkflowRun } from "@/lib/credit-ledger"
import { readGeneratedImage } from "@/lib/generated-image-storage"
import { requireStudioApiAccess } from "@/lib/studio-access"
import type { WorkflowDefinitionInterpreterResult } from "@/workflows/workflow-definition-interpreter"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const runIdPattern = /^wrun_[A-Za-z0-9_-]+$/
const workspaceIdPattern = /^[A-Za-z0-9_-]+$/
const assetIdPattern = /^image_[a-f0-9]{24}$/

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await context.params
  const searchParams = new URL(request.url).searchParams
  const workspaceId = searchParams.get("workspaceId") || ""
  const runId = searchParams.get("runId") || ""
  if (
    !assetIdPattern.test(assetId) ||
    !workspaceIdPattern.test(workspaceId) ||
    !runIdPattern.test(runId)
  ) {
    return imageNotFoundResponse()
  }
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response
  if (!(await authorizeWorkflowRun(workspaceId, runId))) {
    return imageNotFoundResponse()
  }

  try {
    const run = getRun<WorkflowDefinitionInterpreterResult>(runId)
    if (!(await run.exists) || (await run.status) !== "completed") {
      return imageNotFoundResponse()
    }
    const result = await run.returnValue
    if (result.definition.workspaceId !== workspaceId) {
      return imageNotFoundResponse()
    }
    const asset = findImageAsset(result.outputs, assetId)
    if (
      !asset ||
      asset.source.runId !== runId ||
      asset.source.workspaceId !== workspaceId
    ) {
      return imageNotFoundResponse()
    }

    const object = await readGeneratedImage({
      workspaceId,
      runId,
      assetId,
      mimeType: asset.mimeType,
    })
    return new Response(Uint8Array.from(object.bytes).buffer, {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": `attachment; filename="${assetId}.${mimeExtension(asset.mimeType)}"`,
        "content-type": object.contentType,
        "x-content-type-options": "nosniff",
      },
    })
  } catch {
    return imageNotFoundResponse()
  }
}

function findImageAsset(
  outputs: WorkflowDefinitionInterpreterResult["outputs"],
  assetId: string
): WorkflowRuntimeImageAsset | undefined {
  for (const value of Object.values(outputs)) {
    if (value.valueType !== "image") continue
    const asset = value.assets?.find((candidate) => candidate.id === assetId)
    if (asset) return asset
  }
  return undefined
}

function imageNotFoundResponse() {
  return Response.json(
    {
      error: "generated-image-not-found",
      message: "Generated image was not found.",
    },
    { status: 404 }
  )
}

function mimeExtension(mimeType: WorkflowRuntimeImageAsset["mimeType"]) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  return "png"
}
