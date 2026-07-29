import type {
  AgentContextSummary,
  AgentEvent,
  AgentEventDraft,
  AgentMessage,
  AgentModelResult,
  AgentModelUsage,
  AgentRunSnapshot,
  AgentToolCall,
  AgentToolCallResult,
} from "./contracts";

export type AgentToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly requiredPermissions: readonly string[];
  readonly sideEffect: "none" | "project-write" | "external";
};

export type AgentToolExecutionContext = {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly canvasId?: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly permissions: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
};

export type AgentModelPort = {
  estimate(input: {
    readonly callId: string;
    readonly run: AgentRunSnapshot;
    readonly messages: readonly AgentMessage[];
    readonly tools: readonly AgentToolDefinition[];
  }): AgentModelUsage | Promise<AgentModelUsage>;
  complete(input: {
    readonly callId: string;
    readonly run: AgentRunSnapshot;
    readonly messages: readonly AgentMessage[];
    readonly tools: readonly AgentToolDefinition[];
    readonly estimate: AgentModelUsage;
  }): Promise<AgentModelResult>;
};

export class AgentModelError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly retryable: boolean,
    readonly runtimeAction: "fail-run" | "retry-driver" = "fail-run",
  ) {
    super(publicMessage);
    this.name = "AgentModelError";
  }
}

export type AgentToolRegistryPort = {
  list(run: AgentRunSnapshot): Promise<readonly AgentToolDefinition[]>;
  execute(
    call: AgentToolCall,
    context: AgentToolExecutionContext,
  ): Promise<AgentToolCallResult>;
};

export type AgentToolPolicyDecision =
  | { readonly outcome: "allow" }
  | { readonly outcome: "deny"; readonly reason: string }
  | { readonly outcome: "approval"; readonly reason: string };

export type AgentPolicyPort = {
  authorizeTool(input: {
    readonly run: AgentRunSnapshot;
    readonly tool: AgentToolDefinition;
    readonly call: AgentToolCall;
  }): Promise<AgentToolPolicyDecision>;
};

export type AgentStateStorePort = {
  create(
    snapshot: AgentRunSnapshot,
    events: readonly AgentEventDraft[],
  ): Promise<void>;
  read(runId: string): Promise<AgentRunSnapshot | null>;
  commit(input: {
    readonly runId: string;
    readonly expectedRevision: number;
    readonly snapshot: AgentRunSnapshot;
    readonly events: readonly AgentEventDraft[];
  }): Promise<AgentRunSnapshot>;
  readEvents(
    runId: string,
    afterSequence?: number,
  ): Promise<readonly AgentEvent[]>;
  stream(runId: string, afterSequence?: number): AsyncIterable<AgentEvent>;
};

export type AgentContextCompactorPort = {
  compact(input: {
    readonly run: AgentRunSnapshot;
    readonly maxMessages: number;
    readonly maxCharacters: number;
  }): AgentContextSummary | Promise<AgentContextSummary>;
};

export type AgentClockPort = {
  now(): Date;
};

export type AgentIdPort = {
  create(
    prefix: "arun" | "amsg" | "aevent" | "approval" | "checkpoint",
  ): string;
};
