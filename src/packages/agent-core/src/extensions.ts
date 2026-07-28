import { AGENT_CORE_SCHEMA_VERSION } from "./contracts";

export type AgentSkillRef = {
  readonly skillId: string;
  readonly version: string;
};

export type AgentSkillSnapshot = AgentSkillRef & {
  readonly schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION;
  readonly source: {
    readonly kind: "builtin" | "git" | "registry" | "workspace";
    readonly locator: string;
  };
  readonly checksum: string;
  readonly compatibleAgentCore: string;
  readonly instructions: string;
  readonly toolNames: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly capturedAt: string;
};

export type AgentSkillRegistryPort = {
  resolve(ref: AgentSkillRef): Promise<AgentSkillSnapshot | null>;
};

export type AgentMcpConnectionRef = {
  readonly connectionId: string;
  readonly version: string;
};

export type AgentMcpConnectionSnapshot = AgentMcpConnectionRef & {
  readonly schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION;
  readonly displayName: string;
  readonly serverIdentity: string;
  readonly transport: "stdio" | "streamable-http";
  readonly authRef?: string;
  readonly allowedOrigins: readonly string[];
  readonly networkPolicyRef: string;
  readonly capturedAt: string;
};

export type AgentMcpToolSnapshot = {
  readonly connectionId: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly schemaChecksum: string;
  readonly requiredPermissions: readonly string[];
  readonly sideEffect: "none" | "project-write" | "external";
  readonly timeoutMs: number;
  readonly maxResultBytes: number;
};

export type AgentMcpInvocation = {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly connection: AgentMcpConnectionSnapshot;
  readonly tool: AgentMcpToolSnapshot;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
};

export type AgentMcpInvocationResult =
  | {
      readonly ok: true;
      readonly content: unknown;
      readonly contentBytes: number;
      readonly auditRef: string;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "connection-unavailable"
          | "schema-mismatch"
          | "permission-denied"
          | "approval-required"
          | "timeout"
          | "result-too-large"
          | "remote-error";
        readonly message: string;
        readonly retryable: boolean;
      };
      readonly auditRef: string;
    };

export type AgentMcpGatewayPort = {
  snapshotConnection(
    ref: AgentMcpConnectionRef,
  ): Promise<AgentMcpConnectionSnapshot | null>;
  discoverTools(
    connection: AgentMcpConnectionSnapshot,
  ): Promise<readonly AgentMcpToolSnapshot[]>;
  invoke(input: AgentMcpInvocation): Promise<AgentMcpInvocationResult>;
};

export type AgentSandboxScope = {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly parentRunId?: string;
};

export type AgentLogicalSandbox = {
  readonly schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION;
  readonly sandboxId: string;
  readonly scope: AgentSandboxScope;
  readonly permissions: readonly string[];
  readonly allowedToolNames: readonly string[];
  readonly credentialRefs: readonly string[];
  readonly network: {
    readonly default: "deny";
    readonly allowedHosts: readonly string[];
  };
  readonly filesystem: {
    readonly persistence: "ephemeral";
    readonly namespace: string;
    readonly maxBytes: number;
  };
  readonly limits: {
    readonly maxProcesses: number;
    readonly maxDurationMs: number;
  };
};

export type AgentComputeSandboxRef = {
  readonly computeSandboxId: string;
  readonly runId: string;
  readonly providerRef: string;
};

export type AgentComputeSandboxPort = {
  create(input: {
    readonly logicalSandbox: AgentLogicalSandbox;
    readonly imageRef: string;
    readonly requestedCapabilities: readonly (
      | "code"
      | "cli"
      | "browser"
      | "untrusted-file"
      | "media-processing"
    )[];
  }): Promise<AgentComputeSandboxRef>;
  execute(input: {
    readonly sandbox: AgentComputeSandboxRef;
    readonly operationId: string;
    readonly command: readonly string[];
    readonly timeoutMs: number;
  }): Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly artifactRefs: readonly string[];
  }>;
  destroy(sandbox: AgentComputeSandboxRef): Promise<void>;
};

export type AgentRunExtensionSnapshot = {
  readonly schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION;
  readonly runId: string;
  readonly skills: readonly AgentSkillSnapshot[];
  readonly mcpConnections: readonly AgentMcpConnectionSnapshot[];
  readonly mcpTools: readonly AgentMcpToolSnapshot[];
  readonly logicalSandbox: AgentLogicalSandbox;
  readonly capturedAt: string;
};

export type CreateAgentRunExtensionSnapshotResult =
  | { readonly ok: true; readonly snapshot: AgentRunExtensionSnapshot }
  | {
      readonly ok: false;
      readonly code:
        | "identity-required"
        | "duplicate-skill"
        | "duplicate-mcp-connection"
        | "duplicate-mcp-tool"
        | "permission-not-granted"
        | "sandbox-scope-mismatch";
      readonly message: string;
    };

export function createAgentRunExtensionSnapshot(input: {
  readonly runId: string;
  readonly runPermissions: readonly string[];
  readonly skills: readonly AgentSkillSnapshot[];
  readonly mcpConnections: readonly AgentMcpConnectionSnapshot[];
  readonly mcpTools: readonly AgentMcpToolSnapshot[];
  readonly logicalSandbox: AgentLogicalSandbox;
  readonly capturedAt: string;
}): CreateAgentRunExtensionSnapshotResult {
  if (!input.runId.trim() || input.logicalSandbox.scope.runId !== input.runId) {
    return {
      ok: false,
      code: "sandbox-scope-mismatch",
      message: "The logical sandbox must be scoped to this AgentRun.",
    };
  }
  const skillKeys = new Set<string>();
  for (const skill of input.skills) {
    const key = `${skill.skillId}@${skill.version}`;
    if (skillKeys.has(key)) {
      return {
        ok: false,
        code: "duplicate-skill",
        message: `Skill snapshot "${key}" is duplicated.`,
      };
    }
    skillKeys.add(key);
    const missing = skill.requiredPermissions.filter(
      (permission) => !input.runPermissions.includes(permission),
    );
    if (missing.length > 0) {
      return {
        ok: false,
        code: "permission-not-granted",
        message: `Skill "${key}" requires permissions not granted to the Run: ${missing.join(", ")}.`,
      };
    }
  }

  const connectionIds = new Set<string>();
  for (const connection of input.mcpConnections) {
    if (connectionIds.has(connection.connectionId)) {
      return {
        ok: false,
        code: "duplicate-mcp-connection",
        message: `MCP connection "${connection.connectionId}" is duplicated.`,
      };
    }
    connectionIds.add(connection.connectionId);
  }

  const toolKeys = new Set<string>();
  for (const tool of input.mcpTools) {
    const key = `${tool.connectionId}:${tool.name}`;
    if (!connectionIds.has(tool.connectionId)) {
      return {
        ok: false,
        code: "identity-required",
        message: `MCP tool "${key}" has no pinned connection snapshot.`,
      };
    }
    if (toolKeys.has(key)) {
      return {
        ok: false,
        code: "duplicate-mcp-tool",
        message: `MCP tool snapshot "${key}" is duplicated.`,
      };
    }
    toolKeys.add(key);
    const missing = tool.requiredPermissions.filter(
      (permission) => !input.runPermissions.includes(permission),
    );
    if (missing.length > 0) {
      return {
        ok: false,
        code: "permission-not-granted",
        message: `MCP tool "${key}" requires permissions not granted to the Run: ${missing.join(", ")}.`,
      };
    }
  }

  const sandboxPermissions = new Set(input.logicalSandbox.permissions);
  if (
    input.runPermissions.some(
      (permission) => !sandboxPermissions.has(permission),
    )
  ) {
    return {
      ok: false,
      code: "permission-not-granted",
      message:
        "The logical sandbox cannot omit permissions required by the Run snapshot.",
    };
  }

  return {
    ok: true,
    snapshot: structuredClone({
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      runId: input.runId,
      skills: input.skills,
      mcpConnections: input.mcpConnections,
      mcpTools: input.mcpTools,
      logicalSandbox: input.logicalSandbox,
      capturedAt: input.capturedAt,
    }),
  };
}

export function createLogicalAgentSandbox(input: {
  readonly sandboxId: string;
  readonly scope: AgentSandboxScope;
  readonly permissions: readonly string[];
  readonly allowedToolNames: readonly string[];
  readonly credentialRefs?: readonly string[];
  readonly allowedHosts?: readonly string[];
  readonly maxFilesystemBytes?: number;
  readonly maxProcesses?: number;
  readonly maxDurationMs?: number;
}): AgentLogicalSandbox {
  if (
    !input.scope.workspaceId.trim() ||
    !input.scope.projectId.trim() ||
    !input.scope.sessionId.trim() ||
    !input.scope.runId.trim()
  ) {
    throw new Error("A logical Agent sandbox requires complete Run scope.");
  }
  return {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    sandboxId: input.sandboxId,
    scope: structuredClone(input.scope),
    permissions: [...new Set(input.permissions)],
    allowedToolNames: [...new Set(input.allowedToolNames)],
    credentialRefs: [...new Set(input.credentialRefs || [])],
    network: {
      default: "deny",
      allowedHosts: [...new Set(input.allowedHosts || [])],
    },
    filesystem: {
      persistence: "ephemeral",
      namespace: `agent-run/${input.scope.runId}`,
      maxBytes: input.maxFilesystemBytes || 256 * 1024 * 1024,
    },
    limits: {
      maxProcesses: input.maxProcesses || 4,
      maxDurationMs: input.maxDurationMs || 10 * 60 * 1000,
    },
  };
}
