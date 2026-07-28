export const AGENT_CORE_SCHEMA_VERSION = "0.1.0-draft" as const;

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting-approval"
  | "waiting-input"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentMessage = {
  readonly id: string;
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly createdAt: string;
  readonly toolCallId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type AgentProfileSnapshot = {
  readonly profileId: string;
  readonly version: string;
  readonly modelRef: string;
  readonly instructions: string;
  readonly toolNames: readonly string[];
  readonly skillRefs: readonly string[];
  readonly mcpConnectionRefs: readonly string[];
};

export type AgentBudgetLimit = {
  readonly maxTurns: number;
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCreditMicros: string;
  readonly maxDurationMs: number;
};

export type AgentBudgetUsage = {
  readonly turns: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly creditMicros: string;
  readonly startedAt: string;
};

export type AgentPlanStep = {
  readonly id: string;
  readonly title: string;
  readonly status:
    | "pending"
    | "in-progress"
    | "completed"
    | "blocked"
    | "cancelled";
  readonly dependsOn: readonly string[];
  readonly evidenceRefs: readonly string[];
};

export type AgentExecutionPlan = {
  readonly revision: number;
  readonly goal: string;
  readonly steps: readonly AgentPlanStep[];
  readonly updatedAt: string;
};

export type AgentToolCall = {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
};

export type AgentToolCallResult = {
  readonly toolCallId: string;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
};

export type AgentApprovalRequest = {
  readonly approvalId: string;
  readonly toolCall: AgentToolCall;
  readonly reason: string;
  readonly requestedAt: string;
  readonly status: "pending" | "approved" | "denied";
  readonly decidedAt?: string;
  readonly decisionReason?: string;
};

export type ApprovalDecision = {
  readonly approvalId: string;
  readonly decision: "approved" | "denied";
  readonly reason?: string;
};

export type AgentPendingToolCall = {
  readonly call: AgentToolCall;
  readonly state: "policy-check" | "waiting-approval" | "approved";
  readonly approval?: AgentApprovalRequest;
};

export type AgentContextSnapshot = {
  readonly version: number;
  readonly messages: readonly AgentMessage[];
  readonly summary?: string;
  readonly artifactRefs: readonly string[];
  readonly createdAt: string;
};

export type AgentCheckpoint = {
  readonly checkpointId: string;
  readonly runRevision: number;
  readonly contextVersion: number;
  readonly eventSequence: number;
  readonly createdAt: string;
};

export type AgentSessionSnapshot = {
  readonly schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly canvasId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
};

export type AgentRunSnapshot = {
  readonly schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION;
  readonly runId: string;
  readonly session: AgentSessionSnapshot;
  readonly profile: AgentProfileSnapshot;
  readonly status: AgentRunStatus;
  readonly revision: number;
  readonly turn: number;
  readonly context: AgentContextSnapshot;
  readonly plan?: AgentExecutionPlan;
  readonly budget: {
    readonly limit: AgentBudgetLimit;
    readonly usage: AgentBudgetUsage;
  };
  readonly permissions: readonly string[];
  readonly pendingMessages: readonly AgentMessage[];
  readonly pendingToolCalls: readonly AgentPendingToolCall[];
  readonly pendingApproval?: AgentApprovalRequest;
  readonly checkpoint?: AgentCheckpoint;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type AgentEventType =
  | "run.created"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.resumed"
  | "message.received"
  | "message.follow-up"
  | "model.completed"
  | "tool.requested"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.denied"
  | "approval.requested"
  | "approval.decided"
  | "plan.updated"
  | "checkpoint.created";

export type AgentEvent = {
  readonly schemaVersion: typeof AGENT_CORE_SCHEMA_VERSION;
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: AgentEventType;
  readonly createdAt: string;
  readonly data: Readonly<Record<string, unknown>>;
};

export type AgentEventDraft = Omit<AgentEvent, "eventId" | "sequence">;

export type StartAgentRun = {
  readonly runId?: string;
  readonly session: Omit<
    AgentSessionSnapshot,
    "schemaVersion" | "createdAt" | "updatedAt"
  >;
  readonly profile: AgentProfileSnapshot;
  readonly input: string;
  readonly budget: AgentBudgetLimit;
  readonly permissions: readonly string[];
  readonly plan?: Omit<AgentExecutionPlan, "revision" | "updatedAt">;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type AgentRunRef = {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: AgentRunStatus;
  readonly revision: number;
};

export type AgentModelUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly creditMicros: string;
};

export type AgentModelResult = {
  readonly content: string;
  readonly finishReason: "stop" | "tool-calls";
  readonly toolCalls: readonly AgentToolCall[];
  readonly usage: AgentModelUsage;
  readonly plan?: Omit<AgentExecutionPlan, "revision" | "updatedAt">;
};
