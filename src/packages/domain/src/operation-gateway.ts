import {
  validateCreativeCanvas,
  validateProfessionalWorkspace,
  type CreativeCanvas,
  type CreativeCanvasItem,
  type CreativeCanvasRelation,
  type ProfessionalWorkflowPlacement,
  type ProfessionalWorkspace,
} from "./creative-canvas";
import type { MusesCommandPayload, MusesWorkspaceDraft } from "./model";

export const OPERATION_COMMAND_SCHEMA_VERSION = "0.1.0-draft";

export type OperationActor =
  | { readonly kind: "user"; readonly userId: string }
  | {
      readonly kind: "agent"
      readonly agentRunId: string
      readonly runtime: "standalone"
      readonly initiatedByUserId: string
    }
  | { readonly kind: "api"; readonly clientId: string };

export type CreativeCanvasCommandPayload =
  | { readonly type: "creative.item.put"; readonly item: CreativeCanvasItem }
  | { readonly type: "creative.item.remove"; readonly itemId: string }
  | {
      readonly type: "creative.relation.put";
      readonly relation: CreativeCanvasRelation;
    }
  | {
      readonly type: "creative.relation.remove";
      readonly relationId: string;
    };

export type ProfessionalWorkspaceCommandPayload =
  | {
      readonly type: "professional.workflow.create";
      readonly definitionId: string;
      readonly name: string;
      readonly description?: string;
      readonly position: ProfessionalWorkflowPlacement["position"];
      readonly collapsed: boolean;
    }
  | {
      readonly type: "professional.workflow.place";
      readonly placement: ProfessionalWorkflowPlacement;
    }
  | {
      readonly type: "professional.workflow.remove";
      readonly workflowDefinitionId: string;
    };

export type WorkflowDefinitionCommandPayload =
  | {
      readonly type: "workflow.definition.command";
      readonly command: MusesCommandPayload;
    }
  | { readonly type: "workflow.definition.reset" };

export type OperationCommandEnvelope = {
  readonly schemaVersion: typeof OPERATION_COMMAND_SCHEMA_VERSION;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly target:
    | { readonly type: "creative-canvas"; readonly id: string }
    | { readonly type: "professional-workspace"; readonly id: string }
    | { readonly type: "workflow-definition"; readonly id: string };
  readonly expectedRevision: number;
  readonly actor: OperationActor;
  readonly issuedAt: string;
  readonly payload:
    | CreativeCanvasCommandPayload
    | ProfessionalWorkspaceCommandPayload
    | WorkflowDefinitionCommandPayload;
};

export type OperationCommandRejectionCode =
  | "target-mismatch"
  | "revision-conflict"
  | "item-not-found"
  | "relation-not-found"
  | "relation-invalid"
  | "workflow-placement-not-found"
  | "document-invalid";

export type ApplyOperationDocumentCommandResult<Document> =
  | { readonly accepted: true; readonly document: Document }
  | {
      readonly accepted: false;
      readonly code: OperationCommandRejectionCode;
      readonly message: string;
      readonly document: Document;
    };

export type WorkflowDefinitionDraftProjection = {
  readonly definitionId: string;
  readonly name: string;
  readonly description: string;
  readonly revision: number;
  readonly lifecycleStatus: "draft" | "published" | "archived";
  readonly document: MusesWorkspaceDraft;
};

export type OperationGatewaySnapshot = {
  readonly schemaVersion: typeof OPERATION_COMMAND_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly project: {
    readonly id: string;
    readonly name: string;
  };
  readonly creativeCanvas: CreativeCanvas;
  readonly professionalWorkspace: ProfessionalWorkspace;
  readonly workflowDefinitions: readonly WorkflowDefinitionDraftProjection[];
};

export type OperationCommandResponse = {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly target: OperationCommandEnvelope["target"];
  readonly resultingRevision: number;
  readonly code?: OperationCommandRejectionCode;
  readonly message?: string;
  readonly snapshot: OperationGatewaySnapshot;
};

export function applyCreativeCanvasCommand(
  canvas: CreativeCanvas,
  command: OperationCommandEnvelope,
): ApplyOperationDocumentCommandResult<CreativeCanvas> {
  if (
    command.target.type !== "creative-canvas" ||
    command.target.id !== canvas.canvasId ||
    !command.payload.type.startsWith("creative.")
  ) {
    return reject(
      "target-mismatch",
      "Command does not target this CreativeCanvas.",
      canvas,
    );
  }
  if (command.expectedRevision !== canvas.revision) {
    return reject(
      "revision-conflict",
      `Expected revision ${command.expectedRevision}; current revision is ${canvas.revision}.`,
      canvas,
    );
  }

  const payload = command.payload as CreativeCanvasCommandPayload;
  let next: CreativeCanvas;
  switch (payload.type) {
    case "creative.item.put":
      next = {
        ...canvas,
        revision: canvas.revision + 1,
        items: putById(canvas.items, payload.item),
      };
      break;
    case "creative.item.remove":
      if (!canvas.items.some((item) => item.id === payload.itemId)) {
        return reject(
          "item-not-found",
          `Creative item "${payload.itemId}" was not found.`,
          canvas,
        );
      }
      next = {
        ...canvas,
        revision: canvas.revision + 1,
        items: canvas.items.filter((item) => item.id !== payload.itemId),
        relations: canvas.relations.filter(
          (relation) =>
            relation.sourceItemId !== payload.itemId &&
            relation.targetItemId !== payload.itemId,
        ),
      };
      break;
    case "creative.relation.put":
      if (
        !canvas.items.some(
          (item) => item.id === payload.relation.sourceItemId,
        ) ||
        !canvas.items.some((item) => item.id === payload.relation.targetItemId)
      ) {
        return reject(
          "relation-invalid",
          "Creative relations require existing source and target items.",
          canvas,
        );
      }
      next = {
        ...canvas,
        revision: canvas.revision + 1,
        relations: putById(canvas.relations, payload.relation),
      };
      break;
    case "creative.relation.remove":
      if (!canvas.relations.some(({ id }) => id === payload.relationId)) {
        return reject(
          "relation-not-found",
          `Creative relation "${payload.relationId}" was not found.`,
          canvas,
        );
      }
      next = {
        ...canvas,
        revision: canvas.revision + 1,
        relations: canvas.relations.filter(
          ({ id }) => id !== payload.relationId,
        ),
      };
      break;
  }

  const issues = validateCreativeCanvas(next);
  return issues.length > 0
    ? reject("document-invalid", issues[0].message, canvas)
    : { accepted: true, document: next };
}

export function applyProfessionalWorkspaceCommand(
  workspace: ProfessionalWorkspace,
  command: OperationCommandEnvelope,
): ApplyOperationDocumentCommandResult<ProfessionalWorkspace> {
  if (
    command.target.type !== "professional-workspace" ||
    command.target.id !== workspace.professionalWorkspaceId ||
    !command.payload.type.startsWith("professional.")
  ) {
    return reject(
      "target-mismatch",
      "Command does not target this ProfessionalWorkspace.",
      workspace,
    );
  }
  if (command.expectedRevision !== workspace.revision) {
    return reject(
      "revision-conflict",
      `Expected revision ${command.expectedRevision}; current revision is ${workspace.revision}.`,
      workspace,
    );
  }

  const payload = command.payload as ProfessionalWorkspaceCommandPayload;
  let next: ProfessionalWorkspace;
  switch (payload.type) {
    case "professional.workflow.create":
      next = {
        ...workspace,
        revision: workspace.revision + 1,
        workflows: [
          ...workspace.workflows.filter(
            ({ workflowDefinitionId }) =>
              workflowDefinitionId !== payload.definitionId,
          ),
          {
            workflowDefinitionId: payload.definitionId,
            position: payload.position,
            collapsed: payload.collapsed,
          },
        ],
      };
      break;
    case "professional.workflow.place":
      next = {
        ...workspace,
        revision: workspace.revision + 1,
        workflows: [
          ...workspace.workflows.filter(
            ({ workflowDefinitionId }) =>
              workflowDefinitionId !== payload.placement.workflowDefinitionId,
          ),
          payload.placement,
        ],
      };
      break;
    case "professional.workflow.remove":
      if (
        !workspace.workflows.some(
          ({ workflowDefinitionId }) =>
            workflowDefinitionId === payload.workflowDefinitionId,
        )
      ) {
        return reject(
          "workflow-placement-not-found",
          `WorkflowDefinition "${payload.workflowDefinitionId}" is not placed in this workspace.`,
          workspace,
        );
      }
      next = {
        ...workspace,
        revision: workspace.revision + 1,
        workflows: workspace.workflows.filter(
          ({ workflowDefinitionId }) =>
            workflowDefinitionId !== payload.workflowDefinitionId,
        ),
      };
      break;
  }

  const issues = validateProfessionalWorkspace(next);
  return issues.length > 0
    ? reject("document-invalid", issues[0].message, workspace)
    : { accepted: true, document: next };
}

function putById<T extends { readonly id: string }>(
  values: readonly T[],
  value: T,
): readonly T[] {
  return [...values.filter(({ id }) => id !== value.id), value];
}

function reject<Document>(
  code: OperationCommandRejectionCode,
  message: string,
  document: Document,
): ApplyOperationDocumentCommandResult<Document> {
  return { accepted: false, code, message, document };
}
