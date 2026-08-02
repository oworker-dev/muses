import { describe, expect, it } from "vitest";

import {
  applyMusesCommand,
  compileWorkflowDefinition,
  createCommand,
  createDeterministicImageRun,
  createHarnessWorkspace as createInitialWorkspace,
  createEndInputPorts,
  createNodeDraft,
  getWorkflowDefinitionRef,
  getWorkflowRuntimeValueType,
  type WorkflowDocumentDraft,
} from "../src";

const compilationIdentity = {
  workspaceId: "muses-workspace-alpha",
  definitionId: "launch-workflow",
  version: 7,
};

describe("WorkflowDefinition compiler", () => {
  it("compiles a valid document into a deterministic execution snapshot", () => {
    const result = compileWorkflowDefinition(
      createInitialWorkspace().workflow,
      compilationIdentity,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.definition).toMatchObject({
      ...compilationIdentity,
      schemaVersion: "0.3.0-draft",
      source: {
        documentId: "workflow-alpha",
        documentSchemaVersion: "0.6.0-draft",
        documentRevision: 0,
      },
      entryNodeId: "start-1",
      exitNodeId: "end-1",
      executionOrder: [
        "start-1",
        "image-generator-1",
        "selector-1",
        "design-1",
        "end-1",
      ],
    });
    expect(result.definition.inputs).toEqual([
      {
        id: "prompt",
        name: "prompt",
        valueType: "text",
        required: true,
        defaultValue:
          "A cinematic launch visual for an open AI creation platform, sculptural light, midnight indigo and warm coral accents",
      },
    ]);
    expect(result.definition.outputs).toEqual([
      {
        id: "document",
        name: "Document",
        valueType: "design-document",
        accepts: ["design-document"],
        required: true,
        allowsMultiple: false,
      },
    ]);
    expect(result.definition.dataBindings).toHaveLength(4);
    expect(result.definition.dataBindings[0]).toEqual({
      id: "edge-start-generator",
      source: { nodeId: "start-1", portId: "prompt" },
      target: { nodeId: "image-generator-1", portId: "prompt" },
      valueType: "text",
    });
    expect(getWorkflowDefinitionRef(result.definition)).toEqual({
      ...compilationIdentity,
      schemaVersion: "0.3.0-draft",
    });

    const serialized = JSON.stringify(result.definition);
    for (const editorOnlyField of [
      "position",
      "title",
      "status",
      "lastJobId",
      "sourceGeneratorNodeId",
      "candidateNodeIds",
      "selectedNodeId",
      "reactFlow",
      "xyflow",
    ]) {
      expect(serialized).not.toContain(`"${editorOnlyField}"`);
    }
  });

  it("does not share mutable node, port, or variable objects with the draft", () => {
    const workflow = createInitialWorkspace().workflow;
    const result = compileWorkflowDefinition(workflow, compilationIdentity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const start = workflow.nodes.find((node) => node.data.kind === "start");
    const generator = workflow.nodes.find(
      (node) => node.data.kind === "image-generator",
    );
    if (!start || start.data.kind !== "start") return;
    if (!generator || generator.data.kind !== "image-generator") return;
    start.position.x = 999;
    start.outputPorts[0].label = "Changed label";
    start.data.variables[0].name = "changed_name";
    generator.data.status = "succeeded";

    expect(result.definition.inputs[0].name).toBe("prompt");
    expect(result.definition.nodes[0]).toMatchObject({
      id: "start-1",
      outputPorts: [{ id: "prompt", valueType: "text" }],
      config: { variables: [{ name: "prompt" }] },
    });
    expect(JSON.stringify(result.definition)).not.toContain("999");
    expect(JSON.stringify(result.definition)).not.toContain("succeeded");
  });

  it("excludes generated result nodes and transient selection state", () => {
    const workspace = createInitialWorkspace();
    const execution = applyMusesCommand(
      workspace,
      createCommand(
        workspace,
        createDeterministicImageRun(
          workspace,
          "image-generator-1",
          "selector-1",
        ),
      ),
    );
    expect(execution.accepted).toBe(true);
    if (!execution.accepted) return;

    const result = compileWorkflowDefinition(execution.workspace.workflow, {
      ...compilationIdentity,
      version: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.definition.nodes).toHaveLength(5);
    expect(result.definition.nodes.map((node) => node.kind)).not.toContain(
      "image-result",
    );
    expect(result.definition.dataBindings).toHaveLength(4);
    expect(
      result.definition.nodes.find((node) => node.kind === "selector"),
    ).toMatchObject({ config: { selectionMode: "human" } });
  });

  it("returns diagnostics instead of a partial definition", () => {
    const workflow = createInitialWorkspace().workflow;
    const invalid = {
      ...workflow,
      edges: workflow.edges.filter(
        (edge) => edge.id !== "edge-selector-design",
      ),
    };
    const result = compileWorkflowDefinition(invalid, compilationIdentity);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).not.toHaveProperty("definition");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "required-input-unbound",
        "end-unreachable",
        "node-outside-start-end-path",
      ]),
    );
  });

  it("requires explicit publication identity and matching node data", () => {
    const workflow = createInitialWorkspace().workflow;
    const missingIdentity = compileWorkflowDefinition(workflow, {
      workspaceId: " ",
      definitionId: "",
      version: -1,
    });
    expect(missingIdentity.ok).toBe(false);
    if (!missingIdentity.ok) {
      expect(missingIdentity.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining([
          "workspace-id-required",
          "definition-id-required",
          "definition-version-invalid",
        ]),
      );
    }

    const mismatched = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === "image-generator-1"
          ? { ...node, data: { kind: "end" as const } }
          : node,
      ),
    } as WorkflowDocumentDraft;
    const mismatchResult = compileWorkflowDefinition(
      mismatched,
      compilationIdentity,
    );
    expect(mismatchResult.ok).toBe(false);
    if (!mismatchResult.ok) {
      expect(mismatchResult.issues).toContainEqual(
        expect.objectContaining({
          code: "node-data-invalid",
          nodeId: "image-generator-1",
        }),
      );
    }
  });

  it("keeps runtime values typed without provider or SDK objects", () => {
    expect(
      getWorkflowRuntimeValueType({
        valueType: "design-document",
        documentId: "design-1-document",
        revision: 3,
      }),
    ).toBe("design-document");
  });

  it("compiles agent.run as a host-neutral versioned node", () => {
    const start = createNodeDraft("start", "start-1", { x: 0, y: 0 });
    const agent = createNodeDraft("agent-run", "agent-1", { x: 320, y: 0 });
    const end = createNodeDraft("end", "end-1", { x: 640, y: 0 });
    end.inputPorts = createEndInputPorts([
      {
        id: "result",
        name: "Result",
        valueType: "text",
        required: true,
      },
    ]);
    const workflow: WorkflowDocumentDraft = {
      id: "agent-workflow",
      schemaVersion: "0.6.0-draft",
      revision: 0,
      nodes: [start, agent, end],
      edges: [
        {
          id: "edge-start-agent",
          sourceNodeId: start.id,
          sourcePortId: "prompt",
          targetNodeId: agent.id,
          targetPortId: "message",
          kind: "dataflow",
        },
        {
          id: "edge-agent-end",
          sourceNodeId: agent.id,
          sourcePortId: "result",
          targetNodeId: end.id,
          targetPortId: "result",
          kind: "dataflow",
        },
      ],
    };
    const result = compileWorkflowDefinition(workflow, compilationIdentity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes).toContainEqual(
      expect.objectContaining({
        id: "agent-1",
        kind: "agent-run",
        config: {
          profileId: "general-purpose",
          profileVersion: "0.1.0",
          outputMode: "text",
        },
      }),
    );
    expect(result.definition.outputs).toEqual([
      {
        id: "result",
        name: "Result",
        valueType: "text",
        accepts: ["text"],
        required: true,
        allowsMultiple: false,
      },
    ]);
  });
});
