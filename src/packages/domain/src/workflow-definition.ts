import type {
  ImageOutputSizeIntent,
  ImagePromptInputSource,
  ImageReferenceInputSource,
  PortValueType,
  WorkflowInputValueType,
} from "./model";

export const WORKFLOW_DEFINITION_SCHEMA_VERSION = "0.3.0-draft";

export type WorkflowDefinitionInput = {
  readonly id: string;
  readonly name: string;
  readonly valueType: WorkflowInputValueType;
  readonly required: boolean;
  readonly defaultValue?: string | number | boolean;
};

export type WorkflowDefinitionInputPort = {
  readonly id: string;
  readonly valueType: PortValueType;
  readonly accepts: readonly PortValueType[];
  readonly required: boolean;
  readonly allowsMultiple: boolean;
};

export type WorkflowDefinitionOutputPort = {
  readonly id: string;
  readonly valueType: PortValueType;
};

type WorkflowDefinitionNodeBase<Kind extends string, Config> = {
  readonly id: string;
  readonly kind: Kind;
  readonly inputPorts: readonly WorkflowDefinitionInputPort[];
  readonly outputPorts: readonly WorkflowDefinitionOutputPort[];
  readonly config: Config;
};

export type WorkflowDefinitionStartNode = WorkflowDefinitionNodeBase<
  "start",
  {
    readonly variables: readonly WorkflowDefinitionInput[];
  }
>;

export type WorkflowDefinitionImageGeneratorNode = WorkflowDefinitionNodeBase<
  "image-generator",
  {
    readonly capabilityId: string;
    readonly modelRef: string;
    readonly inputs: {
      readonly prompt: ImagePromptInputSource;
      readonly referenceImages: ImageReferenceInputSource;
    };
    readonly output: {
      readonly size: ImageOutputSizeIntent;
      readonly count: number;
    };
    readonly quality: string;
  }
>;

export type WorkflowDefinitionSelectorNode = WorkflowDefinitionNodeBase<
  "selector",
  {
    readonly selectionMode: "human";
  }
>;

export type WorkflowDefinitionDesignDocumentNode = WorkflowDefinitionNodeBase<
  "design-document",
  {
    readonly documentId: string;
  }
>;

export type WorkflowDefinitionEndNode = WorkflowDefinitionNodeBase<
  "end",
  Record<string, never>
>;

export type WorkflowDefinitionNode =
  | WorkflowDefinitionStartNode
  | WorkflowDefinitionImageGeneratorNode
  | WorkflowDefinitionSelectorNode
  | WorkflowDefinitionDesignDocumentNode
  | WorkflowDefinitionEndNode;

export type WorkflowDefinitionDataBinding = {
  readonly id: string;
  readonly source: {
    readonly nodeId: string;
    readonly portId: string;
  };
  readonly target: {
    readonly nodeId: string;
    readonly portId: string;
  };
  readonly valueType: PortValueType;
};

export type WorkflowDefinitionControlDependency = {
  readonly id: string;
  readonly predecessorNodeId: string;
  readonly successorNodeId: string;
};

export type WorkflowDefinitionRef = {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly version: number;
  readonly schemaVersion: typeof WORKFLOW_DEFINITION_SCHEMA_VERSION;
};

export type WorkflowDefinition = WorkflowDefinitionRef & {
  readonly source: {
    readonly documentId: string;
    readonly documentSchemaVersion: string;
    readonly documentRevision: number;
  };
  readonly entryNodeId: string;
  readonly exitNodeId: string;
  readonly inputs: readonly WorkflowDefinitionInput[];
  readonly outputs: readonly WorkflowDefinitionInputPort[];
  readonly nodes: readonly WorkflowDefinitionNode[];
  readonly dataBindings: readonly WorkflowDefinitionDataBinding[];
  readonly controlDependencies: readonly WorkflowDefinitionControlDependency[];
  readonly executionOrder: readonly string[];
};

export function getWorkflowDefinitionRef(
  definition: WorkflowDefinition,
): WorkflowDefinitionRef {
  return {
    workspaceId: definition.workspaceId,
    definitionId: definition.definitionId,
    version: definition.version,
    schemaVersion: definition.schemaVersion,
  };
}
