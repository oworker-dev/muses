import { describe, expect, it } from "vitest";

import {
  CREATIVE_CANVAS_SCHEMA_VERSION,
  NODE_TYPE_REGISTRY_SCHEMA_VERSION,
  OPERATION_COMMAND_SCHEMA_VERSION,
  PROFESSIONAL_WORKSPACE_SCHEMA_VERSION,
  WORKFLOW_CATALOG_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  applyCreativeCanvasCommand,
  applyProfessionalWorkspaceCommand,
  createNodeTypeRegistry,
  getNodeTypeDefinition,
  getWorkflowInvocationDeduplicationKey,
  listAgentCreatableNodeTypes,
  resolveWorkflowInvocationTarget,
  validateCreativeCanvas,
  validateProfessionalWorkspace,
  type CreativeCanvas,
  type NodeTypeDefinition,
  type OperationCommandEnvelope,
  type ProfessionalWorkspace,
  type StartWorkflowInvocation,
  type WorkflowDeployment,
} from "../src";

describe("Agent-first product contracts", () => {
  it("keeps creative relations separate from executable workflow edges", () => {
    const canvas: CreativeCanvas = {
      schemaVersion: CREATIVE_CANVAS_SCHEMA_VERSION,
      workspaceId: "ws_alpha",
      projectId: "project_launch",
      canvasId: "canvas_launch",
      revision: 3,
      items: [
        {
          id: "asset_item",
          kind: "asset",
          refId: "asset_key_visual",
          title: "Key visual",
          position: { x: 120, y: 80 },
        },
        {
          id: "run_item",
          kind: "agent-run",
          refId: "arun_generate_visual",
          title: "Generate key visual",
          position: { x: 520, y: 80 },
        },
      ],
      relations: [
        {
          id: "provenance_run_asset",
          kind: "provenance",
          sourceItemId: "run_item",
          targetItemId: "asset_item",
        },
      ],
    };

    expect(validateCreativeCanvas(canvas)).toEqual([]);
    expect(JSON.stringify(canvas)).not.toContain("start");
    expect(JSON.stringify(canvas)).not.toContain("end");
    expect(JSON.stringify(canvas)).not.toContain("dataflow");
  });

  it("lets one professional workspace place multiple independent workflows", () => {
    const workspace: ProfessionalWorkspace = {
      schemaVersion: PROFESSIONAL_WORKSPACE_SCHEMA_VERSION,
      workspaceId: "ws_alpha",
      projectId: "project_launch",
      professionalWorkspaceId: "pro_workspace_launch",
      revision: 1,
      workflows: [
        {
          workflowDefinitionId: "wf_background_remove",
          position: { x: 80, y: 80 },
          collapsed: false,
        },
        {
          workflowDefinitionId: "wf_poster_generate",
          position: { x: 600, y: 80 },
          collapsed: true,
        },
      ],
    };

    expect(validateProfessionalWorkspace(workspace)).toEqual([]);
    expect(
      validateProfessionalWorkspace({
        ...workspace,
        workflows: [...workspace.workflows, workspace.workflows[0]],
      }),
    ).toContainEqual(
      expect.objectContaining({ code: "duplicate-workflow-placement" }),
    );
  });

  it("creates a separately addressable workflow placement", () => {
    const workspace: ProfessionalWorkspace = {
      schemaVersion: PROFESSIONAL_WORKSPACE_SCHEMA_VERSION,
      workspaceId: "ws_alpha",
      projectId: "project_launch",
      professionalWorkspaceId: "pro_workspace_launch",
      revision: 0,
      workflows: [],
    };
    const result = applyProfessionalWorkspaceCommand(
      workspace,
      createOperationCommand({
        target: {
          type: "professional-workspace",
          id: workspace.professionalWorkspaceId,
        },
        expectedRevision: workspace.revision,
        payload: {
          type: "professional.workflow.create",
          definitionId: "workflow-definition-2",
          name: "Second image flow",
          position: { x: 720, y: 160 },
          collapsed: false,
        },
      }),
    );

    expect(result).toMatchObject({
      accepted: true,
      document: {
        revision: 1,
        workflows: [{ workflowDefinitionId: "workflow-definition-2" }],
      },
    });
  });

  it("applies revisioned UI or Agent commands without a write bypass", () => {
    const canvas: CreativeCanvas = {
      schemaVersion: CREATIVE_CANVAS_SCHEMA_VERSION,
      workspaceId: "ws_alpha",
      projectId: "project_launch",
      canvasId: "canvas_launch",
      revision: 0,
      items: [],
      relations: [],
    };
    const putItem = createOperationCommand({
      target: { type: "creative-canvas", id: canvas.canvasId },
      expectedRevision: 0,
      payload: {
        type: "creative.item.put",
        item: {
          id: "asset_item",
          kind: "asset",
          refId: "asset_visual",
          title: "Visual",
          position: { x: 100, y: 100 },
        },
      },
    });
    const accepted = applyCreativeCanvasCommand(canvas, putItem);
    expect(accepted).toMatchObject({
      accepted: true,
      document: { revision: 1, items: [{ id: "asset_item" }] },
    });
    if (!accepted.accepted) return;
    expect(
      applyCreativeCanvasCommand(accepted.document, putItem),
    ).toMatchObject({
      accepted: false,
      code: "revision-conflict",
      document: { revision: 1 },
    });

    const professional: ProfessionalWorkspace = {
      schemaVersion: PROFESSIONAL_WORKSPACE_SCHEMA_VERSION,
      workspaceId: "ws_alpha",
      projectId: "project_launch",
      professionalWorkspaceId: "pro_launch",
      revision: 0,
      workflows: [],
    };
    const placement = applyProfessionalWorkspaceCommand(
      professional,
      createOperationCommand({
        target: {
          type: "professional-workspace",
          id: professional.professionalWorkspaceId,
        },
        expectedRevision: 0,
        payload: {
          type: "professional.workflow.place",
          placement: {
            workflowDefinitionId: "wf_image",
            position: { x: 40, y: 40 },
            collapsed: false,
          },
        },
      }),
    );
    expect(placement).toMatchObject({
      accepted: true,
      document: {
        revision: 1,
        workflows: [{ workflowDefinitionId: "wf_image" }],
      },
    });
  });

  it("resolves exact versions and deployment aliases without graph inference", () => {
    const deployment: WorkflowDeployment = {
      schemaVersion: WORKFLOW_CATALOG_SCHEMA_VERSION,
      workspaceId: "ws_alpha",
      deploymentId: "deploy_background_remove_production",
      alias: "production",
      status: "active",
      definition: {
        workspaceId: "ws_alpha",
        definitionId: "wf_background_remove",
        version: 4,
        schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
      },
    };

    expect(
      resolveWorkflowInvocationTarget(
        {
          kind: "deployment",
          workspaceId: "ws_alpha",
          deploymentId: deployment.deploymentId,
        },
        [deployment],
      ),
    ).toEqual({
      ok: true,
      definition: deployment.definition,
      deploymentId: deployment.deploymentId,
    });
    expect(
      resolveWorkflowInvocationTarget(
        {
          kind: "deployment",
          workspaceId: "ws_other",
          deploymentId: deployment.deploymentId,
        },
        [deployment],
      ),
    ).toMatchObject({ ok: false, code: "workspace-mismatch" });

    const request: StartWorkflowInvocation = {
      requestId: "invoke_1",
      idempotencyKey: "order_20260729_1",
      target: {
        kind: "definition-version",
        definition: deployment.definition,
      },
      caller: { kind: "api", clientId: "client_shop" },
      inputs: { assetId: "asset_product" },
      requestedAt: "2026-07-29T00:00:00.000Z",
    };
    expect(getWorkflowInvocationDeduplicationKey("ws_alpha", request)).toBe(
      "ws_alpha:order_20260729_1",
    );
  });
});

describe("Node Type Registry", () => {
  it("exposes only explicitly Agent-creatable node definitions", () => {
    const registry = createNodeTypeRegistry([
      createNodeTypeDefinition({
        type: "model.llm.generate",
        category: "model",
        agent: true,
      }),
      createNodeTypeDefinition({
        type: "platform.node.install",
        category: "workflow",
        agent: false,
      }),
    ]);

    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    expect(
      listAgentCreatableNodeTypes(registry.registry).map(({ type }) => type),
    ).toEqual(["model.llm.generate"]);
    expect(
      getNodeTypeDefinition(registry.registry, "model.llm.generate", "1.0.0"),
    ).toMatchObject({
      executorRef: "muses:model.llm.generate@1.0.0",
      creationPolicy: { user: true, agent: true },
    });
  });

  it("rejects duplicate definitions and ambiguous port identities", () => {
    const definition = createNodeTypeDefinition({
      type: "agent.run",
      category: "agent",
      agent: true,
    });
    const result = createNodeTypeRegistry([
      definition,
      definition,
      {
        ...createNodeTypeDefinition({
          type: "workflow.invoke",
          category: "workflow",
          agent: true,
        }),
        outputPorts: [
          {
            id: "value",
            label: "Value",
            valueType: "json",
            required: true,
            allowsMultiple: false,
          },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["duplicate-definition", "duplicate-port"]),
    );
  });
});

function createNodeTypeDefinition(input: {
  type: string;
  category: NodeTypeDefinition["category"];
  agent: boolean;
}): NodeTypeDefinition {
  return {
    schemaVersion: NODE_TYPE_REGISTRY_SCHEMA_VERSION,
    type: input.type,
    version: "1.0.0",
    title: input.type,
    description: `${input.type} test definition`,
    category: input.category,
    configSchema: { type: "object", additionalProperties: false },
    inputPorts: [
      {
        id: "value",
        label: "Value",
        valueType: "json",
        required: false,
        allowsMultiple: false,
      },
    ],
    outputPorts: [
      {
        id: "result",
        label: "Result",
        valueType: "json",
        required: true,
        allowsMultiple: false,
      },
    ],
    executorRef: `muses:${input.type}@1.0.0`,
    requiredCapabilities: [],
    requiredPermissions: [],
    creationPolicy: { user: true, agent: input.agent },
  };
}

function createOperationCommand(
  input: Pick<
    OperationCommandEnvelope,
    "target" | "expectedRevision" | "payload"
  >,
): OperationCommandEnvelope {
  return {
    schemaVersion: OPERATION_COMMAND_SCHEMA_VERSION,
    commandId: "cmd_test",
    idempotencyKey: "idem_test",
    workspaceId: "ws_alpha",
    projectId: "project_launch",
    target: input.target,
    expectedRevision: input.expectedRevision,
    actor: {
      kind: "agent",
      agentRunId: "arun_test",
      runtime: "standalone",
      initiatedByUserId: "user_test",
    },
    issuedAt: "2026-07-29T00:00:00.000Z",
    payload: input.payload,
  };
}
