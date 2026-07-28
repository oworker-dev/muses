import type { PortValueType } from "./model";
import type {
  WorkflowDefinition,
  WorkflowDefinitionEndNode,
  WorkflowDefinitionImageGeneratorNode,
  WorkflowDefinitionInputPort,
  WorkflowDefinitionNode,
  WorkflowDefinitionRef,
  WorkflowDefinitionStartNode,
  WorkflowDefinitionDesignDocumentNode,
} from "./workflow-definition";
import type {
  WorkflowRuntimeScalarValue,
  WorkflowRuntimeImageAsset,
  WorkflowRuntimeValue,
} from "./workflow-runtime";

export type WorkflowInterpreterIssueCode =
  | "missing-input"
  | "input-cardinality-invalid"
  | "type-mismatch"
  | "unsupported-node"
  | "missing-output"
  | "invalid-output"
  | "invalid-human-selection"
  | "execution-order-invalid";

export type WorkflowInterpreterIssue = {
  readonly code: WorkflowInterpreterIssueCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly portId?: string;
  readonly expectedValueTypes?: readonly PortValueType[];
  readonly actualValueType?: string;
};

export type WorkflowInterpreterResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly issue: WorkflowInterpreterIssue };

export type WorkflowExecutionState = {
  readonly definition: WorkflowDefinitionRef;
  readonly suppliedInputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>;
  readonly valuesByNode: Readonly<
    Record<string, Readonly<Record<string, WorkflowRuntimeValue>>>
  >;
  readonly completedNodeIds: readonly string[];
  readonly nextNodeIndex: number;
  readonly outputs?: Readonly<Record<string, WorkflowRuntimeValue>>;
};

export type WorkflowExecutableNode =
  | WorkflowDefinitionImageGeneratorNode
  | WorkflowDefinitionDesignDocumentNode;

export type WorkflowNodeExecutionRequest = {
  readonly definition: WorkflowDefinitionRef;
  readonly node: WorkflowExecutableNode;
  readonly inputs: Readonly<Record<string, WorkflowRuntimeValue>>;
};

export type WorkflowNodeExecutor = (
  request: WorkflowNodeExecutionRequest,
) =>
  | Promise<Readonly<Record<string, WorkflowRuntimeValue>>>
  | Readonly<Record<string, WorkflowRuntimeValue>>;

export type WorkflowNodeExecutorRegistry = Readonly<
  Partial<Record<WorkflowExecutableNode["kind"], WorkflowNodeExecutor>>
>;

export type WorkflowNodePreparation =
  | {
      readonly kind: "intrinsic";
      readonly node: WorkflowDefinitionStartNode;
      readonly outputs: Readonly<Record<string, WorkflowRuntimeValue>>;
    }
  | {
      readonly kind: "execute";
      readonly node: WorkflowExecutableNode;
      readonly inputs: Readonly<Record<string, WorkflowRuntimeValue>>;
    }
  | {
      readonly kind: "suspend";
      readonly node: Extract<WorkflowDefinitionNode, { kind: "selector" }>;
      readonly inputs: Readonly<Record<string, WorkflowRuntimeValue>>;
      readonly candidateAssetIds: readonly string[];
      readonly candidateAssets: readonly WorkflowRuntimeImageAsset[];
      readonly requestedPorts: readonly WorkflowDefinitionInputPort[];
    }
  | {
      readonly kind: "complete";
      readonly node: WorkflowDefinitionEndNode;
      readonly outputs: Readonly<Record<string, WorkflowRuntimeValue>>;
    };

export type WorkflowInterpreterRunResult =
  | {
      readonly status: "waiting";
      readonly state: WorkflowExecutionState;
      readonly suspension: Extract<
        WorkflowNodePreparation,
        { kind: "suspend" }
      >;
    }
  | {
      readonly status: "completed";
      readonly state: WorkflowExecutionState;
      readonly outputs: Readonly<Record<string, WorkflowRuntimeValue>>;
    };

export function createWorkflowExecutionState(
  definition: WorkflowDefinition,
  suppliedInputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>,
): WorkflowInterpreterResult<WorkflowExecutionState> {
  const firstNodeId = definition.executionOrder[0];
  if (firstNodeId !== definition.entryNodeId) {
    return failure({
      code: "execution-order-invalid",
      message: "Workflow execution order must begin with the entry node.",
      nodeId: firstNodeId,
    });
  }

  return success({
    definition: definitionRef(definition),
    suppliedInputs: { ...suppliedInputs },
    valuesByNode: {},
    completedNodeIds: [],
    nextNodeIndex: 0,
  });
}

export function prepareNextWorkflowNode(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
): WorkflowInterpreterResult<WorkflowNodePreparation> {
  const nodeId = definition.executionOrder[state.nextNodeIndex];
  if (!nodeId) {
    return failure({
      code: "execution-order-invalid",
      message: "Workflow execution ended without reaching the exit node.",
    });
  }
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return failure({
      code: "unsupported-node",
      message: `Execution order references missing node "${nodeId}".`,
      nodeId,
    });
  }

  switch (node.kind) {
    case "start": {
      const outputs = resolveStartOutputs(node, state.suppliedInputs);
      return outputs.ok
        ? success({ kind: "intrinsic", node, outputs: outputs.value })
        : outputs;
    }
    case "image-generator": {
      const inputs = resolveWorkflowNodeInputs(definition, state, node.id);
      if (!inputs.ok) return inputs;
      const resolved = { ...inputs.value };
      if (node.config.inputs.prompt.mode === "fixed") {
        const prompt = node.config.inputs.prompt.value.trim();
        if (!prompt) {
          return failure({
            code: "missing-input",
            message: `Image generator "${node.id}" requires a non-empty fixed prompt.`,
            nodeId: node.id,
            portId: "prompt",
            expectedValueTypes: ["text"],
          });
        }
        resolved.prompt = { valueType: "text", value: prompt };
      }
      if (node.config.inputs.referenceImages.mode === "fixed") {
        const assetIds = [
          ...new Set(node.config.inputs.referenceImages.assetIds),
        ];
        if (assetIds.length > 0) {
          resolved.referenceImages = { valueType: "image", assetIds };
        } else {
          delete resolved.referenceImages;
        }
      }
      return success({ kind: "execute", node, inputs: resolved });
    }
    case "design-document": {
      const inputs = resolveWorkflowNodeInputs(definition, state, node.id);
      return inputs.ok
        ? success({ kind: "execute", node, inputs: inputs.value })
        : inputs;
    }
    case "selector": {
      const inputs = resolveWorkflowNodeInputs(definition, state, node.id);
      if (!inputs.ok) return inputs;
      const candidates = inputs.value.candidates;
      if (
        !candidates ||
        candidates.valueType !== "image" ||
        candidates.assetIds.length === 0
      ) {
        return failure({
          code: "missing-input",
          message: `Selector node "${node.id}" requires at least one candidate image.`,
          nodeId: node.id,
          portId: "candidates",
          expectedValueTypes: ["image"],
        });
      }
      return success({
        kind: "suspend",
        node,
        inputs: inputs.value,
        candidateAssetIds: [...candidates.assetIds],
        candidateAssets: [...(candidates.assets || [])],
        requestedPorts: node.inputPorts.map(cloneInputPort),
      });
    }
    case "end": {
      const outputs = resolveWorkflowNodeInputs(definition, state, node.id);
      return outputs.ok
        ? success({ kind: "complete", node, outputs: outputs.value })
        : outputs;
    }
    default:
      return failure({
        code: "unsupported-node",
        message: `Node "${nodeId}" has an unsupported executable kind.`,
        nodeId,
      });
  }
}

export function resolveWorkflowNodeInputs(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
  nodeId: string,
): WorkflowInterpreterResult<Readonly<Record<string, WorkflowRuntimeValue>>> {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return failure({
      code: "unsupported-node",
      message: `Cannot resolve inputs for missing node "${nodeId}".`,
      nodeId,
    });
  }

  const resolved: Record<string, WorkflowRuntimeValue> = {};
  for (const port of node.inputPorts) {
    const bindings = definition.dataBindings.filter(
      (binding) =>
        binding.target.nodeId === node.id && binding.target.portId === port.id,
    );
    if (bindings.length === 0) {
      if (port.required) {
        return failure(missingInput(node.id, port));
      }
      continue;
    }
    if (bindings.length > 1 && !port.allowsMultiple) {
      return failure({
        code: "input-cardinality-invalid",
        message: `Input "${node.id}.${port.id}" does not allow multiple bindings.`,
        nodeId: node.id,
        portId: port.id,
      });
    }

    const values: WorkflowRuntimeValue[] = [];
    for (const binding of bindings) {
      const value =
        state.valuesByNode[binding.source.nodeId]?.[binding.source.portId];
      if (!value) return failure(missingInput(node.id, port));
      const validation = validateRuntimeValue(value, port.accepts, {
        nodeId: node.id,
        portId: port.id,
      });
      if (!validation.ok) return validation;
      if (binding.valueType !== value.valueType) {
        return failure({
          code: "type-mismatch",
          message: `Binding "${binding.id}" declared ${binding.valueType} but received ${value.valueType}.`,
          nodeId: node.id,
          portId: port.id,
          expectedValueTypes: [binding.valueType],
          actualValueType: value.valueType,
        });
      }
      values.push(value);
    }

    if (values.length === 1) {
      resolved[port.id] = cloneRuntimeValue(values[0]);
      continue;
    }
    if (values.every((value) => value.valueType === "image")) {
      resolved[port.id] = {
        valueType: "image",
        assetIds: values.flatMap((value) =>
          value.valueType === "image" ? [...value.assetIds] : [],
        ),
        assets: values.flatMap((value) =>
          value.valueType === "image" ? [...(value.assets || [])] : [],
        ),
      };
      continue;
    }
    return failure({
      code: "type-mismatch",
      message: `Input "${node.id}.${port.id}" cannot merge multiple non-image values.`,
      nodeId: node.id,
      portId: port.id,
      expectedValueTypes: [...port.accepts],
    });
  }
  return success(resolved);
}

export function commitWorkflowNodeOutputs(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
  nodeId: string,
  outputs: Readonly<Record<string, WorkflowRuntimeValue>>,
): WorkflowInterpreterResult<WorkflowExecutionState> {
  const expectedNodeId = definition.executionOrder[state.nextNodeIndex];
  if (nodeId !== expectedNodeId) {
    return failure({
      code: "execution-order-invalid",
      message: `Expected node "${expectedNodeId}" but received outputs for "${nodeId}".`,
      nodeId,
    });
  }
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return failure({
      code: "unsupported-node",
      message: `Cannot commit outputs for missing node "${nodeId}".`,
      nodeId,
    });
  }
  if (node.kind === "end") {
    return failure({
      code: "invalid-output",
      message: "End outputs must be committed through workflow completion.",
      nodeId,
    });
  }

  const declaredPorts = new Map(
    node.outputPorts.map((port) => [port.id, port]),
  );
  for (const portId of Object.keys(outputs)) {
    if (!declaredPorts.has(portId)) {
      return failure({
        code: "invalid-output",
        message: `Node "${node.id}" returned undeclared output "${portId}".`,
        nodeId: node.id,
        portId,
      });
    }
  }
  for (const port of node.outputPorts) {
    const value = outputs[port.id];
    if (!value) {
      if (node.kind === "start") continue;
      return failure({
        code: "missing-output",
        message: `Node "${node.id}" did not return output "${port.id}".`,
        nodeId: node.id,
        portId: port.id,
        expectedValueTypes: [port.valueType],
      });
    }
    const validation = validateRuntimeValue(value, [port.valueType], {
      nodeId: node.id,
      portId: port.id,
    });
    if (!validation.ok) return validation;
  }

  return success({
    ...state,
    valuesByNode: {
      ...state.valuesByNode,
      [node.id]: Object.fromEntries(
        Object.entries(outputs).map(([portId, value]) => [
          portId,
          cloneRuntimeValue(value),
        ]),
      ),
    },
    completedNodeIds: [...state.completedNodeIds, node.id],
    nextNodeIndex: state.nextNodeIndex + 1,
  });
}

export function resumeWorkflowHumanSelection(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
  nodeId: string,
  selectedAssetId: string,
): WorkflowInterpreterResult<WorkflowExecutionState> {
  const preparation = prepareNextWorkflowNode(definition, state);
  if (
    !preparation.ok ||
    preparation.value.kind !== "suspend" ||
    preparation.value.node.id !== nodeId
  ) {
    return preparation.ok
      ? failure({
          code: "execution-order-invalid",
          message: `Node "${nodeId}" is not the active human selection node.`,
          nodeId,
        })
      : preparation;
  }
  if (!preparation.value.candidateAssetIds.includes(selectedAssetId)) {
    return failure({
      code: "invalid-human-selection",
      message: `Asset "${selectedAssetId}" is not a candidate for selector "${nodeId}".`,
      nodeId,
      portId: "selected",
      expectedValueTypes: ["image"],
    });
  }
  const selectedAsset = preparation.value.candidateAssets.find(
    (asset) => asset.id === selectedAssetId,
  );
  return commitWorkflowNodeOutputs(definition, state, nodeId, {
    selected: {
      valueType: "image",
      assetIds: [selectedAssetId],
      ...(selectedAsset ? { assets: [selectedAsset] } : {}),
    },
  });
}

export function completeWorkflowExecution(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
  outputs: Readonly<Record<string, WorkflowRuntimeValue>>,
): WorkflowInterpreterResult<WorkflowExecutionState> {
  const nodeId = definition.executionOrder[state.nextNodeIndex];
  if (nodeId !== definition.exitNodeId) {
    return failure({
      code: "execution-order-invalid",
      message: `Workflow cannot complete before exit node "${definition.exitNodeId}".`,
      nodeId,
    });
  }
  for (const port of definition.outputs) {
    const value = outputs[port.id];
    if (!value) return failure(missingInput(nodeId, port));
    const validation = validateRuntimeValue(value, port.accepts, {
      nodeId,
      portId: port.id,
    });
    if (!validation.ok) return validation;
  }
  return success({
    ...state,
    completedNodeIds: [...state.completedNodeIds, nodeId],
    nextNodeIndex: state.nextNodeIndex + 1,
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([portId, value]) => [
        portId,
        cloneRuntimeValue(value),
      ]),
    ),
  });
}

export async function runWorkflowInterpreter(
  definition: WorkflowDefinition,
  suppliedInputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>,
  executors: WorkflowNodeExecutorRegistry,
): Promise<WorkflowInterpreterResult<WorkflowInterpreterRunResult>> {
  const initial = createWorkflowExecutionState(definition, suppliedInputs);
  return initial.ok
    ? continueWorkflowInterpreter(definition, initial.value, executors)
    : initial;
}

export async function continueWorkflowInterpreter(
  definition: WorkflowDefinition,
  initialState: WorkflowExecutionState,
  executors: WorkflowNodeExecutorRegistry,
): Promise<WorkflowInterpreterResult<WorkflowInterpreterRunResult>> {
  let state = initialState;
  while (state.nextNodeIndex < definition.executionOrder.length) {
    const preparation = prepareNextWorkflowNode(definition, state);
    if (!preparation.ok) return preparation;
    switch (preparation.value.kind) {
      case "intrinsic": {
        const committed = commitWorkflowNodeOutputs(
          definition,
          state,
          preparation.value.node.id,
          preparation.value.outputs,
        );
        if (!committed.ok) return committed;
        state = committed.value;
        break;
      }
      case "execute": {
        const executor = executors[preparation.value.node.kind];
        if (!executor) {
          return failure({
            code: "unsupported-node",
            message: `No executor is registered for node kind "${preparation.value.node.kind}".`,
            nodeId: preparation.value.node.id,
          });
        }
        const outputs = await executor({
          definition: definitionRef(definition),
          node: preparation.value.node,
          inputs: preparation.value.inputs,
        });
        const committed = commitWorkflowNodeOutputs(
          definition,
          state,
          preparation.value.node.id,
          outputs,
        );
        if (!committed.ok) return committed;
        state = committed.value;
        break;
      }
      case "suspend":
        return success({
          status: "waiting",
          state,
          suspension: preparation.value,
        });
      case "complete": {
        const completed = completeWorkflowExecution(
          definition,
          state,
          preparation.value.outputs,
        );
        if (!completed.ok) return completed;
        return success({
          status: "completed",
          state: completed.value,
          outputs: completed.value.outputs || {},
        });
      }
    }
  }
  return failure({
    code: "execution-order-invalid",
    message: "Workflow execution order was exhausted without completion.",
  });
}

function resolveStartOutputs(
  node: WorkflowDefinitionStartNode,
  suppliedInputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>,
): WorkflowInterpreterResult<Readonly<Record<string, WorkflowRuntimeValue>>> {
  const outputs: Record<string, WorkflowRuntimeValue> = {};
  for (const variable of node.config.variables) {
    const supplied = suppliedInputs[variable.id];
    const value = supplied || defaultRuntimeValue(variable);
    if (!value) {
      if (variable.required) {
        return failure({
          code: "missing-input",
          message: `Required workflow input "${variable.id}" was not provided.`,
          nodeId: node.id,
          portId: variable.id,
          expectedValueTypes: [variable.valueType],
        });
      }
      continue;
    }
    const validation = validateRuntimeValue(value, [variable.valueType], {
      nodeId: node.id,
      portId: variable.id,
    });
    if (!validation.ok) return validation;
    outputs[variable.id] = cloneRuntimeValue(value);
  }
  return success(outputs);
}

function defaultRuntimeValue(
  variable: WorkflowDefinitionStartNode["config"]["variables"][number],
): WorkflowRuntimeScalarValue | undefined {
  if (variable.defaultValue === undefined) return undefined;
  switch (variable.valueType) {
    case "text":
      return { valueType: "text", value: String(variable.defaultValue) };
    case "number":
      return { valueType: "number", value: Number(variable.defaultValue) };
    case "boolean":
      return { valueType: "boolean", value: Boolean(variable.defaultValue) };
  }
}

function validateRuntimeValue(
  value: WorkflowRuntimeValue,
  acceptedTypes: readonly PortValueType[],
  location: { nodeId: string; portId: string },
): WorkflowInterpreterResult<WorkflowRuntimeValue> {
  const actualType = runtimeValueType(value);
  if (!actualType || !acceptedTypes.includes(actualType as PortValueType)) {
    return failure({
      code: "type-mismatch",
      message: `Value for "${location.nodeId}.${location.portId}" does not match the accepted type.`,
      ...location,
      expectedValueTypes: [...acceptedTypes],
      actualValueType: actualType || "invalid",
    });
  }
  return success(value);
}

function runtimeValueType(value: WorkflowRuntimeValue): string | null {
  if (!value || typeof value !== "object") return null;
  switch (value.valueType) {
    case "text":
      return typeof value.value === "string" ? "text" : null;
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value)
        ? "number"
        : null;
    case "boolean":
      return typeof value.value === "boolean" ? "boolean" : null;
    case "image":
      return Array.isArray(value.assetIds) &&
        value.assetIds.every((assetId) => typeof assetId === "string") &&
        (value.assets === undefined ||
          (Array.isArray(value.assets) &&
            value.assets.every(
              (asset) =>
                typeof asset.id === "string" &&
                typeof asset.url === "string" &&
                typeof asset.prompt === "string" &&
                typeof asset.modelRef === "string" &&
                Number.isSafeInteger(asset.width) &&
                Number.isSafeInteger(asset.height),
            )))
        ? "image"
        : null;
    case "design-document":
      return typeof value.documentId === "string" &&
        Number.isSafeInteger(value.revision) &&
        value.revision >= 0
        ? "design-document"
        : null;
    default:
      return null;
  }
}

function cloneRuntimeValue(value: WorkflowRuntimeValue): WorkflowRuntimeValue {
  switch (value.valueType) {
    case "image":
      return {
        valueType: "image",
        assetIds: [...value.assetIds],
        ...(value.assets
          ? {
              assets: value.assets.map((asset) => ({
                ...asset,
                source: { ...asset.source },
              })),
            }
          : {}),
      };
    case "design-document":
      return {
        valueType: "design-document",
        documentId: value.documentId,
        revision: value.revision,
      };
    default:
      return { ...value };
  }
}

function missingInput(
  nodeId: string,
  port: WorkflowDefinitionInputPort,
): WorkflowInterpreterIssue {
  return {
    code: "missing-input",
    message: `Required input "${nodeId}.${port.id}" has no runtime value.`,
    nodeId,
    portId: port.id,
    expectedValueTypes: [...port.accepts],
  };
}

function cloneInputPort(
  port: WorkflowDefinitionInputPort,
): WorkflowDefinitionInputPort {
  return {
    id: port.id,
    valueType: port.valueType,
    accepts: [...port.accepts],
    required: port.required,
    allowsMultiple: port.allowsMultiple,
  };
}

function definitionRef(definition: WorkflowDefinition): WorkflowDefinitionRef {
  return {
    workspaceId: definition.workspaceId,
    definitionId: definition.definitionId,
    version: definition.version,
    schemaVersion: definition.schemaVersion,
  };
}

function success<Value>(value: Value): WorkflowInterpreterResult<Value> {
  return { ok: true, value };
}

function failure<Value = never>(
  issue: WorkflowInterpreterIssue,
): WorkflowInterpreterResult<Value> {
  return { ok: false, issue };
}
