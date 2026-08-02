import type {
  PortSpec,
  WorkflowDocumentDraft,
  WorkflowEdgeDraft,
  WorkflowNodeDraft,
} from "./model";
import {
  createEndInputPorts,
  createStartOutputPorts,
  validateWorkflowInputVariables,
  validateWorkflowOutputVariables,
} from "./nodes";

export type WorkflowPublicationIssueCode =
  | "start-count-invalid"
  | "end-count-invalid"
  | "start-variables-invalid"
  | "start-ports-out-of-sync"
  | "end-outputs-invalid"
  | "dangling-edge"
  | "port-missing"
  | "type-mismatch"
  | "duplicate-input-binding"
  | "required-input-unbound"
  | "execution-cycle"
  | "end-unreachable"
  | "node-outside-start-end-path";

export type WorkflowPublicationIssue = {
  code: WorkflowPublicationIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
  portId?: string;
};

export type WorkflowPublicationValidation = {
  valid: boolean;
  issues: WorkflowPublicationIssue[];
  topologicalOrder: string[];
};

const executableEdgeKinds = new Set(["dataflow", "control"]);

export function validateWorkflowForPublication(
  workflow: WorkflowDocumentDraft,
): WorkflowPublicationValidation {
  const issues: WorkflowPublicationIssue[] = [];
  const definitionNodes = workflow.nodes.filter(
    (node) => node.kind !== "image-result",
  );
  const definitionNodeIds = new Set(definitionNodes.map((node) => node.id));
  const allNodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const nodesById = new Map(definitionNodes.map((node) => [node.id, node]));
  const starts = definitionNodes.filter((node) => node.kind === "start");
  const ends = definitionNodes.filter((node) => node.kind === "end");

  if (starts.length !== 1) {
    issues.push({
      code: "start-count-invalid",
      message: `A publishable workflow requires exactly one Start node; found ${starts.length}.`,
    });
  }
  if (ends.length !== 1) {
    issues.push({
      code: "end-count-invalid",
      message: `A publishable workflow requires exactly one End node; found ${ends.length}.`,
    });
  }

  for (const start of starts) {
    if (start.data.kind !== "start") continue;
    const variableIssue = validateWorkflowInputVariables(start.data.variables);
    if (variableIssue) {
      issues.push({
        code: "start-variables-invalid",
        message: variableIssue,
        nodeId: start.id,
      });
    }
    const expectedPorts = createStartOutputPorts(start.data.variables);
    if (!portsMatch(expectedPorts, start.outputPorts)) {
      issues.push({
        code: "start-ports-out-of-sync",
        message: "Start output ports must be derived from its input variables.",
        nodeId: start.id,
      });
    }
  }

  for (const end of ends) {
    const outputs = end.inputPorts.map((port) => ({
      id: port.id,
      name: port.label,
      valueType: port.valueType,
      required: Boolean(port.required),
    }));
    const outputIssue = validateWorkflowOutputVariables(outputs);
    const expectedPorts = createEndInputPorts(outputs);
    if (outputIssue || !portsMatch(expectedPorts, end.inputPorts)) {
      issues.push({
        code: "end-outputs-invalid",
        message:
          outputIssue || "End input ports must be valid named workflow outputs.",
        nodeId: end.id,
      });
    }
  }

  const definitionEdges: WorkflowEdgeDraft[] = [];
  for (const edge of workflow.edges) {
    const source = allNodesById.get(edge.sourceNodeId);
    const target = allNodesById.get(edge.targetNodeId);
    if (!source || !target) {
      issues.push({
        code: "dangling-edge",
        message: "An edge references a node that does not exist.",
        edgeId: edge.id,
      });
      continue;
    }

    // Generated result nodes and their provenance/data edges are run artifacts,
    // not part of the persisted workflow definition that is published.
    if (source.kind === "image-result" || target.kind === "image-result") {
      continue;
    }
    if (
      !definitionNodeIds.has(source.id) ||
      !definitionNodeIds.has(target.id)
    ) {
      continue;
    }
    definitionEdges.push(edge);

    if (edge.kind !== "dataflow") continue;
    const sourcePort = source.outputPorts.find(
      (port) => port.id === edge.sourcePortId,
    );
    const targetPort = target.inputPorts.find(
      (port) => port.id === edge.targetPortId,
    );
    if (!sourcePort || !targetPort) {
      issues.push({
        code: "port-missing",
        message: "A dataflow edge references a port that does not exist.",
        edgeId: edge.id,
      });
      continue;
    }
    const acceptedTypes = targetPort.accepts || [targetPort.valueType];
    if (!acceptedTypes.includes(sourcePort.valueType)) {
      issues.push({
        code: "type-mismatch",
        message: `${sourcePort.valueType} cannot bind to ${targetPort.valueType}.`,
        edgeId: edge.id,
        nodeId: target.id,
        portId: targetPort.id,
      });
    }
  }

  for (const node of definitionNodes) {
    for (const port of node.inputPorts) {
      const bindings = definitionEdges.filter(
        (edge) =>
          edge.kind === "dataflow" &&
          edge.targetNodeId === node.id &&
          edge.targetPortId === port.id,
      );
      if (port.required && bindings.length === 0) {
        issues.push({
          code: "required-input-unbound",
          message: `Required input "${port.label}" is not bound.`,
          nodeId: node.id,
          portId: port.id,
        });
      }
      if (!port.allowsMultiple && bindings.length > 1) {
        issues.push({
          code: "duplicate-input-binding",
          message: `Input "${port.label}" accepts only one binding.`,
          nodeId: node.id,
          portId: port.id,
        });
      }
    }
  }

  const executableEdges = definitionEdges.filter((edge) =>
    executableEdgeKinds.has(edge.kind),
  );
  const { order, hasCycle } = stableTopologicalSort(
    definitionNodes,
    executableEdges,
  );
  if (hasCycle) {
    issues.push({
      code: "execution-cycle",
      message:
        "Executable dataflow and control edges must form an acyclic graph.",
    });
  }

  const start = starts.length === 1 ? starts[0] : undefined;
  const end = ends.length === 1 ? ends[0] : undefined;
  if (start && end && !hasCycle) {
    const forward = collectReachable(start.id, executableEdges);
    const backward = collectReachable(end.id, reverseEdges(executableEdges));
    if (!forward.has(end.id)) {
      issues.push({
        code: "end-unreachable",
        message: "End must be reachable from Start through executable edges.",
        nodeId: end.id,
      });
    }
    for (const node of definitionNodes) {
      if (!forward.has(node.id) || !backward.has(node.id)) {
        issues.push({
          code: "node-outside-start-end-path",
          message: `Node "${node.title}" is not on an executable Start-to-End path.`,
          nodeId: node.id,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    topologicalOrder: hasCycle ? [] : order,
  };
}

function portsMatch(expected: PortSpec[], actual: PortSpec[]) {
  if (expected.length !== actual.length) return false;
  return expected.every((port, index) => {
    const candidate = actual[index];
    return (
      candidate?.id === port.id &&
      candidate.label === port.label &&
      candidate.direction === port.direction &&
      candidate.valueType === port.valueType &&
      Boolean(candidate.required) === Boolean(port.required) &&
      Boolean(candidate.allowsMultiple) === Boolean(port.allowsMultiple) &&
      JSON.stringify(candidate.accepts || []) ===
        JSON.stringify(port.accepts || [])
    );
  });
}

function stableTopologicalSort(
  nodes: WorkflowNodeDraft[],
  edges: WorkflowEdgeDraft[],
) {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    if (!indegree.has(edge.sourceNodeId) || !indegree.has(edge.targetNodeId)) {
      continue;
    }
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) || 0) + 1);
  }

  const pending = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const order: string[] = [];
  while (pending.length > 0) {
    pending.sort(
      (left, right) => (nodeOrder.get(left) || 0) - (nodeOrder.get(right) || 0),
    );
    const current = pending.shift();
    if (!current) break;
    order.push(current);
    for (const target of adjacency.get(current) || []) {
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) pending.push(target);
    }
  }

  return { order, hasCycle: order.length !== nodes.length };
}

function collectReachable(startNodeId: string, edges: WorkflowEdgeDraft[]) {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.sourceNodeId) || [];
    targets.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, targets);
  }
  const reachable = new Set<string>();
  const pending = [startNodeId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    pending.push(...(adjacency.get(current) || []));
  }
  return reachable;
}

function reverseEdges(edges: WorkflowEdgeDraft[]) {
  return edges.map((edge) => ({
    ...edge,
    sourceNodeId: edge.targetNodeId,
    targetNodeId: edge.sourceNodeId,
  }));
}
