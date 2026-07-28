import { createHash } from "node:crypto"

import { getRun, start } from "workflow/api"
import { z } from "zod"

import {
  OPERATION_COMMAND_SCHEMA_VERSION,
  compileWorkflowDefinition,
  createInitialWorkspace,
  type CreativeCanvasItem,
  type OperationCommandEnvelope,
  type WorkflowRuntimeImageAsset,
} from "@muses/domain"
import type {
  AgentToolCall,
  AgentToolCallResult,
  AgentToolDefinition,
  AgentToolExecutionContext,
  AgentToolRegistryPort,
} from "@muses/agent-core"

import {
  attachWorkflowSdkRun,
  claimWorkflowSubmission,
  failWorkflowStart,
  fingerprintWorkflowSubmission,
} from "@/lib/credit-ledger"
import { getPgPool } from "@/lib/database"
import {
  executeOperationCommand,
  getOrCreateOperationGatewaySnapshot,
} from "@/lib/operation-gateway-store"
import {
  workflowDefinitionInterpreter,
  type WorkflowDefinitionInterpreterResult,
} from "@/workflows/workflow-definition-interpreter"

const canvasInspectDefinition: AgentToolDefinition = {
  name: "canvas.inspect",
  description:
    "Inspect the authoritative Muses creative canvas, its placed assets, and available professional workflows.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredPermissions: ["canvas.read"],
  sideEffect: "none",
}

const canvasItemPutDefinition: AgentToolDefinition = {
  name: "canvas.item.put",
  description:
    "Place or update an existing asset or artifact on the authoritative Muses creative canvas.",
  inputSchema: {
    type: "object",
    properties: {
      refId: { type: "string", minLength: 1 },
      kind: {
        type: "string",
        enum: [
          "asset",
          "artifact",
          "professional-document",
          "workflow",
          "agent-run",
        ],
      },
      title: { type: "string", minLength: 1, maxLength: 200 },
      x: { type: "number" },
      y: { type: "number" },
      width: { type: "number", exclusiveMinimum: 0 },
      height: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["refId", "kind", "title", "x", "y"],
    additionalProperties: false,
  },
  requiredPermissions: ["canvas.write"],
  sideEffect: "project-write",
}

const imageGenerateDefinition: AgentToolDefinition = {
  name: "image.generate",
  description:
    "Generate one real image through the configured Muses image workflow, bill it once, and place the resulting asset on the creative canvas.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 8000 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      aspectRatio: {
        type: "string",
        enum: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"],
      },
      resolution: { type: "string", enum: ["1k", "2k", "4k"] },
      quality: { type: "string", enum: ["low", "medium", "high"] },
      referenceImageAssetIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: 16,
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  requiredPermissions: ["image.generate", "canvas.write"],
  sideEffect: "project-write",
}

const canvasItemSchema = z.object({
  refId: z.string().trim().min(1),
  kind: z.enum([
    "asset",
    "artifact",
    "professional-document",
    "workflow",
    "agent-run",
  ]),
  title: z.string().trim().min(1).max(200),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
})

const imageGenerateSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  title: z.string().trim().min(1).max(200).optional(),
  aspectRatio: z
    .enum(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"])
    .default("1:1"),
  resolution: z.enum(["1k", "2k", "4k"]).default("1k"),
  quality: z.enum(["low", "medium", "high"]).default("medium"),
  referenceImageAssetIds: z.array(z.string().trim().min(1)).max(16).default([]),
})

export class MusesAgentToolRegistry implements AgentToolRegistryPort {
  async list() {
    return [canvasInspectDefinition, canvasItemPutDefinition, imageGenerateDefinition]
  }

  async execute(
    call: AgentToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolCallResult> {
    switch (call.name) {
      case "canvas.inspect":
        return toolSuccess(call, await inspectCanvas(context))
      case "canvas.item.put": {
        const input = canvasItemSchema.parse(call.input)
        return toolSuccess(
          call,
          await putCanvasItem(context, {
            id: stableId("canvas-item", `${context.idempotencyKey}:${input.refId}`),
            kind: input.kind,
            refId: input.refId,
            title: input.title,
            position: { x: input.x, y: input.y },
            ...(input.width && input.height
              ? { size: { width: input.width, height: input.height } }
              : {}),
          })
        )
      }
      case "image.generate":
        return toolSuccess(
          call,
          await generateImageAndPlace(call, context, imageGenerateSchema.parse(call.input))
        )
      default:
        return {
          toolCallId: call.id,
          ok: false,
          error: {
            code: "tool-not-found",
            message: `Tool "${call.name}" is not registered.`,
            retryable: false,
          },
        }
    }
  }
}

async function inspectCanvas(context: AgentToolExecutionContext) {
  const snapshot = await gatewaySnapshot(context)
  return {
    workspaceId: snapshot.workspaceId,
    project: snapshot.project,
    canvas: {
      id: snapshot.creativeCanvas.canvasId,
      revision: snapshot.creativeCanvas.revision,
      items: snapshot.creativeCanvas.items,
      relations: snapshot.creativeCanvas.relations,
    },
    workflows: snapshot.workflowDefinitions.map((definition) => ({
      definitionId: definition.definitionId,
      name: definition.name,
      description: definition.description,
      revision: definition.revision,
      lifecycleStatus: definition.lifecycleStatus,
    })),
  }
}

async function generateImageAndPlace(
  call: AgentToolCall,
  context: AgentToolExecutionContext,
  input: z.infer<typeof imageGenerateSchema>
) {
  const userId = initiatedByUserId(context)
  const workspace = createInitialWorkspace()
  const workflow = {
    ...workspace.workflow,
    id: stableId("agent-image-workflow", context.idempotencyKey),
    nodes: workspace.workflow.nodes.map((node) => {
      if (node.data.kind !== "image-generator") return node
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            prompt: { mode: "variable" as const },
            referenceImages: {
              mode: "fixed" as const,
              assetIds: input.referenceImageAssetIds,
            },
          },
          output: {
            size: {
              mode: "preset" as const,
              presetId: input.resolution,
              aspectRatio: input.aspectRatio,
            },
            count: 1,
          },
          quality: input.quality,
        },
      }
    }),
  }
  const compilation = compileWorkflowDefinition(workflow, {
    workspaceId: context.workspaceId,
    definitionId: stableId("agent-image-definition", context.idempotencyKey),
    version: 0,
  })
  if (!compilation.ok) {
    throw new Error(
      `Agent image workflow is invalid: ${compilation.issues
        .map(({ message }) => message)
        .join(" ")}`
    )
  }
  const inputs = {
    prompt: { valueType: "text" as const, value: input.prompt },
  }
  const idempotencyKey = `${context.idempotencyKey}:image-workflow`
  const claim = await claimWorkflowSubmission({
    workspaceId: context.workspaceId,
    userId,
    idempotencyKey,
    requestFingerprint: fingerprintWorkflowSubmission({
      definition: compilation.definition,
      inputs,
    }),
    definition: compilation.definition,
  })

  let workflowRunId: string
  if (claim.state === "claimed") {
    try {
      const run = await start(workflowDefinitionInterpreter, [
        compilation.definition,
        inputs,
        {
          submissionId: claim.submissionId,
          creditContext: claim.creditContext,
        },
      ])
      workflowRunId = run.runId
      await attachWorkflowSdkRun(claim.submissionId, workflowRunId)
    } catch (error) {
      await failWorkflowStart(
        claim.submissionId,
        "Agent image workflow could not be started."
      ).catch(() => undefined)
      throw error
    }
  } else if (claim.state === "replayed") {
    workflowRunId = claim.sdkRunId
  } else if (claim.state === "in-progress") {
    workflowRunId = await waitForAttachedWorkflowRun(
      context.workspaceId,
      idempotencyKey
    )
  } else if (claim.state === "insufficient-credits") {
    throw new Error(
      `Image generation needs ${claim.requiredMicros} credit micros; ${claim.availableMicros} are available.`
    )
  } else {
    throw new Error("The image generation idempotency key conflicts with another request.")
  }

  const run = getRun<WorkflowDefinitionInterpreterResult>(workflowRunId)
  if (!(await run.exists)) throw new Error("The image workflow run was not found.")
  const result = await run.returnValue
  const assets = collectImageAssets(result)
  if (assets.length === 0) {
    throw new Error("The image workflow completed without an image asset.")
  }

  const placedItems = []
  for (const [index, asset] of assets.entries()) {
    const item: CreativeCanvasItem = {
      id: stableId("canvas-image", `${context.idempotencyKey}:${asset.id}`),
      kind: "asset",
      refId: asset.id,
      title: input.title || `Generated image ${index + 1}`,
      position: { x: 120 + index * 48, y: 120 + index * 48 },
      size: fitCanvasSize(asset.width, asset.height),
    }
    const placed = await putCanvasItem(context, item, `image:${asset.id}`)
    placedItems.push(placed.item)
  }

  return {
    workflowRunId,
    assets,
    canvasItems: placedItems,
    toolCallId: call.id,
  }
}

async function putCanvasItem(
  context: AgentToolExecutionContext,
  item: CreativeCanvasItem,
  operationSuffix = "item"
) {
  const snapshot = await gatewaySnapshot(context)
  const command: OperationCommandEnvelope = {
    schemaVersion: OPERATION_COMMAND_SCHEMA_VERSION,
    commandId: stableId("agent-command", `${context.idempotencyKey}:${operationSuffix}`),
    idempotencyKey: `${context.idempotencyKey}:canvas:${operationSuffix}`,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    target: {
      type: "creative-canvas",
      id: snapshot.creativeCanvas.canvasId,
    },
    expectedRevision: snapshot.creativeCanvas.revision,
    actor: { kind: "agent", agentRunId: context.runId },
    issuedAt: new Date().toISOString(),
    payload: { type: "creative.item.put", item },
  }
  const response = await executeOperationCommand({
    command,
    authorizedActor: command.actor,
  })
  if (!response.accepted) {
    throw new Error(response.message || "The canvas rejected the Agent operation.")
  }
  return {
    item,
    canvasId: response.snapshot.creativeCanvas.canvasId,
    revision: response.resultingRevision,
    duplicate: response.duplicate,
  }
}

async function gatewaySnapshot(context: AgentToolExecutionContext) {
  return getOrCreateOperationGatewaySnapshot({
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    userId: initiatedByUserId(context),
  })
}

function initiatedByUserId(context: AgentToolExecutionContext) {
  const value = context.metadata.initiatedByUserId
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("AgentRun is missing its initiating user identity.")
  }
  return value
}

async function waitForAttachedWorkflowRun(
  workspaceId: string,
  idempotencyKey: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await getPgPool().query<{ sdkRunId: string | null }>(
      `
        select sdk_run_id as "sdkRunId"
        from muses_workflow_run
        where workspace_id = $1 and idempotency_key = $2
        limit 1
      `,
      [workspaceId, idempotencyKey]
    )
    const runId = result.rows[0]?.sdkRunId
    if (runId) return runId
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("The existing image workflow is still being attached.")
}

function collectImageAssets(result: WorkflowDefinitionInterpreterResult) {
  const assets: WorkflowRuntimeImageAsset[] = []
  for (const value of Object.values(result.outputs)) {
    if (value.valueType === "image" && value.assets) assets.push(...value.assets)
  }
  return assets
}

function fitCanvasSize(width: number, height: number) {
  const maxEdge = 480
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function stableId(prefix: string, identity: string) {
  return `${prefix}_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`
}

function toolSuccess(call: AgentToolCall, output: unknown): AgentToolCallResult {
  return { toolCallId: call.id, ok: true, output }
}
