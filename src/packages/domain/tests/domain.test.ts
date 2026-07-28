import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_MODEL_REF,
  applyCommandSequence,
  applyMusesCommand,
  createCommand,
  createDeterministicImageRun,
  createHarnessWorkspace as createInitialWorkspace,
  createNodeDraft,
  formatVariableReference,
  getInputVariableReference,
  listAvailableWorkflowVariables,
  validateWorkflowEdge,
  validateWorkflowForPublication,
  isImageCapabilityProfileSpec,
  type WorkflowEdgeDraft,
  type WorkflowNodeDraft,
} from "../src";

describe("Muses canvas domain", () => {
  it("validates versioned image capability profiles and default model refs", () => {
    expect(DEFAULT_IMAGE_MODEL_REF).toMatch(/^openai\/gpt-image-2@2026-07-28$/);
    expect(
      isImageCapabilityProfileSpec({
        kind: "image-generation",
        inputModes: ["text-to-image", "image-to-image"],
        referenceImages: {
          maxCount: 16,
          mimeTypes: ["image/png", "image/jpeg", "image/webp"],
          maxBytes: 52_428_800,
        },
        aspectRatios: ["1:1"],
        resolutionPresets: [{ id: "1k", label: "1K", longEdge: 1024 }],
        customSize: { enabled: true },
        sizeConstraints: {
          strategy: "continuous-grid",
          dimensionMultiple: 16,
          maxEdge: 3840,
          minPixels: 655_360,
          maxPixels: 8_294_400,
          maxAspectRatio: 3,
          legalization: "nearest",
        },
        outputCounts: [1],
        parameters: {
          quality: {
            type: "enum",
            values: ["medium"],
            default: "medium",
          },
        },
      }),
    ).toBe(true);
    expect(
      isImageCapabilityProfileSpec({
        kind: "image-generation",
        inputModes: ["text-to-image"],
        referenceImages: { maxCount: 0, mimeTypes: [], maxBytes: 0 },
        aspectRatios: [],
        resolutionPresets: [],
        customSize: { enabled: false },
        sizeConstraints: { strategy: "discrete", sizes: [] },
        outputCounts: [0],
        parameters: {
          quality: { type: "enum", values: [], default: "medium" },
        },
      }),
    ).toBe(false);
  });

  it("keeps fixed image inputs local to the downstream node", () => {
    const workspace = createInitialWorkspace();
    const generator = workspace.workflow.nodes.find(
      (node) => node.data.kind === "image-generator",
    );
    expect(generator?.data.kind).toBe("image-generator");
    if (!generator || generator.data.kind !== "image-generator") return;

    const result = applyMusesCommand(
      workspace,
      createCommand(workspace, {
        type: "workflow.image-generator.config.set",
        nodeId: generator.id,
        config: {
          modelRef: generator.data.modelRef,
          inputs: {
            prompt: { mode: "fixed", value: "A local prompt" },
            referenceImages: {
              mode: "fixed",
              assetIds: ["refimg_one"],
            },
          },
          output: generator.data.output,
          quality: generator.data.quality,
        },
      }),
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    const start = result.workspace.workflow.nodes.find(
      (node) => node.data.kind === "start",
    );
    expect(start?.data.kind === "start" && start.data.variables[0].defaultValue)
      .toBe(
        "A cinematic launch visual for an open AI creation platform, sculptural light, midnight indigo and warm coral accents",
      );
    expect(
      result.workspace.workflow.edges.some(
        (edge) =>
          edge.kind === "dataflow" &&
          edge.targetNodeId === generator.id &&
          edge.targetPortId === "prompt",
      ),
    ).toBe(false);
    expect(
      result.workspace.workflow.edges.some(
        (edge) =>
          edge.kind === "control" &&
          edge.sourceNodeId === "start-1" &&
          edge.targetNodeId === generator.id,
      ),
    ).toBe(true);
  });

  it("keeps the initial fixture serializable and framework independent", () => {
    const workspace = createInitialWorkspace();
    const serialized = JSON.stringify(workspace);

    expect(JSON.parse(serialized)).toEqual(workspace);
    expect(serialized).not.toContain("reactFlow");
    expect(serialized).not.toContain("konva");
    expect(workspace.workflow.revision).toBe(0);
    expect(workspace.designDocuments["design-1-document"].revision).toBe(0);
  });

  it("rejects incompatible typed edges without advancing revision", () => {
    const workspace = createInitialWorkspace();
    const invalidEdge: WorkflowEdgeDraft = {
      id: "invalid-edge",
      sourceNodeId: "start-1",
      sourcePortId: "prompt",
      targetNodeId: "design-1",
      targetPortId: "image",
      kind: "dataflow",
    };
    const result = applyMusesCommand(
      workspace,
      createCommand(workspace, {
        type: "workflow.edge.add",
        edge: invalidEdge,
      }),
    );

    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.code).toBe("edge-invalid");
    expect(result.workspace.workflow.revision).toBe(0);
  });

  it("runs the local image fixture into three traceable branches", () => {
    const workspace = createInitialWorkspace();
    const payload = createDeterministicImageRun(
      workspace,
      "image-generator-1",
      "selector-1",
    );
    const result = applyMusesCommand(
      workspace,
      createCommand(workspace, payload),
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(Object.keys(result.workspace.assets)).toHaveLength(3);
    expect(Object.keys(result.workspace.jobs)).toHaveLength(1);
    expect(
      result.workspace.workflow.nodes.filter(
        (node) => node.kind === "image-result",
      ),
    ).toHaveLength(3);
    expect(
      result.workspace.workflow.nodes.find((node) => node.id === "selector-1")
        ?.data,
    ).toMatchObject({ candidateNodeIds: expect.any(Array) });
  });

  it("selects a result and updates the design document through separate revisions", () => {
    let workspace = createInitialWorkspace();
    const run = applyMusesCommand(
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
    expect(run.accepted).toBe(true);
    if (!run.accepted) return;
    workspace = run.workspace;
    const resultNode = workspace.workflow.nodes.find(
      (node) => node.data.kind === "image-result",
    );
    if (!resultNode || resultNode.data.kind !== "image-result") return;

    const selected = applyCommandSequence(
      workspace,
      [
        {
          type: "workflow.result.select",
          selectorNodeId: "selector-1",
          resultNodeId: resultNode.id,
          designNodeId: "design-1",
        },
        {
          type: "design.background.set",
          documentId: "design-1-document",
          assetId: resultNode.data.assetId,
        },
      ],
      "select-direction",
    );

    expect(selected.accepted).toBe(true);
    if (!selected.accepted) return;
    expect(selected.workspace.workflow.revision).toBe(2);
    expect(
      selected.workspace.designDocuments["design-1-document"].revision,
    ).toBe(1);
    expect(
      selected.workspace.designDocuments["design-1-document"].backgroundAssetId,
    ).toBe(resultNode.data.assetId);
  });

  it("treats duplicate idempotency keys as a no-op", () => {
    const workspace = createInitialWorkspace();
    const command = createCommand(workspace, {
      type: "workflow.node.move",
      nodeId: "start-1",
      position: { x: 120, y: 160 },
    });
    const first = applyMusesCommand(workspace, command);
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    const duplicate = applyMusesCommand(first.workspace, command);
    expect(duplicate.accepted).toBe(true);
    if (!duplicate.accepted) return;
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.workspace.workflow.revision).toBe(1);
  });

  it("exposes type-compatible variables as structured references", () => {
    const workspace = createInitialWorkspace();
    const variables = listAvailableWorkflowVariables(
      workspace.workflow,
      "image-generator-1",
      "prompt",
    );

    expect(variables).toHaveLength(1);
    expect(variables[0]).toMatchObject({
      nodeId: "start-1",
      portId: "prompt",
      valueType: "text",
    });
    expect(formatVariableReference(variables[0].reference)).toBe(
      "{{start-1.prompt}}",
    );
    expect(
      getInputVariableReference(
        workspace.workflow,
        "image-generator-1",
        "prompt",
      ),
    ).toEqual({ sourceNodeId: "start-1", sourcePortId: "prompt", path: [] });
  });

  it("rejects executable cycles from direct edges and variable bindings", () => {
    const textInput = {
      id: "input",
      label: "Input",
      direction: "input" as const,
      valueType: "text" as const,
      accepts: ["text" as const],
    };
    const textOutput = {
      id: "output",
      label: "Output",
      direction: "output" as const,
      valueType: "text" as const,
    };
    const nodes: WorkflowNodeDraft[] = [
      {
        id: "a",
        kind: "start",
        title: "A",
        position: { x: 0, y: 0 },
        inputPorts: [textInput],
        outputPorts: [textOutput],
        data: { kind: "start", variables: [] },
      },
      {
        id: "b",
        kind: "start",
        title: "B",
        position: { x: 200, y: 0 },
        inputPorts: [textInput],
        outputPorts: [textOutput],
        data: { kind: "start", variables: [] },
      },
    ];
    const existing: WorkflowEdgeDraft = {
      id: "a-b",
      sourceNodeId: "a",
      sourcePortId: "output",
      targetNodeId: "b",
      targetPortId: "input",
      kind: "dataflow",
    };
    const cycle: WorkflowEdgeDraft = {
      id: "b-a",
      sourceNodeId: "b",
      sourcePortId: "output",
      targetNodeId: "a",
      targetPortId: "input",
      kind: "dataflow",
    };

    expect(validateWorkflowEdge(nodes, [existing], cycle)).toMatch(/cycle/i);
    expect(
      listAvailableWorkflowVariables(
        {
          id: "workflow-cycle-test",
          schemaVersion: createInitialWorkspace().schemaVersion,
          revision: 0,
          nodes,
          edges: [existing],
        },
        "a",
        "input",
      ),
    ).toEqual([]);
  });

  it("protects the singleton Start and End nodes", () => {
    const workspace = createInitialWorkspace();
    const duplicateStart = applyMusesCommand(
      workspace,
      createCommand(workspace, {
        type: "workflow.node.add",
        node: createNodeDraft("start", "start-2", { x: 20, y: 20 }),
      }),
    );
    expect(duplicateStart.accepted).toBe(false);
    if (!duplicateStart.accepted) {
      expect(duplicateStart.code).toBe("node-singleton-violation");
    }

    for (const nodeId of ["start-1", "end-1"]) {
      const removed = applyMusesCommand(
        workspace,
        createCommand(workspace, { type: "workflow.node.remove", nodeId }),
      );
      expect(removed.accepted).toBe(false);
      if (!removed.accepted) expect(removed.code).toBe("node-protected");
    }
  });

  it("derives typed Start output ports from editable input variables", () => {
    const workspace = createInitialWorkspace();
    const result = applyMusesCommand(
      workspace,
      createCommand(workspace, {
        type: "workflow.start.variables.set",
        nodeId: "start-1",
        variables: [
          {
            id: "topic",
            name: "topic",
            valueType: "text",
            required: true,
            defaultValue: "Open creation systems",
          },
          {
            id: "slide_count",
            name: "slide_count",
            valueType: "number",
            required: false,
            defaultValue: 12,
          },
          {
            id: "include_notes",
            name: "include_notes",
            valueType: "boolean",
            required: false,
            defaultValue: true,
          },
        ],
      }),
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    const start = result.workspace.workflow.nodes.find(
      (node) => node.id === "start-1",
    );
    expect(start?.outputPorts).toMatchObject([
      { id: "topic", valueType: "text" },
      { id: "slide_count", valueType: "number" },
      { id: "include_notes", valueType: "boolean" },
    ]);
    expect(
      result.workspace.workflow.edges.some(
        (edge) => edge.id === "edge-start-generator",
      ),
    ).toBe(false);
  });

  it("validates a complete workflow for publication with a stable order", () => {
    const validation = validateWorkflowForPublication(
      createInitialWorkspace().workflow,
    );

    expect(validation).toEqual({
      valid: true,
      issues: [],
      topologicalOrder: [
        "start-1",
        "image-generator-1",
        "selector-1",
        "design-1",
        "end-1",
      ],
    });
  });

  it("reports cycles, missing inputs, and unreachable execution nodes", () => {
    const initial = createInitialWorkspace().workflow;
    const missingInput = validateWorkflowForPublication({
      ...initial,
      edges: initial.edges.filter((edge) => edge.id !== "edge-selector-design"),
    });
    expect(missingInput.valid).toBe(false);
    expect(missingInput.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "required-input-unbound",
        "end-unreachable",
        "node-outside-start-end-path",
      ]),
    );

    const cycle = validateWorkflowForPublication({
      ...initial,
      edges: [
        ...initial.edges,
        {
          id: "edge-design-generator-cycle",
          sourceNodeId: "design-1",
          sourcePortId: "document",
          targetNodeId: "image-generator-1",
          targetPortId: "prompt",
          kind: "control",
        },
      ],
    });
    expect(cycle.valid).toBe(false);
    expect(cycle.topologicalOrder).toEqual([]);
    expect(cycle.issues).toContainEqual(
      expect.objectContaining({ code: "execution-cycle" }),
    );
  });
});
