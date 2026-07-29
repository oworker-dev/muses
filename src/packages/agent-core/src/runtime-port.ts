import type {
  AgentContextSummary,
  AgentEvent,
  AgentExecutionPlan,
  AgentMessage,
  AgentRunRef,
  AgentRunSnapshot,
  ApprovalDecision,
  StartAgentRun,
} from "./contracts";

export type AgentRuntimePort = {
  start(input: StartAgentRun): Promise<AgentRunRef>;
  stream(runId: string, cursor?: string): AsyncIterable<AgentEvent>;
  steer(runId: string, message: AgentMessage): Promise<void>;
  followUp(runId: string, message: AgentMessage): Promise<void>;
  approve(runId: string, approval: ApprovalDecision): Promise<void>;
  cancel(runId: string, reason?: string): Promise<void>;
  resume(runId: string): Promise<void>;
  inspect(runId: string): Promise<AgentRunSnapshot>;
  compact(
    runId: string,
    options?: {
      readonly maxMessages?: number;
      readonly maxCharacters?: number;
    },
  ): Promise<AgentContextSummary>;
  updatePlan(
    runId: string,
    expectedPlanRevision: number,
    plan: Omit<AgentExecutionPlan, "revision" | "updatedAt">,
  ): Promise<void>;
  close(sessionId: string): Promise<void>;
};

export function parseAgentEventCursor(cursor?: string) {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AgentRuntimeError(
      "cursor-invalid",
      "Agent event cursor is invalid.",
    );
  }
  return parsed;
}

export class AgentRuntimeError extends Error {
  constructor(
    readonly code:
      | "run-not-found"
      | "run-state-invalid"
      | "revision-conflict"
      | "plan-revision-conflict"
      | "approval-not-found"
      | "approval-decision-conflict"
      | "context-compaction-invalid"
      | "extension-snapshot-invalid"
      | "budget-exceeded"
      | "tool-not-found"
      | "cursor-invalid"
      | "session-close-unsupported",
    message: string,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}
