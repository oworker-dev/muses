import type { Point } from "./model";

export const CREATIVE_CANVAS_SCHEMA_VERSION = "0.1.0-draft";
export const PROFESSIONAL_WORKSPACE_SCHEMA_VERSION = "0.1.0-draft";

export type CreativeCanvasRef = {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly canvasId: string;
};

export type CreativeCanvasItemKind =
  | "asset"
  | "artifact"
  | "professional-document"
  | "workflow"
  | "agent-run";

export type CreativeCanvasItem = {
  readonly id: string;
  readonly kind: CreativeCanvasItemKind;
  readonly refId: string;
  readonly title: string;
  readonly position: Point;
  readonly size?: {
    readonly width: number;
    readonly height: number;
  };
};

export type CreativeCanvasRelation = {
  readonly id: string;
  readonly kind: "context" | "provenance" | "association";
  readonly sourceItemId: string;
  readonly targetItemId: string;
};

export type CreativeCanvas = CreativeCanvasRef & {
  readonly schemaVersion: typeof CREATIVE_CANVAS_SCHEMA_VERSION;
  readonly revision: number;
  readonly items: readonly CreativeCanvasItem[];
  readonly relations: readonly CreativeCanvasRelation[];
};

export type ProfessionalWorkflowPlacement = {
  readonly workflowDefinitionId: string;
  readonly position: Point;
  readonly collapsed: boolean;
};

export type ProfessionalWorkspace = {
  readonly schemaVersion: typeof PROFESSIONAL_WORKSPACE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly professionalWorkspaceId: string;
  readonly revision: number;
  readonly workflows: readonly ProfessionalWorkflowPlacement[];
};

export type CreativeSurfaceValidationIssue = {
  readonly code:
    | "identity-required"
    | "revision-invalid"
    | "duplicate-item"
    | "duplicate-relation"
    | "relation-endpoint-missing"
    | "duplicate-workflow-placement";
  readonly message: string;
  readonly id?: string;
};

export function validateCreativeCanvas(
  canvas: CreativeCanvas,
): CreativeSurfaceValidationIssue[] {
  const issues = validateIdentity(
    [canvas.workspaceId, canvas.projectId, canvas.canvasId],
    "CreativeCanvas",
  );
  if (!Number.isInteger(canvas.revision) || canvas.revision < 0) {
    issues.push({
      code: "revision-invalid",
      message: "CreativeCanvas revision must be a non-negative integer.",
    });
  }

  const itemIds = new Set<string>();
  for (const item of canvas.items) {
    if (itemIds.has(item.id)) {
      issues.push({
        code: "duplicate-item",
        message: `CreativeCanvas item "${item.id}" is duplicated.`,
        id: item.id,
      });
    }
    itemIds.add(item.id);
  }

  const relationIds = new Set<string>();
  for (const relation of canvas.relations) {
    if (relationIds.has(relation.id)) {
      issues.push({
        code: "duplicate-relation",
        message: `CreativeCanvas relation "${relation.id}" is duplicated.`,
        id: relation.id,
      });
    }
    relationIds.add(relation.id);
    if (
      !itemIds.has(relation.sourceItemId) ||
      !itemIds.has(relation.targetItemId)
    ) {
      issues.push({
        code: "relation-endpoint-missing",
        message: `CreativeCanvas relation "${relation.id}" references a missing item.`,
        id: relation.id,
      });
    }
  }

  return issues;
}

export function validateProfessionalWorkspace(
  workspace: ProfessionalWorkspace,
): CreativeSurfaceValidationIssue[] {
  const issues = validateIdentity(
    [
      workspace.workspaceId,
      workspace.projectId,
      workspace.professionalWorkspaceId,
    ],
    "ProfessionalWorkspace",
  );
  if (!Number.isInteger(workspace.revision) || workspace.revision < 0) {
    issues.push({
      code: "revision-invalid",
      message: "ProfessionalWorkspace revision must be a non-negative integer.",
    });
  }

  const definitionIds = new Set<string>();
  for (const placement of workspace.workflows) {
    if (definitionIds.has(placement.workflowDefinitionId)) {
      issues.push({
        code: "duplicate-workflow-placement",
        message: `WorkflowDefinition "${placement.workflowDefinitionId}" is placed more than once.`,
        id: placement.workflowDefinitionId,
      });
    }
    definitionIds.add(placement.workflowDefinitionId);
  }
  return issues;
}

function validateIdentity(
  values: readonly string[],
  label: string,
): CreativeSurfaceValidationIssue[] {
  if (values.every((value) => value.trim().length > 0)) return [];
  return [
    {
      code: "identity-required",
      message: `${label} requires workspace, project, and document identity.`,
    },
  ];
}
