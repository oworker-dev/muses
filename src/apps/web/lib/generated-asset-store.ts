import type { WorkflowRuntimeImageAsset } from "@muses/domain"

import { getPgPool } from "@/lib/database"

export type GeneratedImageAssetRecord = {
  id: string
  workspaceId: string
  workflowRunId: string
  nodeId: string
  stepId: string
  assetIndex: number
  objectKey: string
  mimeType: WorkflowRuntimeImageAsset["mimeType"]
  byteSize: string
  width: number
  height: number
  prompt: string
  provider: string
  modelRef: string
  createdAt: string
}

export async function recordGeneratedImageAsset(
  asset: GeneratedImageAssetRecord
) {
  await getPgPool().query(
    `
      insert into muses_generated_asset (
        id,
        workspace_id,
        workflow_run_id,
        node_id,
        step_id,
        asset_index,
        object_key,
        mime_type,
        byte_size,
        width,
        height,
        prompt,
        provider,
        model_ref,
        created_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      on conflict (id) do nothing
    `,
    [
      asset.id,
      asset.workspaceId,
      asset.workflowRunId,
      asset.nodeId,
      asset.stepId,
      asset.assetIndex,
      asset.objectKey,
      asset.mimeType,
      asset.byteSize,
      asset.width,
      asset.height,
      asset.prompt,
      asset.provider,
      asset.modelRef,
      asset.createdAt,
    ]
  )

  const persisted = await getGeneratedImageAsset({
    workspaceId: asset.workspaceId,
    workflowRunId: asset.workflowRunId,
    assetId: asset.id,
  })
  if (!persisted || !sameAssetIdentity(persisted, asset)) {
    throw new Error("Generated image Asset identity conflicts with its record.")
  }
  return persisted
}

export async function getGeneratedImageAsset(input: {
  workspaceId: string
  workflowRunId: string
  assetId: string
}) {
  const result = await getPgPool().query<GeneratedImageAssetRecord>(
    `
      select
        id,
        workspace_id as "workspaceId",
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
      where workspace_id = $1 and workflow_run_id = $2 and id = $3
      limit 1
    `,
    [input.workspaceId, input.workflowRunId, input.assetId]
  )
  return result.rows[0]
}

function sameAssetIdentity(
  persisted: GeneratedImageAssetRecord,
  requested: GeneratedImageAssetRecord
) {
  return (
    persisted.objectKey === requested.objectKey &&
    persisted.workspaceId === requested.workspaceId &&
    persisted.workflowRunId === requested.workflowRunId &&
    persisted.nodeId === requested.nodeId &&
    persisted.stepId === requested.stepId &&
    persisted.assetIndex === requested.assetIndex &&
    persisted.mimeType === requested.mimeType &&
    persisted.byteSize === requested.byteSize &&
    persisted.width === requested.width &&
    persisted.height === requested.height &&
    persisted.prompt === requested.prompt &&
    persisted.provider === requested.provider &&
    persisted.modelRef === requested.modelRef
  )
}
