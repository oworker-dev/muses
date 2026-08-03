import { describe, expect, it } from "vitest";

import {
  commitWorkflowNodeOutputs,
  compileWorkflowDefinition,
  continueWorkflowInterpreter,
  createHarnessWorkspace as createInitialWorkspace,
  createWorkflowExecutionState,
  prepareNextWorkflowNode,
  resumeWorkflowHumanSelection,
  runWorkflowInterpreter,
  type WorkflowDefinition,
  type WorkflowNodeExecutorRegistry,
  type WorkflowRuntimeValue,
} from "../src";

function definition(): WorkflowDefinition {
  const compilation = compileWorkflowDefinition(
    createInitialWorkspace().workflow,
    {
      workspaceId: "workspace-test",
      definitionId: "interpreter-test",
      version: 1,
    },
  );
  if (!compilation.ok) throw new Error("Fixture must compile");
  return compilation.definition;
}

const executors: WorkflowNodeExecutorRegistry = {
  "image-generator": ({ inputs }) => {
    expect(inputs.prompt).toEqual({
      valueType: "text",
      value:
        "A cinematic launch visual for an open AI creation platform, sculptural light, midnight indigo and warm coral accents",
    });
    return {
      image: {
        valueType: "image",
        assetIds: ["server-image-1", "server-image-2", "server-image-3"],
      },
    };
  },
  "design-document": ({ node, inputs }) => {
    if (node.kind !== "design-document") {
      throw new Error("Expected a DesignDocument node");
    }
    expect(inputs.image).toEqual({
      valueType: "image",
      assetIds: ["server-image-2"],
    });
    return {
      document: {
        valueType: "design-document",
        documentId: node.config.documentId,
        revision: 0,
      },
    };
  },
};

describe("WorkflowDefinition interpreter", () => {
  it("resolves typed Start defaults without an SDK or provider object", () => {
    const workflow = definition();
    const state = createWorkflowExecutionState(workflow, {});
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    const preparation = prepareNextWorkflowNode(workflow, state.value);
    expect(preparation).toMatchObject({
      ok: true,
      value: {
        kind: "intrinsic",
        node: { id: "start-1", kind: "start" },
        outputs: {
          prompt: { valueType: "text" },
        },
      },
    });
  });

  it("rejects supplied Start values whose runtime type is wrong", () => {
    const result = createWorkflowExecutionState(definition(), {
      prompt: { valueType: "number", value: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preparation = prepareNextWorkflowNode(definition(), result.value);
    expect(preparation).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "type-mismatch",
        nodeId: "start-1",
        portId: "prompt",
        expectedValueTypes: ["text"],
        actualValueType: "number",
      }),
    });
  });

  it("rejects supplied inputs that are not declared by Start", () => {
    const result = createWorkflowExecutionState(definition(), {
      message: { valueType: "text", value: "Do not ignore this input" },
    });

    expect(result).toEqual({
      ok: false,
      issue: {
        code: "unknown-input",
        message: 'Workflow input "message" is not declared by the Start node.',
        nodeId: "start-1",
        portId: "message",
      },
    });
  });

  it("resolves data bindings and suspends at a human Selector", async () => {
    const workflow = definition();
    const result = await runWorkflowInterpreter(workflow, {}, executors);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: "waiting",
      state: {
        completedNodeIds: ["start-1", "image-generator-1"],
        nextNodeIndex: 2,
      },
      suspension: {
        kind: "suspend",
        node: { id: "selector-1" },
        candidateAssetIds: [
          "server-image-1",
          "server-image-2",
          "server-image-3",
        ],
      },
    });
  });

  it("resumes only with a declared candidate and completes in deterministic order", async () => {
    const workflow = definition();
    const waiting = await runWorkflowInterpreter(workflow, {}, executors);
    expect(waiting.ok).toBe(true);
    if (!waiting.ok || waiting.value.status !== "waiting") return;

    const invalid = resumeWorkflowHumanSelection(
      workflow,
      waiting.value.state,
      "selector-1",
      "untrusted-image",
    );
    expect(invalid).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: "invalid-human-selection" }),
    });

    const resumed = resumeWorkflowHumanSelection(
      workflow,
      waiting.value.state,
      "selector-1",
      "server-image-2",
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    const completed = await continueWorkflowInterpreter(
      workflow,
      resumed.value,
      executors,
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok || completed.value.status !== "completed") return;
    expect(completed.value.state.completedNodeIds).toEqual([
      "start-1",
      "image-generator-1",
      "selector-1",
      "design-1",
      "end-1",
    ]);
    expect(completed.value.outputs).toEqual({
      document: {
        valueType: "design-document",
        documentId: "design-1-document",
        revision: 0,
      },
    });
  });

  it("reports missing bound runtime inputs", () => {
    const workflow = definition();
    const state = createWorkflowExecutionState(workflow, {});
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const advanced = commitWorkflowNodeOutputs(
      workflow,
      state.value,
      "start-1",
      {},
    );
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(prepareNextWorkflowNode(workflow, advanced.value)).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "missing-input",
        nodeId: "image-generator-1",
        portId: "prompt",
      }),
    });
  });

  it("rejects missing and invalid executor outputs", async () => {
    const missing = await runWorkflowInterpreter(
      definition(),
      {},
      {
        "image-generator": () => ({}),
      },
    );
    expect(missing).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "missing-output",
        nodeId: "image-generator-1",
        portId: "image",
      }),
    });

    const invalid = await runWorkflowInterpreter(
      definition(),
      {},
      {
        "image-generator": () =>
          ({ image: { valueType: "text", value: "wrong" } }) as Readonly<
            Record<string, WorkflowRuntimeValue>
          >,
      },
    );
    expect(invalid).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "type-mismatch",
        expectedValueTypes: ["image"],
        actualValueType: "text",
      }),
    });
  });

  it("fails explicitly when a supported effect has no registered executor", async () => {
    const result = await runWorkflowInterpreter(definition(), {}, {});
    expect(result).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "unsupported-node",
        nodeId: "image-generator-1",
      }),
    });
  });

  it("rejects execution orders that reference an unknown node", () => {
    const workflow = definition();
    const corrupted = {
      ...workflow,
      executionOrder: [
        "start-1",
        "unknown-node",
        ...workflow.executionOrder.slice(1),
      ],
    } as WorkflowDefinition;
    const state = createWorkflowExecutionState(corrupted, {});
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const start = prepareNextWorkflowNode(corrupted, state.value);
    expect(start.ok).toBe(true);
    if (!start.ok || start.value.kind !== "intrinsic") return;
    const advanced = commitWorkflowNodeOutputs(
      corrupted,
      state.value,
      "start-1",
      start.value.outputs,
    );
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(prepareNextWorkflowNode(corrupted, advanced.value)).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "unsupported-node",
        nodeId: "unknown-node",
      }),
    });
  });
});
