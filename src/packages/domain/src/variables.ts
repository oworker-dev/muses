import type {
  PortValueType,
  WorkflowDocumentDraft,
  WorkflowEdgeDraft,
} from "./model";

export type WorkflowVariableReference = {
  sourceNodeId: string;
  sourcePortId: string;
  path: string[];
};

export type WorkflowVariableDescriptor = {
  id: string;
  nodeId: string;
  nodeTitle: string;
  portId: string;
  portLabel: string;
  valueType: PortValueType;
  reference: WorkflowVariableReference;
};

export function listAvailableWorkflowVariables(
  workflow: WorkflowDocumentDraft,
  targetNodeId: string,
  targetPortId: string,
): WorkflowVariableDescriptor[] {
  const targetNode = workflow.nodes.find((node) => node.id === targetNodeId);
  const targetPort = targetNode?.inputPorts.find(
    (port) => port.id === targetPortId,
  );
  if (!targetNode || !targetPort) return [];

  const acceptedTypes = targetPort.accepts || [targetPort.valueType];

  return workflow.nodes
    .filter((node) => node.id !== targetNodeId)
    .flatMap((node) =>
      node.outputPorts.map((port) => ({
        node,
        port,
        edge: {
          id: `variable-${node.id}-${port.id}-${targetNodeId}-${targetPortId}`,
          sourceNodeId: node.id,
          sourcePortId: port.id,
          targetNodeId,
          targetPortId,
          kind: "dataflow" as const,
        },
      })),
    )
    .filter(
      ({ port, edge }) =>
        acceptedTypes.includes(port.valueType) &&
        !wouldCreateExecutableCycle(workflow.edges, edge),
    )
    .map(({ node, port }) => ({
      id: `${node.id}.${port.id}`,
      nodeId: node.id,
      nodeTitle: node.title,
      portId: port.id,
      portLabel: port.label,
      valueType: port.valueType,
      reference: {
        sourceNodeId: node.id,
        sourcePortId: port.id,
        path: [],
      },
    }));
}

export function getInputVariableReference(
  workflow: WorkflowDocumentDraft,
  targetNodeId: string,
  targetPortId: string,
): WorkflowVariableReference | null {
  const edge = workflow.edges.find(
    (candidate) =>
      candidate.kind === "dataflow" &&
      candidate.targetNodeId === targetNodeId &&
      candidate.targetPortId === targetPortId,
  );

  return edge
    ? {
        sourceNodeId: edge.sourceNodeId,
        sourcePortId: edge.sourcePortId,
        path: [],
      }
    : null;
}

export function formatVariableReference(reference: WorkflowVariableReference) {
  const path = [
    reference.sourceNodeId,
    reference.sourcePortId,
    ...reference.path,
  ];
  return `{{${path.join(".")}}}`;
}

export function wouldCreateExecutableCycle(
  edges: WorkflowEdgeDraft[],
  candidate: WorkflowEdgeDraft,
) {
  if (candidate.kind !== "dataflow" && candidate.kind !== "control") {
    return false;
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of [...edges, candidate]) {
    if (edge.kind !== "dataflow" && edge.kind !== "control") continue;
    const targets = adjacency.get(edge.sourceNodeId) || [];
    targets.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, targets);
  }

  const pending = [candidate.targetNodeId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === candidate.sourceNodeId) return true;
    visited.add(current);
    pending.push(...(adjacency.get(current) || []));
  }

  return false;
}
