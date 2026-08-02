import type {
  CreativeCanvas,
  OperationGatewaySnapshot,
  WorkflowRuntimeImageAsset,
} from "@muses/domain"

import { getPgPool } from "@/lib/database"
import type { GeneratedImageAssetRecord } from "@/lib/generated-asset-store"

export const CREATIVE_CANVAS_PROJECTION_VERSION = "0.1.0" as const

export type CreativeCanvasAssetProjection = {
  id: string
  prompt: string
  modelRef: string
  mimeType: WorkflowRuntimeImageAsset["mimeType"]
  width: number
  height: number
  imageUrl: string
  workflowRunId: string
}

export type CreativeCanvasProjection = {
  schemaVersion: typeof CREATIVE_CANVAS_PROJECTION_VERSION
  canvas: CreativeCanvas
  assets: Readonly<Record<string, CreativeCanvasAssetProjection>>
}

export async function getCreativeCanvasProjection(
  snapshot: OperationGatewaySnapshot
): Promise<CreativeCanvasProjection> {
  const canvasAssetIds = [
    ...new Set(
      snapshot.creativeCanvas.items
        .filter(({ kind }) => kind === "asset")
        .map(({ refId }) => refId)
    ),
  ]
  const result = canvasAssetIds.length
    ? await getPgPool().query<GeneratedImageAssetRecord>(
    `
      select
        id,
        workspace_id as "workspaceId",
        project_id as "projectId",
        workflow_run_id as "workflowRunId",
        node_id as "nodeId",
        step_id as "stepId",
        asset_index as "assetIndex",
        object_key as "objectKey",
        mime_type as "mimeType",
        byte_size::text as "byteSize",
        width,
        height,
        prompt,
        provider,
        model_ref as "modelRef",
        created_at::text as "createdAt"
      from muses_generated_asset
      where workspace_id = $1
        and project_id = $2
        and id = any($3::text[])
    `,
    [snapshot.workspaceId, snapshot.project.id, canvasAssetIds]
      )
    : { rows: [] as GeneratedImageAssetRecord[] }
  const assets: Record<string, CreativeCanvasAssetProjection> = {}
  for (const asset of result.rows) {
    assets[asset.id] = {
      id: asset.id,
      prompt: asset.prompt,
      modelRef: asset.modelRef,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      imageUrl: generatedImageUrl(
        snapshot.workspaceId,
        asset.workflowRunId,
        asset.id
      ),
      workflowRunId: asset.workflowRunId,
    }
  }

  return {
    schemaVersion: CREATIVE_CANVAS_PROJECTION_VERSION,
    canvas: snapshot.creativeCanvas,
    assets,
  }
}

function generatedImageUrl(
  workspaceId: string,
  workflowRunId: string,
  assetId: string
) {
  const query = new URLSearchParams({ workspaceId, runId: workflowRunId })
  return `/api/studio/generated-images/${encodeURIComponent(assetId)}?${query}`
}
