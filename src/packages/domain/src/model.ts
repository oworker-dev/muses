export const WORKSPACE_SCHEMA_VERSION = "0.6.0-draft";

export type Point = {
  x: number;
  y: number;
};

export type WorkflowInputValueType = "text" | "number" | "boolean";

export type PortValueType =
  | WorkflowInputValueType
  | "image"
  | "design-document";

export type PortSpec = {
  id: string;
  label: string;
  direction: "input" | "output";
  valueType: PortValueType;
  accepts?: PortValueType[];
  required?: boolean;
  allowsMultiple?: boolean;
};

export type WorkflowEdgeKind =
  | "context"
  | "provenance"
  | "association"
  | "dataflow"
  | "control";

export type WorkflowNodeKind =
  | "start"
  | "image-generator"
  | "image-result"
  | "selector"
  | "design-document"
  | "agent-run"
  | "end";

export type WorkflowInputVariableDefinition = {
  id: string;
  name: string;
  valueType: WorkflowInputValueType;
  required: boolean;
  defaultValue?: string | number | boolean;
};

export type WorkflowOutputVariableDefinition = {
  id: string;
  name: string;
  valueType: PortValueType;
  required: boolean;
};

export type StartNodeData = {
  kind: "start";
  variables: WorkflowInputVariableDefinition[];
};

export type ImagePromptInputSource =
  | { mode: "variable" }
  | { mode: "fixed"; value: string };

export type ImageReferenceInputSource =
  | { mode: "variable" }
  | { mode: "fixed"; assetIds: string[] };

export type ImageOutputSizeIntent =
  | {
      mode: "preset";
      presetId: string;
      aspectRatio: string;
    }
  | {
      mode: "custom";
      width: number;
      height: number;
    };

export type ImageGeneratorNodeData = {
  kind: "image-generator";
  capabilityId: "image.generate.v1" | "deterministic.image.generate.v1";
  modelRef: string;
  inputs: {
    prompt: ImagePromptInputSource;
    referenceImages: ImageReferenceInputSource;
  };
  output: {
    size: ImageOutputSizeIntent;
    count: number;
  };
  quality: string;
  status: "idle" | "running" | "succeeded" | "failed";
  lastJobId?: string;
};

export type ImageResultNodeData = {
  kind: "image-result";
  assetId: string;
  generatorNodeId: string;
  selected: boolean;
  variantLabel: string;
};

export type SelectorNodeData = {
  kind: "selector";
  sourceGeneratorNodeId: string;
  candidateNodeIds: string[];
  selectedNodeId?: string;
};

export type DesignDocumentNodeData = {
  kind: "design-document";
  documentId: string;
  previewAssetId?: string;
};

export type AgentRunNodeData = {
  kind: "agent-run";
  profileId: string;
  profileVersion: string;
  outputMode: "text" | "json";
  inputSchema?: Readonly<Record<string, unknown>>;
  outputSchema?: Readonly<Record<string, unknown>>;
  requiredPermissions?: readonly string[];
  budget?: {
    readonly maxTurns?: number;
    readonly maxModelCalls?: number;
    readonly maxToolCalls?: number;
    readonly maxInputTokens?: number;
    readonly maxOutputTokens?: number;
    readonly maxDurationMs?: number;
  };
};

export type EndNodeData = {
  kind: "end";
};

export type WorkflowNodeData =
  | StartNodeData
  | ImageGeneratorNodeData
  | ImageResultNodeData
  | SelectorNodeData
  | DesignDocumentNodeData
  | AgentRunNodeData
  | EndNodeData;

export type WorkflowNodeDraft = {
  id: string;
  kind: WorkflowNodeKind;
  title: string;
  position: Point;
  inputPorts: PortSpec[];
  outputPorts: PortSpec[];
  data: WorkflowNodeData;
};

export type WorkflowEdgeDraft = {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  kind: WorkflowEdgeKind;
};

export type WorkflowDocumentDraft = {
  id: string;
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  revision: number;
  nodes: WorkflowNodeDraft[];
  edges: WorkflowEdgeDraft[];
};

export type AssetDraft = {
  id: string;
  kind: "image";
  mimeType: "image/svg+xml" | "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  dataUri: string;
  prompt: string;
  createdByJobId: string;
  provenance: {
    capabilityId: string;
    sourceNodeIds: string[];
  };
};

export type JobDraft = {
  id: string;
  capabilityId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  inputNodeIds: string[];
  outputAssetIds: string[];
  costCredits: number;
  createdAt: string;
  completedAt?: string;
};

export type DesignImageElement = {
  id: string;
  kind: "image";
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesignTextElement = {
  id: string;
  kind: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fill: string;
  fontWeight: "normal" | "bold";
};

export type DesignShapeElement = {
  id: string;
  kind: "shape";
  shape: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  cornerRadius: number;
};

export type DesignElement =
  | DesignImageElement
  | DesignTextElement
  | DesignShapeElement;

export type DesignDocumentDraft = {
  id: string;
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  revision: number;
  title: string;
  width: number;
  height: number;
  backgroundAssetId?: string;
  elements: DesignElement[];
  publishedPorts: PortSpec[];
};

export type CommandTargetType = "workflow" | "design-document";

export type MusesCommandPayload =
  | {
      type: "workflow.node.add";
      node: WorkflowNodeDraft;
      designDocument?: DesignDocumentDraft;
    }
  | { type: "workflow.node.move"; nodeId: string; position: Point }
  | { type: "workflow.node.remove"; nodeId: string }
  | { type: "workflow.edge.add"; edge: WorkflowEdgeDraft }
  | { type: "workflow.edge.remove"; edgeId: string }
  | {
      type: "workflow.start.variables.set";
      nodeId: string;
      variables: WorkflowInputVariableDefinition[];
    }
  | {
      type: "workflow.end.outputs.set";
      nodeId: string;
      outputs: WorkflowOutputVariableDefinition[];
    }
  | {
      type: "workflow.image-generator.config.set";
      nodeId: string;
      config: Pick<
        ImageGeneratorNodeData,
        "modelRef" | "inputs" | "output" | "quality"
      >;
    }
  | {
      type: "workflow.agent-run.config.set";
      nodeId: string;
      config: Pick<
        AgentRunNodeData,
        | "profileId"
        | "profileVersion"
        | "outputMode"
        | "inputSchema"
        | "outputSchema"
        | "requiredPermissions"
        | "budget"
      >;
    }
  | {
      type: "workflow.capability.completed";
      generatorNodeId: string;
      selectorNodeId: string;
      resultNodes: WorkflowNodeDraft[];
      resultEdges: WorkflowEdgeDraft[];
      assets: AssetDraft[];
      job: JobDraft;
    }
  | {
      type: "workflow.result.select";
      selectorNodeId: string;
      resultNodeId: string;
      designNodeId: string;
    }
  | {
      type: "design.background.set";
      documentId: string;
      assetId: string;
    }
  | {
      type: "design.text.update";
      documentId: string;
      elementId: string;
      text: string;
    }
  | {
      type: "design.element.move";
      documentId: string;
      elementId: string;
      position: Point;
    };

export type MusesCommandEnvelope = {
  id: string;
  idempotencyKey: string;
  correlationId: string;
  targetType: CommandTargetType;
  targetId: string;
  expectedRevision: number;
  issuedAt: string;
  payload: MusesCommandPayload;
};

export type CommandLogEntry = {
  commandId: string;
  payloadType: MusesCommandPayload["type"];
  targetType: CommandTargetType;
  targetId: string;
  resultingRevision: number;
  issuedAt: string;
};

export type MusesWorkspaceDraft = {
  id: string;
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  workflow: WorkflowDocumentDraft;
  designDocuments: Record<string, DesignDocumentDraft>;
  assets: Record<string, AssetDraft>;
  jobs: Record<string, JobDraft>;
  appliedIdempotencyKeys: string[];
  commandLog: CommandLogEntry[];
};

export type CommandRejectionCode =
  | "revision-conflict"
  | "node-not-found"
  | "node-protected"
  | "node-singleton-violation"
  | "node-invalid"
  | "variables-invalid"
  | "edge-invalid"
  | "document-not-found"
  | "element-not-found"
  | "payload-target-mismatch";

export type ApplyCommandResult =
  | {
      accepted: true;
      duplicate: boolean;
      workspace: MusesWorkspaceDraft;
    }
  | {
      accepted: false;
      code: CommandRejectionCode;
      message: string;
      workspace: MusesWorkspaceDraft;
    };
