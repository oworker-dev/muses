import {
  AGENT_MODEL_FAILURE_MESSAGE,
  type AgentEvent,
  type AgentRunSnapshot,
} from "@muses/agent-core"

export function toPublicAgentFailure(failure: AgentRunSnapshot["failure"]) {
  if (!isModelFailureCode(failure?.code)) return failure
  return { ...failure, message: AGENT_MODEL_FAILURE_MESSAGE }
}

export function toPublicAgentEvent(event: AgentEvent): AgentEvent {
  if (event.type !== "run.failed" || !isModelFailureCode(event.data.code)) {
    return event
  }
  return {
    ...event,
    data: { ...event.data, message: AGENT_MODEL_FAILURE_MESSAGE },
  }
}

function isModelFailureCode(code: unknown) {
  return code === "model-failed" || code === "model-provider-rejected"
}
