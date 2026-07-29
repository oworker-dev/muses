import { describe, expect, it } from "vitest";

import {
  AGENT_CORE_SCHEMA_VERSION,
  createAgentRunExtensionSnapshot,
  createLogicalAgentSandbox,
  validateAgentRunExtensionSnapshot,
  type AgentLogicalSandbox,
  type AgentMcpConnectionSnapshot,
  type AgentMcpToolSnapshot,
  type AgentProfileSnapshot,
  type AgentSandboxScope,
  type AgentSkillSnapshot,
} from "../src";

const capturedAt = "2026-07-29T00:00:00.000Z";
const scope: AgentSandboxScope = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  sessionId: "session-1",
  runId: "run-1",
};
const profile: AgentProfileSnapshot = {
  profileId: "muses",
  version: "1.0.0",
  modelRef: "openai/gpt-5.6-sol",
  instructions: "Create safely.",
  toolNames: ["canvas.item.put"],
  skillRefs: ["visual-direction@1.0.0"],
  mcpConnectionRefs: ["research-mcp@1.0.0"],
};

describe("Agent extension and sandbox boundaries", () => {
  it("pins Skill and MCP schemas to one Run without granting permissions", () => {
    const result = createSnapshot();

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
    const result = createSnapshot({
      runPermissions: ["canvas.write"],
      skills: [skill(["admin.models.write"])],
      mcpConnections: [],
      mcpTools: [],
      profile: {
        ...profile,
        skillRefs: ["visual-direction@1.0.0"],
        mcpConnectionRefs: [],
      },
      allowedToolNames: ["canvas.item.put"],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "permission-not-granted",
    });
  });

  it.each([
    ["workspaceId", "workspace-elsewhere"],
    ["projectId", "project-elsewhere"],
    ["sessionId", "session-elsewhere"],
    ["runId", "run-elsewhere"],
  ] as const)(
    "rejects a sandbox whose %s escapes the verified Run scope",
    (field, value) => {
      const logicalSandbox = sandbox();
      const result = createSnapshot({
        logicalSandbox: {
          ...logicalSandbox,
          scope: { ...logicalSandbox.scope, [field]: value },
        },
      });

      expect(result).toMatchObject({
        ok: false,
        code: "sandbox-scope-mismatch",
      });
    },
  );

  it("requires each SubAgentRun to use its own sandbox namespace", () => {
    const parent = createLogicalAgentSandbox({
      sandboxId: "sandbox-parent",
      scope: { ...scope, runId: "run-parent" },
      permissions: ["canvas.write", "research.read"],
      allowedToolNames: [
        "canvas.item.put",
        "research-mcp__research.search",
      ],
    });
    const invalid = createSnapshot({ logicalSandbox: parent });

    expect(invalid).toMatchObject({
      ok: false,
      code: "sandbox-scope-mismatch",
    });
  });

  it("rejects Skill version drift from the immutable profile", () => {
    const result = createSnapshot({ skills: [skill([], "2.0.0")] });

    expect(result).toMatchObject({
      ok: false,
      code: "skill-snapshot-mismatch",
    });
  });

  it("rejects MCP connection version drift from the immutable profile", () => {
    const result = createSnapshot({
      mcpConnections: [{ ...connection(), version: "2.0.0" }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "mcp-snapshot-mismatch",
    });
  });

  it.each(["skill", "mcp-tool"] as const)(
    "rejects frozen %s checksum drift after Run creation",
    (kind) => {
      const created = createSnapshot();
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const snapshot = structuredClone(created.snapshot);
      const tampered =
        kind === "skill"
          ? {
              ...snapshot,
              skills: [{ ...snapshot.skills[0]!, checksum: "sha256:changed" }],
            }
          : {
              ...snapshot,
              mcpTools: [
                {
                  ...snapshot.mcpTools[0]!,
                  schemaChecksum: "sha256:changed",
                },
              ],
            };

      expect(
        validateAgentRunExtensionSnapshot({
          snapshot: tampered,
          runId: "run-1",
          runScope: scope,
          profile,
          runPermissions: ["canvas.write", "research.read"],
        }),
      ).toMatchObject({
        ok: false,
        code: "extension-integrity-mismatch",
      });
    },
  );

  it("rejects sandbox permission escalation", () => {
    const logicalSandbox = sandbox();
    const result = createSnapshot({
      logicalSandbox: {
        ...logicalSandbox,
        permissions: [...logicalSandbox.permissions, "admin.models.write"],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "permission-not-granted",
    });
  });

  it("rejects tools not pinned by the profile or MCP schemas", () => {
    const result = createSnapshot({
      allowedToolNames: [
        "canvas.item.put",
        "research-mcp__research.search",
        "admin.models.delete",
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "tool-not-granted",
    });
  });

  it("rejects a Skill that references a tool outside the pinned surface", () => {
    const result = createSnapshot({
      skills: [{ ...skill([]), toolNames: ["filesystem.destroy"] }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "tool-not-granted",
    });
  });

  it("rejects a non-deny-by-default network policy", () => {
    const logicalSandbox = sandbox();
    const result = createSnapshot({
      logicalSandbox: {
        ...logicalSandbox,
        network: {
          ...logicalSandbox.network,
          default: "allow" as "deny",
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "sandbox-scope-mismatch",
    });
  });

  it("rejects filesystem namespace escape", () => {
    const logicalSandbox = sandbox();
    const result = createSnapshot({
      logicalSandbox: {
        ...logicalSandbox,
        filesystem: {
          ...logicalSandbox.filesystem,
          namespace: "agent-run/shared",
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "sandbox-scope-mismatch",
    });
  });
});

function createSnapshot(
  overrides: {
    runScope?: AgentSandboxScope;
    profile?: AgentProfileSnapshot;
    runPermissions?: readonly string[];
    skills?: readonly AgentSkillSnapshot[];
    mcpConnections?: readonly AgentMcpConnectionSnapshot[];
    mcpTools?: readonly AgentMcpToolSnapshot[];
    logicalSandbox?: AgentLogicalSandbox;
    allowedToolNames?: readonly string[];
  } = {},
) {
  const runPermissions = overrides.runPermissions || [
    "canvas.write",
    "research.read",
  ];
  return createAgentRunExtensionSnapshot({
    runId: "run-1",
    runScope: overrides.runScope || scope,
    profile: overrides.profile || profile,
    runPermissions,
    skills: overrides.skills || [skill([])],
    mcpConnections: overrides.mcpConnections || [connection()],
    mcpTools: overrides.mcpTools || [mcpTool(["research.read"])],
    logicalSandbox:
      overrides.logicalSandbox ||
      sandbox(runPermissions, overrides.allowedToolNames),
    capturedAt,
  });
}

function sandbox(
  permissions: readonly string[] = ["canvas.write", "research.read"],
  allowedToolNames: readonly string[] = [
    "canvas.item.put",
    "research-mcp__research.search",
  ],
) {
  return createLogicalAgentSandbox({
    sandboxId: "sandbox-run-1",
    scope,
    permissions,
    allowedToolNames,
  });
}

function skill(
  requiredPermissions: string[],
  version = "1.0.0",
): AgentSkillSnapshot {
  return {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    skillId: "visual-direction",
    version,
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
