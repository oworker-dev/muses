import type {
  AgentRunSnapshot,
  AgentToolCall,
  AgentToolDefinition,
  AgentToolRegistryPort,
  AgentPolicyPort,
} from "@muses/agent-core";
import type {
  AgentTool as PiAgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

export const PI_APPROVAL_REQUIRED_PREFIX = "MUSES_APPROVAL_REQUIRED";

export type PiMusesAdapterDependencies = {
  readonly run: AgentRunSnapshot;
  readonly definitions: readonly AgentToolDefinition[];
  readonly tools: AgentToolRegistryPort;
  readonly policy: AgentPolicyPort;
};

export function createPiMusesTools(
  dependencies: PiMusesAdapterDependencies,
): readonly PiAgentTool[] {
  return dependencies.definitions.map((definition) => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: Type.Unsafe(definition.inputSchema),
    executionMode: definition.sideEffect === "none" ? "parallel" : "sequential",
    execute: async (toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error("The AgentRun was cancelled.");
      const call: AgentToolCall = {
        id: toolCallId,
        name: definition.name,
        input: asRecord(params),
      };
      const result = await dependencies.tools.execute(call, {
        workspaceId: dependencies.run.session.workspaceId,
        projectId: dependencies.run.session.projectId,
        canvasId: dependencies.run.session.canvasId,
        sessionId: dependencies.run.session.sessionId,
        runId: dependencies.run.runId,
        permissions: dependencies.run.permissions,
        idempotencyKey: `${dependencies.run.runId}:${toolCallId}`,
      });
      if (!result.ok) {
        throw new PiMusesToolError(
          result.error?.code || "tool-failed",
          result.error?.message || "The Muses tool failed.",
          result.error?.retryable || false,
        );
      }
      return {
        content: [{ type: "text", text: serializeForModel(result.output) }],
        details: result,
      };
    },
  }));
}

export function createPiMusesPolicyHook(
  dependencies: PiMusesAdapterDependencies,
): (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined> {
  const definitions = new Map(
    dependencies.definitions.map((definition) => [definition.name, definition]),
  );
  return async (context, signal) => {
    if (signal?.aborted) {
      return { block: true, reason: "The AgentRun was cancelled." };
    }
    const tool = definitions.get(context.toolCall.name);
    if (!tool) {
      return { block: true, reason: "The tool is not in the pinned Muses registry." };
    }
    const missingPermissions = tool.requiredPermissions.filter(
      (permission) => !dependencies.run.permissions.includes(permission),
    );
    if (missingPermissions.length > 0) {
      return {
        block: true,
        reason: `Missing Muses permissions: ${missingPermissions.join(", ")}.`,
      };
    }
    const decision = await dependencies.policy.authorizeTool({
      run: dependencies.run,
      tool,
      call: {
        id: context.toolCall.id,
        name: context.toolCall.name,
        input: asRecord(context.args),
      },
    });
    if (decision.outcome === "allow") return undefined;
    if (decision.outcome === "approval") {
      return {
        block: true,
        reason: `${PI_APPROVAL_REQUIRED_PREFIX}: ${decision.reason}`,
      };
    }
    return { block: true, reason: decision.reason };
  };
}

export class PiMusesToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PiMusesToolError";
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function serializeForModel(value: unknown) {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value ?? null);
  return serialized === undefined ? "null" : serialized;
}
