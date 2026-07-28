import type {
  ApplyCommandResult,
  CommandLogEntry,
  DesignDocumentDraft,
  MusesCommandEnvelope,
  MusesCommandPayload,
  MusesWorkspaceDraft,
  WorkflowEdgeDraft,
  WorkflowNodeDraft,
} from "./model";
import {
  createStartOutputPorts,
  validateWorkflowInputVariables,
} from "./nodes";
import { wouldCreateExecutableCycle } from "./variables";

export function createCommand(
  workspace: MusesWorkspaceDraft,
  payload: MusesCommandPayload,
  correlationId?: string,
): MusesCommandEnvelope {
  const sequence = workspace.commandLog.length + 1;
  const id = `command-${sequence}`;
  const designDocumentId = getDesignDocumentTarget(payload);
  const targetType = designDocumentId ? "design-document" : "workflow";
  const targetId = designDocumentId || workspace.workflow.id;
  const expectedRevision = designDocumentId
    ? (workspace.designDocuments[designDocumentId]?.revision ?? -1)
    : workspace.workflow.revision;

  return {
    id,
    idempotencyKey: id,
    correlationId: correlationId || `correlation-${sequence}`,
    targetType,
    targetId,
    expectedRevision,
    issuedAt: new Date(sequence * 1000).toISOString(),
    payload,
  };
}

export function applyMusesCommand(
  workspace: MusesWorkspaceDraft,
  command: MusesCommandEnvelope,
): ApplyCommandResult {
  if (workspace.appliedIdempotencyKeys.includes(command.idempotencyKey)) {
    return { accepted: true, duplicate: true, workspace };
  }

  if (command.targetType === "workflow") {
    if (command.targetId !== workspace.workflow.id) {
      return reject(
        workspace,
        "payload-target-mismatch",
        "Workflow target does not match.",
      );
    }
    if (command.expectedRevision !== workspace.workflow.revision) {
      return reject(
        workspace,
        "revision-conflict",
        `Expected workflow revision ${command.expectedRevision}, received ${workspace.workflow.revision}.`,
      );
    }
    if (getDesignDocumentTarget(command.payload)) {
      return reject(
        workspace,
        "payload-target-mismatch",
        "Design command cannot target the workflow document.",
      );
    }
    return applyWorkflowCommand(workspace, command);
  }

  const document = workspace.designDocuments[command.targetId];
  if (!document) {
    return reject(
      workspace,
      "document-not-found",
      "Design document was not found.",
    );
  }
  if (command.expectedRevision !== document.revision) {
    return reject(
      workspace,
      "revision-conflict",
      `Expected design revision ${command.expectedRevision}, received ${document.revision}.`,
    );
  }
  if (getDesignDocumentTarget(command.payload) !== command.targetId) {
    return reject(
      workspace,
      "payload-target-mismatch",
      "Design payload target does not match the command target.",
    );
  }
  return applyDesignCommand(workspace, document, command);
}

export function applyCommandSequence(
  workspace: MusesWorkspaceDraft,
  payloads: MusesCommandPayload[],
  correlationId?: string,
) {
  let current = workspace;
  for (const payload of payloads) {
    const result = applyMusesCommand(
      current,
      createCommand(current, payload, correlationId),
    );
    if (!result.accepted) {
      return result;
    }
    current = result.workspace;
  }
  return { accepted: true, duplicate: false, workspace: current } as const;
}

export function validateWorkflowEdge(
  nodes: WorkflowNodeDraft[],
  edges: WorkflowEdgeDraft[],
  edge: WorkflowEdgeDraft,
) {
  const source = nodes.find((node) => node.id === edge.sourceNodeId);
  const target = nodes.find((node) => node.id === edge.targetNodeId);
  if (!source || !target || source.id === target.id) {
    return "Both distinct endpoint nodes are required.";
  }
  const sourcePort = source.outputPorts.find(
    (port) => port.id === edge.sourcePortId,
  );
  const targetPort = target.inputPorts.find(
    (port) => port.id === edge.targetPortId,
  );
  if (!sourcePort || !targetPort) {
    return "The selected source or target port does not exist.";
  }
  const accepted = targetPort.accepts || [targetPort.valueType];
  if (!accepted.includes(sourcePort.valueType)) {
    return `${sourcePort.valueType} cannot connect to ${targetPort.valueType}.`;
  }
  if (
    edges.some(
      (candidate) =>
        candidate.sourceNodeId === edge.sourceNodeId &&
        candidate.sourcePortId === edge.sourcePortId &&
        candidate.targetNodeId === edge.targetNodeId &&
        candidate.targetPortId === edge.targetPortId,
    )
  ) {
    return "This connection already exists.";
  }
  if (
    edge.kind === "dataflow" &&
    !targetPort.allowsMultiple &&
    edges.some(
      (candidate) =>
        candidate.kind === "dataflow" &&
        candidate.targetNodeId === edge.targetNodeId &&
        candidate.targetPortId === edge.targetPortId,
    )
  ) {
    return "This input already has a variable binding.";
  }
  if (wouldCreateExecutableCycle(edges, edge)) {
    return "Executable workflow edges cannot create a cycle.";
  }
  return null;
}

function applyWorkflowCommand(
  workspace: MusesWorkspaceDraft,
  command: MusesCommandEnvelope,
): ApplyCommandResult {
  const payload = command.payload;
  let nodes = workspace.workflow.nodes;
  let edges = workspace.workflow.edges;
  let designDocuments = workspace.designDocuments;
  let assets = workspace.assets;
  let jobs = workspace.jobs;

  switch (payload.type) {
    case "workflow.node.add":
      if (nodes.some((node) => node.id === payload.node.id)) {
        return reject(
          workspace,
          "edge-invalid",
          "A node with this id already exists.",
        );
      }
      if (payload.node.kind !== payload.node.data.kind) {
        return reject(
          workspace,
          "node-not-found",
          "The node kind and node data kind must match.",
        );
      }
      if (
        (payload.node.kind === "start" || payload.node.kind === "end") &&
        nodes.some((node) => node.kind === payload.node.kind)
      ) {
        return reject(
          workspace,
          "node-singleton-violation",
          `A workflow can contain only one ${payload.node.kind} node.`,
        );
      }
      if (payload.node.data.kind === "start") {
        const issue = validateWorkflowInputVariables(
          payload.node.data.variables,
        );
        if (issue) return reject(workspace, "variables-invalid", issue);
      }
      nodes = [...nodes, payload.node];
      if (payload.designDocument) {
        designDocuments = {
          ...designDocuments,
          [payload.designDocument.id]: payload.designDocument,
        };
      }
      break;
    case "workflow.node.move":
      if (!nodes.some((node) => node.id === payload.nodeId)) {
        return reject(
          workspace,
          "node-not-found",
          "The node to move was not found.",
        );
      }
      nodes = nodes.map((node) =>
        node.id === payload.nodeId
          ? { ...node, position: payload.position }
          : node,
      );
      break;
    case "workflow.node.remove": {
      const removed = nodes.find((node) => node.id === payload.nodeId);
      if (!removed) {
        return reject(
          workspace,
          "node-not-found",
          "The node to remove was not found.",
        );
      }
      if (removed.kind === "start" || removed.kind === "end") {
        return reject(
          workspace,
          "node-protected",
          `The ${removed.kind} node is required and cannot be removed.`,
        );
      }
      nodes = nodes.filter((node) => node.id !== payload.nodeId);
      edges = edges.filter(
        (edge) =>
          edge.sourceNodeId !== payload.nodeId &&
          edge.targetNodeId !== payload.nodeId,
      );
      if (removed.data.kind === "design-document") {
        const { [removed.data.documentId]: _removed, ...rest } =
          designDocuments;
        designDocuments = rest;
      }
      break;
    }
    case "workflow.edge.add": {
      const issue = validateWorkflowEdge(nodes, edges, payload.edge);
      if (issue) {
        return reject(workspace, "edge-invalid", issue);
      }
      edges = [...edges, payload.edge];
      break;
    }
    case "workflow.edge.remove":
      edges = edges.filter((edge) => edge.id !== payload.edgeId);
      break;
    case "workflow.start.variables.set": {
      const node = nodes.find((candidate) => candidate.id === payload.nodeId);
      if (!node || node.data.kind !== "start") {
        return reject(
          workspace,
          "node-not-found",
          "The start node was not found.",
        );
      }
      const issue = validateWorkflowInputVariables(payload.variables);
      if (issue) return reject(workspace, "variables-invalid", issue);
      const variableIds = new Set(
        payload.variables.map((variable) => variable.id),
      );
      nodes = nodes.map((candidate) =>
        candidate.id === payload.nodeId && candidate.data.kind === "start"
          ? {
              ...candidate,
              outputPorts: createStartOutputPorts(payload.variables),
              data: { ...candidate.data, variables: payload.variables },
            }
          : candidate,
      );
      const startNode = nodes.find(
        (candidate) => candidate.id === payload.nodeId,
      );
      const startPorts = new Map(
        startNode?.outputPorts.map((port) => [port.id, port]) || [],
      );
      edges = edges.filter((edge) => {
        if (edge.sourceNodeId !== payload.nodeId) return true;
        if (!variableIds.has(edge.sourcePortId)) return false;
        if (edge.kind !== "dataflow") return true;
        const sourcePort = startPorts.get(edge.sourcePortId);
        const target = nodes.find(
          (candidate) => candidate.id === edge.targetNodeId,
        );
        const targetPort = target?.inputPorts.find(
          (port) => port.id === edge.targetPortId,
        );
        if (!sourcePort || !targetPort) return false;
        return (targetPort.accepts || [targetPort.valueType]).includes(
          sourcePort.valueType,
        );
      });
      break;
    }
    case "workflow.image-generator.config.set": {
      const node = nodes.find((candidate) => candidate.id === payload.nodeId);
      if (!node || node.data.kind !== "image-generator") {
        return reject(
          workspace,
          "node-not-found",
          "The image generator node was not found.",
        );
      }
      nodes = nodes.map((candidate) =>
        candidate.id === payload.nodeId &&
        candidate.data.kind === "image-generator"
          ? {
              ...candidate,
              inputPorts: candidate.inputPorts.map((port) =>
                port.id === "prompt"
                  ? {
                      ...port,
                      required: payload.config.inputs.prompt.mode === "variable",
                    }
                  : port,
              ),
              data: {
                ...candidate.data,
                ...payload.config,
                inputs: {
                  prompt: { ...payload.config.inputs.prompt },
                  referenceImages:
                    payload.config.inputs.referenceImages.mode === "fixed"
                      ? {
                          mode: "fixed" as const,
                          assetIds: [
                            ...payload.config.inputs.referenceImages.assetIds,
                          ],
                        }
                      : { mode: "variable" as const },
                },
                output: {
                  size: { ...payload.config.output.size },
                  count: payload.config.output.count,
                },
              },
            }
          : candidate,
      );
      edges = edges.flatMap((edge) => {
        if (
          edge.targetNodeId !== payload.nodeId
        ) {
          return [edge];
        }
        if (edge.targetPortId === "prompt") {
          if (payload.config.inputs.prompt.mode === "fixed") {
            return edge.kind === "dataflow"
              ? [{ ...edge, kind: "control" as const }]
              : [edge];
          }
          return edge.kind === "control" ? [] : [edge];
        }
        if (edge.targetPortId === "referenceImages") {
          return payload.config.inputs.referenceImages.mode === "fixed" &&
            edge.kind === "dataflow"
            ? []
            : [edge];
        }
        return [edge];
      });
      break;
    }
    case "workflow.capability.completed": {
      const generator = nodes.find(
        (node) => node.id === payload.generatorNodeId,
      );
      const selector = nodes.find((node) => node.id === payload.selectorNodeId);
      if (
        !generator ||
        generator.data.kind !== "image-generator" ||
        !selector
      ) {
        return reject(
          workspace,
          "node-not-found",
          "Generator or result selector was not found.",
        );
      }
      const staleResultIds = new Set(
        nodes
          .filter(
            (node) =>
              node.data.kind === "image-result" &&
              node.data.generatorNodeId === payload.generatorNodeId,
          )
          .map((node) => node.id),
      );
      nodes = nodes
        .filter((node) => !staleResultIds.has(node.id))
        .map((node) => {
          if (
            node.id === payload.generatorNodeId &&
            node.data.kind === "image-generator"
          ) {
            return {
              ...node,
              data: {
                ...node.data,
                status: "succeeded" as const,
                lastJobId: payload.job.id,
              },
            };
          }
          if (
            node.id === payload.selectorNodeId &&
            node.data.kind === "selector"
          ) {
            return {
              ...node,
              data: {
                ...node.data,
                candidateNodeIds: payload.resultNodes.map(
                  (result) => result.id,
                ),
                selectedNodeId: undefined,
              },
            };
          }
          return node;
        });
      nodes = [...nodes, ...payload.resultNodes];
      edges = [
        ...edges.filter(
          (edge) =>
            !staleResultIds.has(edge.sourceNodeId) &&
            !staleResultIds.has(edge.targetNodeId),
        ),
        ...payload.resultEdges,
      ];
      assets = {
        ...assets,
        ...Object.fromEntries(payload.assets.map((asset) => [asset.id, asset])),
      };
      jobs = { ...jobs, [payload.job.id]: payload.job };
      break;
    }
    case "workflow.result.select": {
      const selected = nodes.find((node) => node.id === payload.resultNodeId);
      const selector = nodes.find((node) => node.id === payload.selectorNodeId);
      const designNode = nodes.find((node) => node.id === payload.designNodeId);
      if (
        !selected ||
        selected.data.kind !== "image-result" ||
        !selector ||
        selector.data.kind !== "selector" ||
        !designNode ||
        designNode.data.kind !== "design-document"
      ) {
        return reject(
          workspace,
          "node-not-found",
          "Selection targets were not found.",
        );
      }
      const candidateNodeIds = selector.data.candidateNodeIds;
      const selectedAssetId = selected.data.assetId;
      nodes = nodes.map((node) => {
        if (
          node.data.kind === "image-result" &&
          candidateNodeIds.includes(node.id)
        ) {
          return {
            ...node,
            data: { ...node.data, selected: node.id === payload.resultNodeId },
          };
        }
        if (node.id === selector.id && node.data.kind === "selector") {
          return {
            ...node,
            data: { ...node.data, selectedNodeId: payload.resultNodeId },
          };
        }
        if (node.id === designNode.id && node.data.kind === "design-document") {
          return {
            ...node,
            data: { ...node.data, previewAssetId: selectedAssetId },
          };
        }
        return node;
      });
      break;
    }
    default:
      return reject(
        workspace,
        "payload-target-mismatch",
        "Design command cannot be applied to the workflow.",
      );
  }

  const workflow = {
    ...workspace.workflow,
    revision: workspace.workflow.revision + 1,
    nodes,
    edges,
  };
  return accept(
    {
      ...workspace,
      workflow,
      designDocuments,
      assets,
      jobs,
    },
    command,
    workflow.revision,
  );
}

function applyDesignCommand(
  workspace: MusesWorkspaceDraft,
  document: DesignDocumentDraft,
  command: MusesCommandEnvelope,
): ApplyCommandResult {
  const payload = command.payload;
  let nextDocument = document;

  switch (payload.type) {
    case "design.background.set": {
      const asset = workspace.assets[payload.assetId];
      if (!asset) {
        return reject(
          workspace,
          "node-not-found",
          "The selected asset was not found.",
        );
      }
      const imageElement = {
        id: "hero-image",
        kind: "image" as const,
        assetId: asset.id,
        x: 0,
        y: 0,
        width: document.width,
        height: document.height,
      };
      nextDocument = {
        ...document,
        backgroundAssetId: asset.id,
        elements: [
          imageElement,
          ...document.elements.filter((element) => element.kind !== "image"),
        ],
      };
      break;
    }
    case "design.text.update": {
      const element = document.elements.find(
        (candidate) =>
          candidate.id === payload.elementId && candidate.kind === "text",
      );
      if (!element) {
        return reject(
          workspace,
          "element-not-found",
          "The text element was not found.",
        );
      }
      nextDocument = {
        ...document,
        elements: document.elements.map((candidate) =>
          candidate.id === payload.elementId && candidate.kind === "text"
            ? { ...candidate, text: payload.text }
            : candidate,
        ),
      };
      break;
    }
    case "design.element.move": {
      const element = document.elements.find(
        (candidate) => candidate.id === payload.elementId,
      );
      if (!element) {
        return reject(
          workspace,
          "element-not-found",
          "The design element was not found.",
        );
      }
      nextDocument = {
        ...document,
        elements: document.elements.map((candidate) =>
          candidate.id === payload.elementId
            ? { ...candidate, x: payload.position.x, y: payload.position.y }
            : candidate,
        ),
      };
      break;
    }
    default:
      return reject(
        workspace,
        "payload-target-mismatch",
        "Workflow command cannot be applied to a design document.",
      );
  }

  nextDocument = { ...nextDocument, revision: document.revision + 1 };
  return accept(
    {
      ...workspace,
      designDocuments: {
        ...workspace.designDocuments,
        [document.id]: nextDocument,
      },
    },
    command,
    nextDocument.revision,
  );
}

function accept(
  workspace: MusesWorkspaceDraft,
  command: MusesCommandEnvelope,
  resultingRevision: number,
): ApplyCommandResult {
  const entry: CommandLogEntry = {
    commandId: command.id,
    payloadType: command.payload.type,
    targetType: command.targetType,
    targetId: command.targetId,
    resultingRevision,
    issuedAt: command.issuedAt,
  };
  return {
    accepted: true,
    duplicate: false,
    workspace: {
      ...workspace,
      appliedIdempotencyKeys: [
        ...workspace.appliedIdempotencyKeys,
        command.idempotencyKey,
      ].slice(-200),
      commandLog: [...workspace.commandLog, entry].slice(-100),
    },
  };
}

function reject(
  workspace: MusesWorkspaceDraft,
  code: Extract<ApplyCommandResult, { accepted: false }>["code"],
  message: string,
): ApplyCommandResult {
  return { accepted: false, code, message, workspace };
}

function getDesignDocumentTarget(payload: MusesCommandPayload) {
  switch (payload.type) {
    case "design.background.set":
    case "design.text.update":
    case "design.element.move":
      return payload.documentId;
    default:
      return null;
  }
}
