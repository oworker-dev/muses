import { describe, expect, it } from "vitest";

import {
  AGENT_CORE_SCHEMA_VERSION,
  createAgentRunExtensionSnapshot,
  createLogicalAgentSandbox,
  type AgentMcpConnectionSnapshot,
  type AgentMcpToolSnapshot,
  type AgentSkillSnapshot,
} from "../src";

const capturedAt = "2026-07-29T00:00:00.000Z";

describe("Agent extension and sandbox boundaries", () => {
  it("pins Skill and MCP schemas to one Run without granting permissions", () => {
    const sandbox = createLogicalAgentSandbox({
      sandboxId: "sandbox-run-1",
      scope: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        sessionId: "session-1",
        runId: "run-1",
      },
      permissions: ["canvas.write", "research.read"],
      allowedToolNames: ["canvas.item.put", "research.search"],
    });
    const result = createAgentRunExtensionSnapshot({
      runId: "run-1",
      runPermissions: ["canvas.write", "research.read"],
      skills: [skill(["canvas.write"])],
      mcpConnections: [connection()],
      mcpTools: [mcpTool(["research.read"])],
      logicalSandbox: sandbox,
      capturedAt,
    });

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        runId: "run-1",
        skills: [{ checksum: "sha256:skill-v1" }],
        mcpTools: [{ schemaChecksum: "sha256:mcp-tool-v1" }],
        logicalSandbox: {
          network: { default: "deny" },
          filesystem: {
            persistence: "ephemeral",
            namespace: "agent-run/run-1",
          },
        },
      },
    });
  });

  it("rejects a Skill permission that was not granted to the Run", () => {
    const sandbox = createLogicalAgentSandbox({
      sandboxId: "sandbox-run-1",
      scope: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        sessionId: "session-1",
        runId: "run-1",
      },
      permissions: ["canvas.write"],
      allowedToolNames: [],
    });
    const result = createAgentRunExtensionSnapshot({
      runId: "run-1",
      runPermissions: ["canvas.write"],
      skills: [skill(["admin.models.write"])],
      mcpConnections: [],
      mcpTools: [],
      logicalSandbox: sandbox,
      capturedAt,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "permission-not-granted",
    });
  });

  it("requires each SubAgentRun to use its own sandbox namespace", () => {
    const parent = createLogicalAgentSandbox({
      sandboxId: "sandbox-parent",
      scope: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        sessionId: "session-1",
        runId: "run-parent",
      },
      permissions: ["canvas.write"],
      allowedToolNames: [],
    });
    const invalid = createAgentRunExtensionSnapshot({
      runId: "run-child",
      runPermissions: ["canvas.write"],
      skills: [],
      mcpConnections: [],
      mcpTools: [],
      logicalSandbox: parent,
      capturedAt,
    });

    expect(invalid).toMatchObject({
      ok: false,
      code: "sandbox-scope-mismatch",
    });
  });
});

function skill(requiredPermissions: string[]): AgentSkillSnapshot {
  return {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    skillId: "visual-direction",
    version: "1.0.0",
    source: { kind: "builtin", locator: "muses/visual-direction" },
    checksum: "sha256:skill-v1",
    compatibleAgentCore: "^0.1.0",
    instructions: "Develop and compare clear visual directions.",
    toolNames: ["canvas.item.put"],
    requiredPermissions,
    capturedAt,
  };
}

function connection(): AgentMcpConnectionSnapshot {
  return {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    connectionId: "research-mcp",
    version: "1.0.0",
    displayName: "Research",
    serverIdentity: "https://mcp.example.test",
    transport: "streamable-http",
    authRef: "credential/research-mcp",
    allowedOrigins: ["https://mcp.example.test"],
    networkPolicyRef: "network/research-readonly",
    capturedAt,
  };
}

function mcpTool(requiredPermissions: string[]): AgentMcpToolSnapshot {
  return {
    connectionId: "research-mcp",
    name: "research.search",
    description: "Search approved research sources",
    inputSchema: { type: "object", required: ["query"] },
    schemaChecksum: "sha256:mcp-tool-v1",
    requiredPermissions,
    sideEffect: "none",
    timeoutMs: 10_000,
    maxResultBytes: 256_000,
  };
}
