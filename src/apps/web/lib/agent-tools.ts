import { createHash } from "node:crypto"

import { getRun, start } from "workflow/api"
import { z } from "zod"

import {
  OPERATION_COMMAND_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  compileWorkflowDefinition,
  createInitialWorkspace,
  type CreativeCanvasItem,
  type MusesCommandPayload,
  type OperationCommandEnvelope,
  type WorkflowInvocationTarget,
  type WorkflowInvocationCaller,
  type WorkflowRuntimeImageAsset,
} from "@muses/domain"
import {
  attachWorkflowSdkRun,
  claimWorkflowSubmission,
  failWorkflowStart,
  fingerprintWorkflowSubmission,
} from "@/lib/credit-ledger"
import { nextCreativeCanvasItemPosition } from "@/lib/creative-canvas-placement"
import { getPgPool } from "@/lib/database"
import {
  executeOperationCommand,
  getOrCreateOperationGatewaySnapshot,
} from "@/lib/operation-gateway-store"
import {
  inspectWorkflowInvocationTarget,
  listWorkflowCatalog,
  publishWorkflowDraft,
} from "@/lib/workflow-catalog-store"
import { startPublishedWorkflowInvocation } from "@/lib/workflow-invocation"
import {
  workflowDefinitionInterpreter,
  type WorkflowDefinitionInterpreterResult,
} from "@/workflows/workflow-definition-interpreter"

export type AgentToolCall = {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

export type AgentToolCallResult = {
  readonly toolCallId: string
  readonly ok: boolean
  readonly output?: unknown
  readonly error?: {
    readonly code: string
    readonly message: string
    readonly retryable: boolean
  }
}

export type AgentToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly requiredPermissions: readonly string[]
  readonly sideEffect: "none" | "project-write" | "external"
}

export type AgentToolExecutionContext = {
  readonly workspaceId: string
  readonly projectId: string
  readonly canvasId: string
  readonly sessionId: string
  readonly runId: string
  readonly permissions: readonly string[]
  readonly metadata: Readonly<Record<string, unknown>>
  readonly idempotencyKey: string
  readonly abortSignal?: AbortSignal
}

export const canvasInspectDefinition: AgentToolDefinition = {
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

export const canvasItemPutDefinition: AgentToolDefinition = {
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

export const imageGenerateDefinition: AgentToolDefinition = {
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
  sideEffect: "external",
}

export const workflowListDefinition: AgentToolDefinition = {
  name: "workflow.list",
  description:
    "List the published workflow definitions and callable deployment aliases in the current Muses project.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredPermissions: ["workflow.read"],
  sideEffect: "none",
}

export const workflowInspectDefinition: AgentToolDefinition = {
  name: "workflow.inspect",
  description:
    "Inspect one exact published workflow version or active deployment, including its frozen nodes and input schema.",
  inputSchema: workflowTargetInputSchema(),
  requiredPermissions: ["workflow.read"],
  sideEffect: "none",
}

export const workflowInvokeDefinition: AgentToolDefinition = {
  name: "workflow.invoke",
  description:
    "Start one exact published Muses workflow version or active deployment through the shared authorization, billing, idempotency, and observability boundary.",
  inputSchema: {
    ...workflowTargetInputSchema(),
    properties: {
      ...workflowTargetInputSchema().properties,
      inputs: {
        type: "object",
        additionalProperties: {
          oneOf: [
            runtimeScalarToolSchema("text", "string"),
            runtimeScalarToolSchema("number", "number"),
            runtimeScalarToolSchema("boolean", "boolean"),
          ],
        },
      },
    },
  },
  requiredPermissions: ["workflow.invoke"],
  sideEffect: "external",
}

export const workflowRunInspectDefinition: AgentToolDefinition = {
  name: "workflow.run.inspect",
  description:
    "Inspect one Workflow run started in the current Muses Workspace, including its durable runtime status and completed outputs.",
  inputSchema: {
    type: "object",
    properties: { runId: { type: "string", minLength: 1, maxLength: 240 } },
    required: ["runId"],
    additionalProperties: false,
  },
  requiredPermissions: ["workflow.read"],
  sideEffect: "none",
}

export const workflowRunWaitDefinition: AgentToolDefinition = {
  name: "workflow.run.wait",
  description:
    "Wait server-side for one Workflow run in the current Muses Workspace to settle, without spending model calls on status polling. Returns the latest status when the bounded wait expires.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string", minLength: 1, maxLength: 240 },
      timeoutMs: {
        type: "integer",
        minimum: 1_000,
        maximum: 25_000,
        default: 25_000,
      },
    },
    required: ["runId"],
    additionalProperties: false,
  },
  requiredPermissions: ["workflow.read"],
  sideEffect: "none",
}

export const workflowDraftCreateDefinition: AgentToolDefinition = {
  name: "workflow.draft.create",
  description:
    "Create an empty versioned WorkflowDefinition draft in the current Muses project. Use workflow.draft.command to add nodes and edges, then workflow.validate and workflow.publish.",
  inputSchema: {
    type: "object",
    properties: {
      definitionId: { type: "string", minLength: 1, maxLength: 200 },
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2_000 },
      x: { type: "number" },
      y: { type: "number" },
    },
    required: ["definitionId", "name"],
    additionalProperties: false,
  },
  requiredPermissions: ["workflow.write"],
  sideEffect: "project-write",
}

export const workflowDraftCommandDefinition: AgentToolDefinition = {
  name: "workflow.draft.command",
  description:
    "Apply one registered WorkflowDefinition command with an expected draft revision. Commands are server-validated and idempotent.",
  inputSchema: {
    type: "object",
    properties: {
      definitionId: { type: "string", minLength: 1, maxLength: 200 },
      expectedRevision: { type: "integer", minimum: 0 },
      command: { type: "object" },
    },
    required: ["definitionId", "expectedRevision", "command"],
    additionalProperties: false,
  },
  requiredPermissions: ["workflow.write"],
  sideEffect: "project-write",
}

export const workflowValidateDefinition: AgentToolDefinition = {
  name: "workflow.validate",
  description:
    "Compile and validate a WorkflowDefinition draft without publishing or running it.",
  inputSchema: {
    type: "object",
    properties: {
      definitionId: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["definitionId"],
    additionalProperties: false,
  },
  requiredPermissions: ["workflow.read"],
  sideEffect: "none",
}

export const workflowPublishDefinition: AgentToolDefinition = {
  name: "workflow.publish",
  description:
    "Publish a validated WorkflowDefinition draft as an immutable version and deployment alias.",
  inputSchema: {
    type: "object",
    properties: {
      definitionId: { type: "string", minLength: 1, maxLength: 200 },
      expectedDraftRevision: { type: "integer", minimum: 0 },
      deploymentAlias: { type: "string", minLength: 1, maxLength: 120 },
    },
    required: ["definitionId"],
    additionalProperties: false,
  },
  requiredPermissions: ["workflow.publish"],
  sideEffect: "external",
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

const workflowTargetSchema = z.union([
  z.object({
    deploymentId: z.string().trim().min(1),
    definitionId: z.never().optional(),
    version: z.never().optional(),
  }),
  z.object({
    definitionId: z.string().trim().min(1),
    version: z.number().int().min(1),
    deploymentId: z.never().optional(),
  }),
])
const runtimeScalarSchema = z.discriminatedUnion("valueType", [
  z.object({ valueType: z.literal("text"), value: z.string() }),
  z.object({ valueType: z.literal("number"), value: z.number().finite() }),
  z.object({ valueType: z.literal("boolean"), value: z.boolean() }),
])
const workflowInvokeSchema = workflowTargetSchema.and(
  z.object({ inputs: z.record(z.string(), runtimeScalarSchema).default({}) })
)
const workflowRunInspectSchema = z.object({
  runId: z.string().trim().min(1).max(240),
})
const workflowRunWaitSchema = workflowRunInspectSchema.extend({
  timeoutMs: z.number().int().min(1_000).max(25_000).default(25_000),
})

const workflowDefinitionIdSchema = z.object({
  definitionId: z.string().trim().min(1).max(200),
})

const workflowDraftCreateSchema = z.object({
  definitionId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2_000).optional(),
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
})

const workflowCommandTypes = new Set([
  "workflow.node.add",
  "workflow.node.move",
  "workflow.node.remove",
  "workflow.edge.add",
  "workflow.edge.remove",
  "workflow.start.variables.set",
  "workflow.end.outputs.set",
  "workflow.image-generator.config.set",
  "workflow.agent-run.config.set",
  "workflow.capability.completed",
  "workflow.result.select",
  "design.background.set",
  "design.text.update",
  "design.element.move",
])

const workflowDraftCommandSchema = z.object({
  definitionId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().min(0),
  command: z
    .object({ type: z.string().trim().min(1) })
    .passthrough()
    .refine((value) => workflowCommandTypes.has(value.type), {
      message: "The WorkflowDefinition command type is not registered.",
    }),
})

const workflowPublishSchema = z.object({
  definitionId: z.string().trim().min(1).max(200),
  expectedDraftRevision: z.number().int().min(0).optional(),
  deploymentAlias: z.string().trim().min(1).max(120).optional(),
})

export class MusesAgentToolRegistry {
  async list() {
    return [
      canvasInspectDefinition,
      canvasItemPutDefinition,
      imageGenerateDefinition,
      workflowListDefinition,
      workflowInspectDefinition,
      workflowInvokeDefinition,
      workflowRunInspectDefinition,
      workflowRunWaitDefinition,
      workflowDraftCreateDefinition,
      workflowDraftCommandDefinition,
      workflowValidateDefinition,
      workflowPublishDefinition,
    ]
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
            id: stableId(
              "canvas-item",
              `${context.idempotencyKey}:${input.refId}`
            ),
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
          await generateImageAndPlace(
            call,
            context,
            imageGenerateSchema.parse(call.input)
          )
        )
      case "workflow.list":
        return toolSuccess(
          call,
          await listWorkflowCatalog({
            workspaceId: context.workspaceId,
            projectId: context.projectId,
          })
        )
      case "workflow.inspect": {
        const input = workflowTargetSchema.parse(call.input)
        return toolSuccess(
          call,
          await inspectWorkflowInvocationTarget({
            workspaceId: context.workspaceId,
            target: workflowTarget(context.workspaceId, input),
          })
        )
      }
      case "workflow.invoke":
        return toolSuccess(
          call,
          await invokePublishedWorkflow(
            context,
            workflowInvokeSchema.parse(call.input)
          )
        )
      case "workflow.run.inspect": {
        const input = workflowRunInspectSchema.parse(call.input)
        return toolSuccess(call, await inspectWorkflowRun(context, input.runId))
      }
      case "workflow.run.wait": {
        const input = workflowRunWaitSchema.parse(call.input)
        return toolSuccess(
          call,
          await waitForWorkflowRun(context, input.runId, input.timeoutMs)
        )
      }
      case "workflow.draft.create": {
        const input = workflowDraftCreateSchema.parse(call.input)
        return toolSuccess(call, await createWorkflowDraft(context, input))
      }
      case "workflow.draft.command": {
        const input = workflowDraftCommandSchema.parse(call.input)
        return toolSuccess(
          call,
          await applyWorkflowDraftCommand(context, input)
        )
      }
      case "workflow.validate": {
        const input = workflowDefinitionIdSchema.parse(call.input)
        return toolSuccess(
          call,
          await validateWorkflowDraft(context, input.definitionId)
        )
      }
      case "workflow.publish": {
        const input = workflowPublishSchema.parse(call.input)
        return toolSuccess(call, await publishWorkflow(context, input))
      }
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

async function inspectWorkflowRun(
  context: AgentToolExecutionContext,
  runId: string
) {
  const owned = await getPgPool().query<{
    id: string
    status: string
    workflowDefinitionId: string | null
    workflowDefinitionVersion: number | null
    workflowDeploymentId: string | null
  }>(
    `
      select id, status,
        workflow_definition_id as "workflowDefinitionId",
        workflow_definition_version as "workflowDefinitionVersion",
        workflow_deployment_id as "workflowDeploymentId"
      from muses_workflow_run
      where workspace_id = $1 and sdk_run_id = $2
      limit 1
    `,
    [context.workspaceId, runId]
  )
  const receipt = owned.rows[0]
  if (!receipt)
    throw new Error("The Workflow run was not found in this Workspace.")

  const run = getRun<WorkflowDefinitionInterpreterResult>(runId)
  if (!(await run.exists))
    throw new Error("The durable Workflow run was not found.")
  const status = await run.status
  const result = status === "completed" ? await run.returnValue : undefined
  return {
    runId,
    status,
    submissionId: receipt.id,
    definitionId: receipt.workflowDefinitionId,
    definitionVersion: receipt.workflowDefinitionVersion,
    deploymentId: receipt.workflowDeploymentId,
    ...(result
      ? {
          completedNodeIds: result.completedNodeIds,
          outputs: result.outputs,
        }
      : {}),
  }
}

async function waitForWorkflowRun(
  context: AgentToolExecutionContext,
  runId: string,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs
  let snapshot = await inspectWorkflowRun(context, runId)
  while (
    !["completed", "failed", "cancelled"].includes(snapshot.status) &&
    Date.now() < deadline
  ) {
    if (context.abortSignal?.aborted) {
      throw new Error("The Workflow wait was cancelled by the caller.")
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now())))
    )
    snapshot = await inspectWorkflowRun(context, runId)
  }
  return snapshot
}

async function invokePublishedWorkflow(
  context: AgentToolExecutionContext,
  input: z.infer<typeof workflowInvokeSchema>
) {
  const result = await startPublishedWorkflowInvocation({
    workspaceId: context.workspaceId,
    submittedByUserId: initiatedByUserId(context),
    caller: workflowAgentCaller(context),
    target: workflowTarget(context.workspaceId, input),
    inputs: input.inputs,
    idempotencyKey: `${context.idempotencyKey}:published-workflow`,
  })
  switch (result.state) {
    case "started":
    case "replayed":
      return {
        accepted: true,
        runId: result.runId,
        definition: result.definition,
        deploymentId: result.deploymentId,
        idempotentReplay: result.idempotentReplay,
        estimatedMicros: result.estimatedMicros.toString(),
      }
    case "in-progress":
      throw new Error("The workflow invocation is still being attached.")
    case "idempotency-conflict":
      throw new Error("The workflow invocation idempotency key conflicts.")
    case "insufficient-credits":
      throw new Error(
        `Workflow invocation needs ${result.requiredMicros} credit micros; ${result.availableMicros} are available.`
      )
    case "caller-inactive":
      throw new Error("The AgentRun is no longer active.")
    case "runtime-unavailable":
      throw new Error("The workflow runtime is temporarily unavailable.")
  }
}

async function createWorkflowDraft(
  context: AgentToolExecutionContext,
  input: z.infer<typeof workflowDraftCreateSchema>
) {
  const snapshot = await gatewaySnapshot(context)
  const command: OperationCommandEnvelope = {
    schemaVersion: OPERATION_COMMAND_SCHEMA_VERSION,
    commandId: stableId(
      "agent-workflow-create",
      `${context.idempotencyKey}:${input.definitionId}`
    ),
    idempotencyKey: `${context.idempotencyKey}:workflow:draft:create:${input.definitionId}`,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    target: {
      type: "professional-workspace",
      id: snapshot.professionalWorkspace.professionalWorkspaceId,
    },
    expectedRevision: snapshot.professionalWorkspace.revision,
    actor: operationAgentActor(context),
    issuedAt: new Date().toISOString(),
    payload: {
      type: "professional.workflow.create",
      definitionId: input.definitionId,
      name: input.name,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      position: { x: input.x, y: input.y },
      collapsed: false,
    },
  }
  const response = await executeOperationCommand({
    command,
    authorizedActor: command.actor,
  })
  if (!response.accepted) {
    throw new Error(
      response.message || "The Workflow draft could not be created."
    )
  }
  const definition = response.snapshot.workflowDefinitions.find(
    (candidate) => candidate.definitionId === input.definitionId
  )
  return {
    definitionId: input.definitionId,
    revision: definition?.revision ?? 0,
    lifecycleStatus: definition?.lifecycleStatus ?? "draft",
    snapshot: response.snapshot,
    duplicate: response.duplicate,
  }
}

async function applyWorkflowDraftCommand(
  context: AgentToolExecutionContext,
  input: z.infer<typeof workflowDraftCommandSchema>
) {
  const snapshot = await gatewaySnapshot(context)
  const definition = snapshot.workflowDefinitions.find(
    (candidate) => candidate.definitionId === input.definitionId
  )
  if (!definition)
    throw new Error("The Workflow draft was not found in this project.")
  const command: OperationCommandEnvelope = {
    schemaVersion: OPERATION_COMMAND_SCHEMA_VERSION,
    commandId: stableId(
      "agent-workflow-command",
      `${context.idempotencyKey}:${input.definitionId}:${input.expectedRevision}`
    ),
    idempotencyKey: `${context.idempotencyKey}:workflow:draft:command:${input.definitionId}:${input.expectedRevision}`,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    target: { type: "workflow-definition", id: input.definitionId },
    expectedRevision: input.expectedRevision,
    actor: operationAgentActor(context),
    issuedAt: new Date().toISOString(),
    payload: {
      type: "workflow.definition.command",
      command: input.command as unknown as MusesCommandPayload,
    },
  }
  const response = await executeOperationCommand({
    command,
    authorizedActor: command.actor,
  })
  if (!response.accepted) {
    throw new Error(
      response.message || "The Workflow draft rejected the command."
    )
  }
  const next = response.snapshot.workflowDefinitions.find(
    (candidate) => candidate.definitionId === input.definitionId
  )
  return {
    definitionId: input.definitionId,
    revision: next?.revision ?? response.resultingRevision,
    snapshot: response.snapshot,
    duplicate: response.duplicate,
  }
}

async function validateWorkflowDraft(
  context: AgentToolExecutionContext,
  definitionId: string
) {
  const snapshot = await gatewaySnapshot(context)
  const draft = snapshot.workflowDefinitions.find(
    (candidate) => candidate.definitionId === definitionId
  )
  if (!draft)
    throw new Error("The Workflow draft was not found in this project.")
  const compilation = compileWorkflowDefinition(draft.document.workflow, {
    workspaceId: context.workspaceId,
    definitionId,
    version: 0,
  })
  if (!compilation.ok) {
    return {
      valid: false,
      definitionId,
      revision: draft.revision,
      issues: compilation.issues,
    }
  }
  return {
    valid: true,
    definitionId,
    revision: draft.revision,
    definition: compilation.definition,
  }
}

async function publishWorkflow(
  context: AgentToolExecutionContext,
  input: z.infer<typeof workflowPublishSchema>
) {
  const publication = await publishWorkflowDraft({
    workspaceId: context.workspaceId,
    definitionId: input.definitionId,
    expectedDraftRevision: input.expectedDraftRevision,
    publishedByUserId: initiatedByUserId(context),
    deploymentAlias: input.deploymentAlias,
  })
  return {
    definition: publication.definition,
    deployment: publication.deployment,
    draftRevision: publication.draftRevision,
    published: publication.published,
  }
}

function workflowTarget(
  workspaceId: string,
  input: z.infer<typeof workflowTargetSchema>
): WorkflowInvocationTarget {
  if (input.deploymentId) {
    return { kind: "deployment", workspaceId, deploymentId: input.deploymentId }
  }
  if (!input.definitionId || !input.version) {
    throw new Error("An exact workflow target is required.")
  }
  return {
    kind: "definition-version",
    definition: {
      workspaceId,
      definitionId: input.definitionId,
      version: input.version,
      schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
    },
  }
}

function workflowTargetInputSchema() {
  return {
    type: "object",
    properties: {
      deploymentId: { type: "string", minLength: 1 },
      definitionId: { type: "string", minLength: 1 },
      version: { type: "integer", minimum: 1 },
    },
    oneOf: [
      { required: ["deploymentId"] },
      { required: ["definitionId", "version"] },
    ],
    additionalProperties: false,
  }
}

function runtimeScalarToolSchema(
  valueType: "text" | "number" | "boolean",
  valueJsonType: "string" | "number" | "boolean"
) {
  return {
    type: "object",
    properties: {
      valueType: { const: valueType },
      value: { type: valueJsonType },
    },
    required: ["valueType", "value"],
    additionalProperties: false,
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
    caller: workflowAgentCaller(context),
  })

  let workflowRunId: string
  if (claim.state === "claimed") {
    let run: Awaited<ReturnType<typeof start>> | undefined
    try {
      run = await start(workflowDefinitionInterpreter, [
        compilation.definition,
        inputs,
        {
          projectId: context.projectId,
          submissionId: claim.submissionId,
          creditContext: claim.creditContext,
        },
      ])
      workflowRunId = run.runId
      await attachWorkflowSdkRun(claim.submissionId, workflowRunId)
    } catch (error) {
      if (run) await run.cancel().catch(() => undefined)
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
  } else if (claim.state === "caller-inactive") {
    throw new Error("The AgentRun is no longer active.")
  } else {
    throw new Error(
      "The image generation idempotency key conflicts with another request."
    )
  }

  const run = getRun<WorkflowDefinitionInterpreterResult>(workflowRunId)
  if (!(await run.exists))
    throw new Error("The image workflow run was not found.")
  const result = await run.returnValue
  const assets = collectImageAssets(result)
  if (assets.length === 0) {
    throw new Error("The image workflow completed without an image asset.")
  }

  const canvasItems = [...(await gatewaySnapshot(context)).creativeCanvas.items]
  const placedItems = []
  for (const [index, asset] of assets.entries()) {
    const size = fitCanvasSize(asset.width, asset.height)
    const item: CreativeCanvasItem = {
      id: stableId("canvas-image", `${context.idempotencyKey}:${asset.id}`),
      kind: "asset",
      refId: asset.id,
      title: input.title || `Generated image ${index + 1}`,
      position: nextCreativeCanvasItemPosition(canvasItems, size),
      size,
    }
    const placed = await putCanvasItem(context, item, `image:${asset.id}`)
    placedItems.push(placed.item)
    canvasItems.push(placed.item)
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
    commandId: stableId(
      "agent-command",
      `${context.idempotencyKey}:${operationSuffix}`
    ),
    idempotencyKey: `${context.idempotencyKey}:canvas:${operationSuffix}`,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    target: {
      type: "creative-canvas",
      id: snapshot.creativeCanvas.canvasId,
    },
    expectedRevision: snapshot.creativeCanvas.revision,
    actor: operationAgentActor(context),
    issuedAt: new Date().toISOString(),
    payload: { type: "creative.item.put", item },
  }
  const response = await executeOperationCommand({
    command,
    authorizedActor: command.actor,
  })
  if (!response.accepted) {
    throw new Error(
      response.message || "The canvas rejected the Agent operation."
    )
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

function workflowAgentCaller(
  context: AgentToolExecutionContext
): Extract<WorkflowInvocationCaller, { kind: "agent" }> {
  return {
    kind: "agent",
    agentRunId: context.runId,
    runtime: "standalone",
  }
}

function operationAgentActor(
  context: AgentToolExecutionContext
): Extract<OperationCommandEnvelope["actor"], { kind: "agent" }> {
  return {
    kind: "agent",
    agentRunId: context.runId,
    runtime: "standalone",
    initiatedByUserId: initiatedByUserId(context),
  }
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
    if (value.valueType === "image" && value.assets)
      assets.push(...value.assets)
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

function toolSuccess(
  call: AgentToolCall,
  output: unknown
): AgentToolCallResult {
  return { toolCallId: call.id, ok: true, output }
}
