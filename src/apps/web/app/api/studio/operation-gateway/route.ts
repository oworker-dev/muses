import { OPERATION_COMMAND_SCHEMA_VERSION } from "@muses/domain"
import { z } from "zod"

import {
  OperationGatewayStoreError,
  executeOperationCommand,
  getOrCreateOperationGatewaySnapshot,
} from "@/lib/operation-gateway-store"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const actorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().trim().min(1) }),
  z.object({ kind: z.literal("agent"), agentRunId: z.string().trim().min(1) }),
  z.object({ kind: z.literal("api"), clientId: z.string().trim().min(1) }),
])

const targetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("creative-canvas"),
    id: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("professional-workspace"),
    id: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("workflow-definition"),
    id: z.string().trim().min(1),
  }),
])

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() })
const operationPayloadTypes = new Set([
  "creative.item.put",
  "creative.item.remove",
  "creative.relation.put",
  "creative.relation.remove",
  "professional.workflow.create",
  "professional.workflow.place",
  "professional.workflow.remove",
  "workflow.definition.command",
  "workflow.definition.reset",
])
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
const payloadSchema = z
  .object({ type: z.string().trim().min(1) })
  .passthrough()
  .superRefine((payload, context) => {
    if (!operationPayloadTypes.has(payload.type)) {
      context.addIssue({
        code: "custom",
        message: "The Operation Gateway payload type is not registered.",
      })
      return
    }
    if (payload.type === "creative.item.put") {
      validatePayload(
        payload,
        z.object({
          type: z.literal("creative.item.put"),
          item: z.object({
            id: z.string().trim().min(1),
            kind: z.enum([
              "asset",
              "artifact",
              "professional-document",
              "workflow",
              "agent-run",
            ]),
            refId: z.string().trim().min(1),
            title: z.string().trim().min(1),
            position: pointSchema,
            size: z
              .object({
                width: z.number().positive().finite(),
                height: z.number().positive().finite(),
              })
              .optional(),
          }),
        }),
        context
      )
    }
    if (payload.type === "creative.item.remove") {
      validatePayload(
        payload,
        z.object({
          type: z.literal("creative.item.remove"),
          itemId: z.string().trim().min(1),
        }),
        context
      )
    }
    if (payload.type === "creative.relation.put") {
      validatePayload(
        payload,
        z.object({
          type: z.literal("creative.relation.put"),
          relation: z.object({
            id: z.string().trim().min(1),
            kind: z.enum(["context", "provenance", "association"]),
            sourceItemId: z.string().trim().min(1),
            targetItemId: z.string().trim().min(1),
          }),
        }),
        context
      )
    }
    if (payload.type === "creative.relation.remove") {
      validatePayload(
        payload,
        z.object({
          type: z.literal("creative.relation.remove"),
          relationId: z.string().trim().min(1),
        }),
        context
      )
    }
    if (payload.type === "professional.workflow.create") {
      const result = z
        .object({
          type: z.literal("professional.workflow.create"),
          definitionId: z.string().trim().min(1).max(200),
          name: z.string().trim().min(1).max(200),
          description: z.string().max(2_000).optional(),
          position: pointSchema,
          collapsed: z.boolean(),
        })
        .safeParse(payload)
      if (!result.success) {
        context.addIssue({
          code: "custom",
          message: "Invalid workflow creation payload.",
        })
      }
    }
    if (payload.type === "workflow.definition.command") {
      const result = z
        .object({
          type: z.literal("workflow.definition.command"),
          command: z.object({ type: z.string().trim().min(1) }).passthrough(),
        })
        .safeParse(payload)
      if (
        !result.success ||
        !workflowCommandTypes.has(result.data.command.type)
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid WorkflowDefinition command payload.",
        })
      }
    }
    if (payload.type === "professional.workflow.place") {
      validatePayload(
        payload,
        z.object({
          type: z.literal("professional.workflow.place"),
          placement: z.object({
            workflowDefinitionId: z.string().trim().min(1),
            position: pointSchema,
            collapsed: z.boolean(),
          }),
        }),
        context
      )
    }
    if (payload.type === "professional.workflow.remove") {
      validatePayload(
        payload,
        z.object({
          type: z.literal("professional.workflow.remove"),
          workflowDefinitionId: z.string().trim().min(1),
        }),
        context
      )
    }
    if (payload.type === "workflow.definition.reset") {
      const result = z
        .object({ type: z.literal("workflow.definition.reset") })
        .safeParse(payload)
      if (!result.success) {
        context.addIssue({
          code: "custom",
          message: "Invalid WorkflowDefinition reset payload.",
        })
      }
    }
  })

function validatePayload(
  payload: unknown,
  schema: z.ZodType,
  context: z.RefinementCtx
) {
  if (!schema.safeParse(payload).success) {
    context.addIssue({
      code: "custom",
      message: "The operation payload does not match its registered schema.",
    })
  }
}

const commandSchema = z.object({
  schemaVersion: z.literal(OPERATION_COMMAND_SCHEMA_VERSION),
  commandId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(1).max(300),
  workspaceId: z.string().trim().min(1).max(200),
  projectId: z.string().trim().min(1).max(200),
  target: targetSchema,
  expectedRevision: z.number().int().nonnegative(),
  actor: actorSchema.optional(),
  issuedAt: z.iso.datetime(),
  payload: payloadSchema,
})

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const workspaceId = search.get("workspaceId") || undefined
  const projectId = search.get("projectId") || undefined
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response

  try {
    return Response.json(
      await getOrCreateOperationGatewaySnapshot({
        workspaceId: access.context.workspace.id,
        userId: access.user.id,
        projectId,
      })
    )
  } catch (error) {
    return storeErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const candidate = await request.json().catch(() => null)
  const parsed = commandSchema.safeParse(candidate)
  if (!parsed.success) {
    return Response.json(
      {
        accepted: false,
        error: "invalid-operation-command",
        message: "A valid versioned OperationCommand envelope is required.",
        issues: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  const access = await requireStudioApiAccess(parsed.data.workspaceId)
  if (!access.ok) return access.response
  if (access.context.workspace.role === "viewer") {
    return Response.json(
      {
        accepted: false,
        error: "workspace-write-forbidden",
        message: "Viewer access cannot mutate Studio state.",
      },
      { status: 403 }
    )
  }

  try {
    const command = {
      ...parsed.data,
      actor: parsed.data.actor || {
        kind: "user" as const,
        userId: access.user.id,
      },
    }
    const result = await executeOperationCommand({
      command: command as Parameters<
        typeof executeOperationCommand
      >[0]["command"],
      authorizedActor: { kind: "user", userId: access.user.id },
      actorEmail: access.user.email,
    })
    const status = result.accepted
      ? 200
      : result.code === "revision-conflict"
        ? 409
        : 422
    return Response.json(result, { status })
  } catch (error) {
    return storeErrorResponse(error)
  }
}

function storeErrorResponse(error: unknown) {
  if (error instanceof OperationGatewayStoreError) {
    const status =
      error.code === "actor-mismatch"
        ? 403
        : error.code === "project-not-found" ||
            error.code === "target-not-found"
          ? 404
          : error.code === "command-id-conflict" ||
              error.code === "receipt-incomplete"
            ? 409
            : 500
    return Response.json(
      { accepted: false, error: error.code, message: error.message },
      { status }
    )
  }
  console.error("Operation Gateway failed", error)
  return Response.json(
    {
      accepted: false,
      error: "operation-gateway-unavailable",
      message: "The Operation Gateway is temporarily unavailable.",
    },
    { status: 503 }
  )
}
