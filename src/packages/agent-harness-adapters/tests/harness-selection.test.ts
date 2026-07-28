import { describe, expect, it } from "vitest";
import type {
  AgentPolicyPort,
  AgentRunSnapshot,
  AgentToolDefinition,
  AgentToolRegistryPort,
} from "@muses/agent-core";

import {
  AGENT_HARNESS_ASSESSMENTS,
  AGENT_HARNESS_SELECTION,
  PI_APPROVAL_REQUIRED_PREFIX,
  createPiMusesPolicyHook,
  createPiMusesTools,
  evaluateEveRuntimeCompatibility,
} from "../src";

describe("Agent Harness selection", () => {
  it("keeps Muses authoritative and defers Eve on the current runtime", () => {
    expect(AGENT_HARNESS_SELECTION).toMatchObject({
      primaryRuntime: "muses-headless",
      optionalLoopAdapter: "pi",
      deferredDurableCandidate: "eve",
    });
    expect(
      AGENT_HARNESS_ASSESSMENTS.find(({ id }) => id === "eve"),
    ).toMatchObject({
      role: "deferred-candidate",
      capabilities: { "run-sandbox": "blocked" },
    });
    expect(
      evaluateEveRuntimeCompatibility({
        nodeVersion: "v22.22.0",
        musesWorkflowMajor: 4,
        eveWorkflowProtocol: "5.0.0-beta",
        sandboxBoundary: "session",
      }),
    ).toMatchObject({ compatible: false, reasons: expect.any(Array) });
  });

  it("blocks Pi calls that need durable Muses approval", async () => {
    const fixture = createFixture({ outcome: "approval", reason: "Publish" });
    const hook = createPiMusesPolicyHook(fixture);

    const decision = await hook({
      toolCall: {
        type: "toolCall",
        id: "call-1",
        name: "canvas.item.put",
        arguments: { itemId: "asset-1" },
      },
      args: { itemId: "asset-1" },
      assistantMessage: {} as never,
      context: {} as never,
    });

    expect(decision).toEqual({
      block: true,
      reason: `${PI_APPROVAL_REQUIRED_PREFIX}: Publish`,
    });
  });

  it("routes Pi tool execution through the Muses registry with a stable key", async () => {
    const fixture = createFixture({ outcome: "allow" });
    const [tool] = createPiMusesTools(fixture);

    const result = await tool!.execute("call-1", { itemId: "asset-1" });

    expect(fixture.executions).toEqual([
      {
        runId: "run-1",
        workspaceId: "workspace-1",
        idempotencyKey: "run-1:call-1",
      },
    ]);
    expect(result.details).toMatchObject({ ok: true });
  });
});

function createFixture(
  policyDecision: Awaited<ReturnType<AgentPolicyPort["authorizeTool"]>>,
) {
  const definitions: AgentToolDefinition[] = [
    {
      name: "canvas.item.put",
      description: "Write through the Muses Operation Gateway",
      inputSchema: {
        type: "object",
        properties: { itemId: { type: "string" } },
        required: ["itemId"],
      },
      requiredPermissions: ["canvas.write"],
      sideEffect: "project-write",
    },
  ];
  const executions: Array<{
    runId: string;
    workspaceId: string;
    idempotencyKey: string;
  }> = [];
  const tools: AgentToolRegistryPort = {
    async list() {
      return definitions;
    },
    async execute(call, context) {
      executions.push({
        runId: context.runId,
        workspaceId: context.workspaceId,
        idempotencyKey: context.idempotencyKey,
      });
      return { toolCallId: call.id, ok: true, output: { accepted: true } };
    },
  };
  const policy: AgentPolicyPort = {
    async authorizeTool() {
      return policyDecision;
    },
  };
  return {
    run: runSnapshot(),
    definitions,
    tools,
    policy,
    executions,
  };
}

function runSnapshot(): AgentRunSnapshot {
  const now = "2026-07-29T00:00:00.000Z";
  return {
    schemaVersion: "0.1.0-draft",
    runId: "run-1",
    session: {
      schemaVersion: "0.1.0-draft",
      sessionId: "session-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      canvasId: "canvas-1",
      createdAt: now,
      updatedAt: now,
    },
    profile: {
      profileId: "muses-agent",
      version: "0.1.0",
      modelRef: "fixture/model",
      instructions: "Create on the canvas.",
      toolNames: ["canvas.item.put"],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    status: "running",
    revision: 1,
    turn: 1,
    context: { version: 1, messages: [], artifactRefs: [], createdAt: now },
    budget: {
      limit: {
        maxTurns: 8,
        maxModelCalls: 8,
        maxToolCalls: 8,
        maxInputTokens: 10_000,
        maxOutputTokens: 10_000,
        maxCreditMicros: "1000000",
        maxDurationMs: 60_000,
      },
      usage: {
        turns: 1,
        modelCalls: 1,
        toolCalls: 0,
        inputTokens: 10,
        outputTokens: 5,
        creditMicros: "10",
        startedAt: now,
      },
    },
    permissions: ["canvas.write"],
    metadata: { initiatedByUserId: "user-1" },
    pendingMessages: [],
    pendingToolCalls: [],
    createdAt: now,
    updatedAt: now,
  };
}
