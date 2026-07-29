import { z } from "zod"

import {
  WORKFLOW_CATALOG_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  type WorkflowInvocationTarget,
} from "@muses/domain"

import { requireStudioApiAccess } from "@/lib/studio-access"
import {
  WorkflowCatalogStoreError,
  inspectWorkflowInvocationTarget,
  listWorkflowCatalog,
  publishWorkflowDraft,
} from "@/lib/workflow-catalog-store"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const publicationSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  definitionId: z.string().trim().min(1).max(240),
  expectedDraftRevision: z.number().int().nonnegative().optional(),
  deploymentAlias: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{0,62}$/)
    .optional(),
  fixture: z.literal("durable-harness").optional(),
})

export async function POST(request: Request) {
  const parsed = publicationSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return Response.json(
      {
        accepted: false,
        error: "invalid-workflow-publication-request",
        message:
          "A Workspace, stable definition id, and optional draft revision are required.",
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
        message: "Viewer access cannot publish workflows.",
      },
      { status: 403 }
    )
  }
  if (
    parsed.data.fixture &&
    process.env.MUSES_WORKFLOW_HARNESS_ENABLED !== "true"
  ) {
    return Response.json(
      {
        accepted: false,
        error: "workflow-harness-disabled",
        message: "The server-owned workflow Harness is disabled.",
      },
      { status: 403 }
    )
  }

  try {
    const publication = await publishWorkflowDraft({
      ...parsed.data,
      publishedByUserId: access.user.id,
    })
    return Response.json(
      {
        accepted: true,
        schemaVersion: WORKFLOW_CATALOG_SCHEMA_VERSION,
        ...publication,
      },
      { status: publication.published ? 201 : 200 }
    )
  } catch (error) {
    return workflowCatalogErrorResponse(error)
  }
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const workspaceId = search.get("workspaceId")?.trim()
  if (!workspaceId) {
    return Response.json(
      {
        error: "workflow-workspace-required",
        message: "workspaceId is required.",
      },
      { status: 400 }
    )
  }
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response

  const target = targetFromSearch(search, workspaceId)
  try {
    if (target) {
      return Response.json({
        schemaVersion: WORKFLOW_CATALOG_SCHEMA_VERSION,
        inspection: await inspectWorkflowInvocationTarget({
          workspaceId,
          target,
        }),
      })
    }
    return Response.json({
      schemaVersion: WORKFLOW_CATALOG_SCHEMA_VERSION,
      ...(await listWorkflowCatalog({
        workspaceId,
        projectId: search.get("projectId")?.trim() || undefined,
      })),
    })
  } catch (error) {
    return workflowCatalogErrorResponse(error)
  }
}

function targetFromSearch(
  search: URLSearchParams,
  workspaceId: string
): WorkflowInvocationTarget | null {
  const deploymentId = search.get("deploymentId")?.trim()
  if (deploymentId) {
    return { kind: "deployment", workspaceId, deploymentId }
  }
  const definitionId = search.get("definitionId")?.trim()
  const versionValue = search.get("version")
  if (!definitionId || versionValue === null) return null
  const version = Number(versionValue)
  if (!Number.isSafeInteger(version) || version < 1) return null
  return {
    kind: "definition-version",
    definition: {
      workspaceId,
      definitionId,
      version,
      schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
    },
  }
}

export function workflowCatalogErrorResponse(error: unknown) {
  if (!(error instanceof WorkflowCatalogStoreError)) {
    console.error("Workflow Catalog failed", error)
    return Response.json(
      {
        accepted: false,
        error: "workflow-catalog-unavailable",
        message: "The Workflow Catalog is temporarily unavailable.",
      },
      { status: 503 }
    )
  }
  const status =
    error.code === "workflow-draft-not-found" ||
    error.code === "workflow-definition-version-not-found" ||
    error.code === "workflow-deployment-not-found"
      ? 404
      : error.code === "workflow-workspace-mismatch"
        ? 403
        : error.code === "workflow-publication-invalid"
          ? 422
          : 409
  return Response.json(
    {
      accepted: false,
      error: error.code,
      message: error.message,
      ...(error.issues
        ? { validation: { valid: false, issues: error.issues } }
        : {}),
    },
    { status }
  )
}
