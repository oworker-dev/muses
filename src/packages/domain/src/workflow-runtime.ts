import type { PortValueType } from "./model";
import type { ResolvedImageOutputSize } from "./image-size";
import type {
  WorkflowDefinition,
  WorkflowDefinitionInputPort,
  WorkflowDefinitionRef,
} from "./workflow-definition";

export type WorkflowRuntimeScalarValue =
  | { readonly valueType: "text"; readonly value: string }
  | { readonly valueType: "number"; readonly value: number }
  | { readonly valueType: "boolean"; readonly value: boolean };

export type WorkflowRuntimeImageAsset = {
  readonly id: string;
  readonly url: string;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly prompt: string;
  readonly provider: string;
  readonly modelRef: string;
  readonly createdAt: string;
  readonly outputSize?: ResolvedImageOutputSize;
  readonly normalization?: {
    readonly operation: "cover-crop";
    readonly originalWidth: number;
    readonly originalHeight: number;
  };
  readonly source: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly nodeId: string;
  };
};

export type WorkflowRuntimeValue =
  | WorkflowRuntimeScalarValue
  | {
      readonly valueType: "image";
      readonly assetIds: readonly string[];
      readonly assets?: readonly WorkflowRuntimeImageAsset[];
    }
  | {
      readonly valueType: "design-document";
      readonly documentId: string;
      readonly revision: number;
    };

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowRunSuspension = {
  readonly id: string;
  readonly nodeId: string;
  readonly kind: "human-input" | "external-event";
  readonly requestedPorts: readonly WorkflowDefinitionInputPort[];
  readonly createdAt: string;
};

export type WorkflowRunFailure = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly nodeId?: string;
};

export type WorkflowRunSnapshot = {
  readonly runId: string;
  readonly workspaceId: string;
  readonly definition: WorkflowDefinitionRef;
  readonly status: WorkflowRunStatus;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly retryOfRunId?: string;
  readonly outputs?: Readonly<Record<string, WorkflowRuntimeValue>>;
  readonly suspension?: WorkflowRunSuspension;
  readonly failure?: WorkflowRunFailure;
};

export type StartWorkflowRunRequest = {
  readonly workspaceId: string;
  readonly definition: WorkflowDefinition;
  readonly inputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestedBy: string;
};

export type GetWorkflowRunRequest = {
  readonly workspaceId: string;
  readonly runId: string;
};

export type CancelWorkflowRunRequest = GetWorkflowRunRequest & {
  readonly idempotencyKey: string;
  readonly requestedBy: string;
  readonly reason?: string;
};

export type ResumeWorkflowRunRequest = GetWorkflowRunRequest & {
  readonly suspensionId: string;
  readonly values: Readonly<Record<string, WorkflowRuntimeValue>>;
  readonly idempotencyKey: string;
  readonly requestedBy: string;
};

export type RetryWorkflowRunRequest = GetWorkflowRunRequest & {
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestedBy: string;
};

export type WorkflowRuntimeOperationErrorCode =
  | "definition-invalid"
  | "inputs-invalid"
  | "run-not-found"
  | "run-state-conflict"
  | "suspension-not-found"
  | "resume-values-invalid"
  | "permission-denied"
  | "runtime-unavailable";

export type WorkflowRuntimeOperationError = {
  readonly code: WorkflowRuntimeOperationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly traceId?: string;
};

export type WorkflowRuntimeOperationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: WorkflowRuntimeOperationError };

export interface WorkflowRuntimePort {
  startRun(
    request: StartWorkflowRunRequest,
  ): Promise<WorkflowRuntimeOperationResult<WorkflowRunSnapshot>>;
  getRun(
    request: GetWorkflowRunRequest,
  ): Promise<WorkflowRuntimeOperationResult<WorkflowRunSnapshot>>;
  cancelRun(
    request: CancelWorkflowRunRequest,
  ): Promise<WorkflowRuntimeOperationResult<WorkflowRunSnapshot>>;
  resumeRun(
    request: ResumeWorkflowRunRequest,
  ): Promise<WorkflowRuntimeOperationResult<WorkflowRunSnapshot>>;
  retryRun(
    request: RetryWorkflowRunRequest,
  ): Promise<WorkflowRuntimeOperationResult<WorkflowRunSnapshot>>;
}

export function getWorkflowRuntimeValueType(
  value: WorkflowRuntimeValue,
): PortValueType {
  return value.valueType;
}
