import type {
  PortSpec,
  WorkflowDocumentDraft,
  WorkflowInputVariableDefinition,
  WorkflowNodeDraft,
} from "./model";
import {
  validateWorkflowForPublication,
  type WorkflowPublicationIssue,
  type WorkflowPublicationIssueCode,
} from "./publication";
import { isWorkflowAgentProfileRef } from "./agent-profile";
import {
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  type WorkflowDefinition,
  type WorkflowDefinitionDataBinding,
  type WorkflowDefinitionInput,
  type WorkflowDefinitionInputPort,
  type WorkflowDefinitionNode,
  type WorkflowDefinitionOutput,
  type WorkflowDefinitionOutputPort,
} from "./workflow-definition";

export type WorkflowCompilationOptions = {
  workspaceId: string;
  definitionId: string;
  version: number;
};

export type WorkflowCompilationIssueCode =
  | WorkflowPublicationIssueCode
  | "workspace-id-required"
  | "definition-id-required"
  | "definition-version-invalid"
  | "node-data-invalid";

export type WorkflowCompilationIssue = Omit<
  WorkflowPublicationIssue,
  "code"
> & {
  code: WorkflowCompilationIssueCode;
};

export type WorkflowCompilationResult =
  | {
      ok: true;
      definition: WorkflowDefinition;
      issues: readonly [];
    }
  | {
      ok: false;
      issues: readonly WorkflowCompilationIssue[];
    };

export function compileWorkflowDefinition(
  workflow: WorkflowDocumentDraft,
  options: WorkflowCompilationOptions,
): WorkflowCompilationResult {
  const issues = validateCompilationIdentity(options);
  const publication = validateWorkflowForPublication(workflow);
  issues.push(...publication.issues);

  const executableNodes = workflow.nodes.filter(
    (node) => node.kind !== "image-result",
  );
  const nodesById = new Map(executableNodes.map((node) => [node.id, node]));
  const compiledNodes = new Map<string, WorkflowDefinitionNode>();

  for (const node of executableNodes) {
    const compiled = compileNode(node);
    if (!compiled) {
      issues.push({
        code: "node-data-invalid",
        message: `Node "${node.id}" has data that does not match kind "${node.kind}".`,
        nodeId: node.id,
      });
      continue;
    }
    compiledNodes.set(node.id, compiled);
  }

  if (issues.length > 0 || !publication.valid) {
    return { ok: false, issues };
  }

  const start = executableNodes.find((node) => node.kind === "start");
  const end = executableNodes.find((node) => node.kind === "end");
  if (!start || !end || start.data.kind !== "start") {
    return {
      ok: false,
      issues: [
        {
          code: "node-data-invalid",
          message: "A compiled workflow requires valid Start and End nodes.",
        },
      ],
    };
  }

  const orderedNodes = publication.topologicalOrder
    .map((nodeId) => compiledNodes.get(nodeId))
    .filter((node): node is WorkflowDefinitionNode => Boolean(node));

  const dataBindings: WorkflowDefinitionDataBinding[] = [];
  const controlDependencies: WorkflowDefinition["controlDependencies"][number][] =
    [];
  for (const edge of workflow.edges) {
    const source = nodesById.get(edge.sourceNodeId);
    const target = nodesById.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (edge.kind === "dataflow") {
      if (isFixedImageInput(target, edge.targetPortId)) continue;
      const sourcePort = source.outputPorts.find(
        (port) => port.id === edge.sourcePortId,
      );
      if (!sourcePort) continue;
      dataBindings.push({
        id: edge.id,
        source: { nodeId: edge.sourceNodeId, portId: edge.sourcePortId },
        target: { nodeId: edge.targetNodeId, portId: edge.targetPortId },
        valueType: sourcePort.valueType,
      });
    } else if (edge.kind === "control") {
      controlDependencies.push({
        id: edge.id,
        predecessorNodeId: edge.sourceNodeId,
        successorNodeId: edge.targetNodeId,
      });
    }
  }

  return {
    ok: true,
    issues: [],
    definition: {
      workspaceId: options.workspaceId.trim(),
      definitionId: options.definitionId.trim(),
      version: options.version,
      schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
      source: {
        documentId: workflow.id,
        documentSchemaVersion: workflow.schemaVersion,
        documentRevision: workflow.revision,
      },
      entryNodeId: start.id,
      exitNodeId: end.id,
      inputs: cloneVariables(start.data.variables),
      outputs: end.inputPorts.map(cloneWorkflowOutput),
      nodes: orderedNodes,
      dataBindings,
      controlDependencies,
      executionOrder: [...publication.topologicalOrder],
    },
  };
}

function validateCompilationIdentity(options: WorkflowCompilationOptions) {
  const issues: WorkflowCompilationIssue[] = [];
  if (!options.workspaceId.trim()) {
    issues.push({
      code: "workspace-id-required",
      message: "A WorkflowDefinition requires a workspace id.",
    });
  }
  if (!options.definitionId.trim()) {
    issues.push({
      code: "definition-id-required",
      message: "A WorkflowDefinition requires a stable definition id.",
    });
  }
  if (!Number.isSafeInteger(options.version) || options.version < 0) {
    issues.push({
      code: "definition-version-invalid",
      message: "A WorkflowDefinition version must be a non-negative integer.",
    });
  }
  return issues;
}

function compileNode(node: WorkflowNodeDraft): WorkflowDefinitionNode | null {
  const base = {
    id: node.id,
    inputPorts: node.inputPorts.map(cloneInputPort),
    outputPorts: node.outputPorts.map(cloneOutputPort),
  };

  switch (node.kind) {
    case "start":
      return node.data.kind === "start"
        ? {
            ...base,
            kind: "start",
            config: { variables: cloneVariables(node.data.variables) },
          }
        : null;
    case "image-generator": {
      if (node.data.kind !== "image-generator") return null;
      const data = node.data;
      return {
        ...base,
        inputPorts: base.inputPorts.map((port) =>
          port.id === "prompt"
            ? {
                ...port,
                required: data.inputs.prompt.mode === "variable",
              }
            : port,
        ),
        kind: "image-generator",
        config: {
          capabilityId: data.capabilityId,
          modelRef: data.modelRef,
          inputs: {
            prompt: { ...data.inputs.prompt },
            referenceImages:
              data.inputs.referenceImages.mode === "fixed"
                ? {
                    mode: "fixed",
                    assetIds: [...data.inputs.referenceImages.assetIds],
                  }
                : { mode: "variable" },
          },
          output: {
            size: { ...data.output.size },
            count: data.output.count,
          },
          quality: data.quality,
        },
      };
    }
    case "selector":
      return node.data.kind === "selector"
        ? {
            ...base,
            kind: "selector",
            config: { selectionMode: "human" },
          }
        : null;
    case "design-document":
      return node.data.kind === "design-document"
        ? {
            ...base,
            kind: "design-document",
            config: { documentId: node.data.documentId },
          }
        : null;
    case "agent-run":
      return node.data.kind === "agent-run" &&
        isWorkflowAgentProfileRef({
          profileId: node.data.profileId,
          profileVersion: node.data.profileVersion,
        })
        ? {
            ...base,
            kind: "agent-run",
            config: {
              profileId: node.data.profileId,
              profileVersion: node.data.profileVersion,
              outputMode: node.data.outputMode,
              ...(node.data.inputSchema
                ? { inputSchema: cloneJsonObject(node.data.inputSchema) }
                : {}),
              ...(node.data.outputSchema
                ? { outputSchema: cloneJsonObject(node.data.outputSchema) }
                : {}),
              ...(node.data.requiredPermissions
                ? { requiredPermissions: [...node.data.requiredPermissions] }
                : {}),
              ...(node.data.budget ? { budget: { ...node.data.budget } } : {}),
            },
          }
        : null;
    case "end":
      return node.data.kind === "end"
        ? { ...base, kind: "end", config: {} }
        : null;
    case "image-result":
      return null;
    default:
      return null;
  }
}

function cloneJsonObject(value: Readonly<Record<string, unknown>>) {
  return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, unknown>>
}

function isFixedImageInput(node: WorkflowNodeDraft, portId: string) {
  if (node.data.kind !== "image-generator") return false;
  if (portId === "prompt") return node.data.inputs.prompt.mode === "fixed";
  if (portId === "referenceImages") {
    return node.data.inputs.referenceImages.mode === "fixed";
  }
  return false;
}

function cloneVariables(
  variables: WorkflowInputVariableDefinition[],
): WorkflowDefinitionInput[] {
  return variables.map((variable) => ({
    id: variable.id,
    name: variable.name,
    valueType: variable.valueType,
    required: variable.required,
    ...(variable.defaultValue === undefined
      ? {}
      : { defaultValue: variable.defaultValue }),
  }));
}

function cloneInputPort(port: PortSpec): WorkflowDefinitionInputPort {
  return {
    id: port.id,
    valueType: port.valueType,
    accepts: [...(port.accepts || [port.valueType])],
    required: Boolean(port.required),
    allowsMultiple: Boolean(port.allowsMultiple),
  };
}

function cloneOutputPort(port: PortSpec): WorkflowDefinitionOutputPort {
  return { id: port.id, valueType: port.valueType };
}

function cloneWorkflowOutput(port: PortSpec): WorkflowDefinitionOutput {
  return { ...cloneInputPort(port), name: port.label };
}
