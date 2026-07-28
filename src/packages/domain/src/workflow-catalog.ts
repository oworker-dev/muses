import type { WorkflowDefinitionRef } from "./workflow-definition";

export const WORKFLOW_CATALOG_SCHEMA_VERSION = "0.1.0-draft";

export type WorkflowDefinitionCatalogEntry = {
  readonly schemaVersion: typeof WORKFLOW_CATALOG_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly name: string;
  readonly description: string;
  readonly draftRevision: number;
  readonly latestPublishedVersion?: number;
  readonly status: "draft" | "published" | "archived";
  readonly tags: readonly string[];
};

export type WorkflowDeployment = {
  readonly schemaVersion: typeof WORKFLOW_CATALOG_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly deploymentId: string;
  readonly alias: string;
  readonly definition: WorkflowDefinitionRef;
  readonly status: "active" | "disabled";
};

export type WorkflowInvocationCaller =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "agent"; readonly agentRunId: string }
  | { readonly kind: "api"; readonly clientId: string }
  | { readonly kind: "workflow"; readonly workflowRunId: string };

export type WorkflowInvocationTarget =
  | {
      readonly kind: "definition-version";
      readonly definition: WorkflowDefinitionRef;
    }
  | {
      readonly kind: "deployment";
      readonly workspaceId: string;
      readonly deploymentId: string;
    };

export type StartWorkflowInvocation = {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly target: WorkflowInvocationTarget;
  readonly caller: WorkflowInvocationCaller;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly requestedAt: string;
};

export type WorkflowInvocationResolution =
  | {
      readonly ok: true;
      readonly definition: WorkflowDefinitionRef;
      readonly deploymentId?: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | "identity-required"
        | "deployment-not-found"
        | "deployment-disabled"
        | "workspace-mismatch";
      readonly message: string;
    };

export function resolveWorkflowInvocationTarget(
  target: WorkflowInvocationTarget,
  deployments: readonly WorkflowDeployment[],
): WorkflowInvocationResolution {
  if (target.kind === "definition-version") {
    const { workspaceId, definitionId, version } = target.definition;
    if (
      workspaceId.trim().length === 0 ||
      definitionId.trim().length === 0 ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      return {
        ok: false,
        code: "identity-required",
        message: "A workflow invocation requires an exact definition identity and version.",
      };
    }
    return { ok: true, definition: target.definition };
  }

  const deployment = deployments.find(
    (candidate) => candidate.deploymentId === target.deploymentId,
  );
  if (!deployment) {
    return {
      ok: false,
      code: "deployment-not-found",
      message: `Workflow deployment "${target.deploymentId}" was not found.`,
    };
  }
  if (deployment.workspaceId !== target.workspaceId) {
    return {
      ok: false,
      code: "workspace-mismatch",
      message: "Workflow deployments cannot be invoked across Workspace boundaries.",
    };
  }
  if (deployment.status !== "active") {
    return {
      ok: false,
      code: "deployment-disabled",
      message: `Workflow deployment "${target.deploymentId}" is disabled.`,
    };
  }
  return {
    ok: true,
    definition: deployment.definition,
    deploymentId: deployment.deploymentId,
  };
}

export function getWorkflowInvocationDeduplicationKey(
  workspaceId: string,
  request: StartWorkflowInvocation,
): string {
  return `${workspaceId}:${request.idempotencyKey}`;
}
