import type { MusesWorkspaceDraft, WorkflowEdgeDraft } from "./model";
import { WORKSPACE_SCHEMA_VERSION } from "./model";
import { createDesignDocument, createNodeDraft } from "./nodes";

export function createInitialWorkspace(): MusesWorkspaceDraft {
  const start = createNodeDraft("start", "start-1", { x: 80, y: 250 });
  const generator = createNodeDraft("image-generator", "image-generator-1", {
    x: 500,
    y: 250,
  });
  const end = createNodeDraft("end", "end-1", {
    x: 920,
    y: 250,
  });

  return {
    id: "muses-workspace-alpha",
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workflow: {
      id: "workflow-alpha",
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      revision: 0,
      nodes: [start, generator, end],
      edges: [
        edge(
          "edge-start-generator",
          "start-1",
          "prompt",
          "image-generator-1",
          "prompt",
        ),
        edge(
          "edge-generator-end",
          "image-generator-1",
          "image",
          "end-1",
          "image",
        ),
      ],
    },
    designDocuments: {},
    assets: {},
    jobs: {},
    appliedIdempotencyKeys: [],
    commandLog: [],
  };
}

export function createHarnessWorkspace(): MusesWorkspaceDraft {
  const workspace = createInitialWorkspace();
  const selector = createNodeDraft("selector", "selector-1", {
    x: 920,
    y: 250,
  });
  const design = createNodeDraft("design-document", "design-1", {
    x: 1340,
    y: 250,
  });
  const end = createNodeDraft("end", "end-1", { x: 1760, y: 250 });
  const generator = workspace.workflow.nodes.find(
    (node) => node.id === "image-generator-1",
  );
  if (generator?.data.kind === "image-generator") {
    generator.data = {
      ...generator.data,
      capabilityId: "deterministic.image.generate.v1",
      output: { ...generator.data.output, count: 3 },
    };
  }
  end.inputPorts = [
    {
      id: "document",
      label: "Document",
      direction: "input",
      valueType: "design-document",
      accepts: ["design-document"],
      required: true,
      allowsMultiple: false,
    },
  ];
  const documentId =
    design.data.kind === "design-document"
      ? design.data.documentId
      : "design-1-document";
  return {
    ...workspace,
    workflow: {
      ...workspace.workflow,
      nodes: [workspace.workflow.nodes[0], generator!, selector, design, end],
      edges: [
        edge(
          "edge-start-generator",
          "start-1",
          "prompt",
          "image-generator-1",
          "prompt",
        ),
        edge(
          "edge-generator-selector",
          "image-generator-1",
          "image",
          "selector-1",
          "candidates",
        ),
        edge(
          "edge-selector-design",
          "selector-1",
          "selected",
          "design-1",
          "image",
        ),
        edge("edge-design-end", "design-1", "document", "end-1", "document"),
      ],
    },
    designDocuments: { [documentId]: createDesignDocument(documentId) },
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): WorkflowEdgeDraft {
  return {
    id,
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
    kind: "dataflow",
  };
}
