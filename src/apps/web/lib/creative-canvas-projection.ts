import type {
  AgentExecutionPlan,
  AgentRunSnapshot,
  AgentRunStatus,
} from "@muses/agent-core"
import type {
  CreativeCanvas,
  OperationGatewaySnapshot,
  WorkflowRuntimeImageAsset,
} from "@muses/domain"

import { getPgPool } from "@/lib/database"

export const CREATIVE_CANVAS_PROJECTION_VERSION = "0.1.0" as const

export type CreativeCanvasAssetProjection = {
  id: string
  prompt: string
  modelRef: string
  mimeType: WorkflowRuntimeImageAsset["mimeType"]
  width: number
  height: number
  imageUrl: string
  agentRunId: string
  workflowRunId: string
}

export type CreativeCanvasAgentRunProjection = {
  runId: string
  status: AgentRunStatus
  plan?: AgentExecutionPlan
  createdAt: string
  completedAt?: string
}

export type CreativeCanvasProjection = {
  schemaVersion: typeof CREATIVE_CANVAS_PROJECTION_VERSION
  canvas: CreativeCanvas
  assets: Readonly<Record<string, CreativeCanvasAssetProjection>>
  agentRuns: readonly CreativeCanvasAgentRunProjection[]
}

type AgentRunRow = {
  id: string
  snapshot: AgentRunSnapshot
}

type ImageToolOutput = {
  workflowRunId?: string
  assets?: WorkflowRuntimeImageAsset[]
}

export async function getCreativeCanvasProjection(
  snapshot: OperationGatewaySnapshot
): Promise<CreativeCanvasProjection> {
  const result = await getPgPool().query<AgentRunRow>(
    `
      select id, snapshot
      from muses_agent_run
      where workspace_id = $1 and project_id = $2
      order by created_at desc
      limit 100
    `,
    [snapshot.workspaceId, snapshot.project.id]
  )
  const canvasAssetIds = new Set(
    snapshot.creativeCanvas.items
      .filter(({ kind }) => kind === "asset")
      .map(({ refId }) => refId)
  )
  const assets: Record<string, CreativeCanvasAssetProjection> = {}
  const linkedRunIds = new Set<string>()

  for (const row of result.rows) {
    for (const output of imageToolOutputs(row.snapshot)) {
      const workflowRunId = output.workflowRunId
      if (!workflowRunId) continue
      for (const asset of output.assets || []) {
        if (!canvasAssetIds.has(asset.id) || assets[asset.id]) continue
        linkedRunIds.add(row.id)
        assets[asset.id] = {
          id: asset.id,
          prompt: asset.prompt,
          modelRef: asset.modelRef,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          imageUrl: generatedImageUrl(
            snapshot.workspaceId,
            workflowRunId,
            asset.id
          ),
          agentRunId: row.id,
          workflowRunId,
        }
      }
    }
  }

  return {
    schemaVersion: CREATIVE_CANVAS_PROJECTION_VERSION,
    canvas: snapshot.creativeCanvas,
    assets,
    agentRuns: result.rows
      .filter(({ id }) => linkedRunIds.has(id))
      .map(({ id, snapshot: run }) => ({
        runId: id,
        status: run.status,
        ...(run.plan ? { plan: run.plan } : {}),
        createdAt: run.createdAt,
        ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      })),
  }
}

function imageToolOutputs(snapshot: AgentRunSnapshot) {
  const outputs: ImageToolOutput[] = []
  for (const message of snapshot.context.messages) {
    if (message.role !== "tool" || message.toolName !== "image.generate") {
      continue
    }
    try {
      const output = JSON.parse(message.content) as ImageToolOutput
      if (Array.isArray(output.assets)) outputs.push(output)
    } catch {
      continue
    }
  }
  return outputs
}

function generatedImageUrl(
  workspaceId: string,
  workflowRunId: string,
  assetId: string
) {
  const query = new URLSearchParams({ workspaceId, runId: workflowRunId })
  return `/api/studio/generated-images/${encodeURIComponent(assetId)}?${query}`
}
