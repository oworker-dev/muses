import {
  AGENT_MODEL_FAILURE_MESSAGE,
  type AgentEvent,
  type AgentRunSnapshot,
} from "@muses/agent-core"

export function toPublicAgentFailure(
  failure: AgentRunSnapshot["failure"]
) {
  if (failure?.code !== "model-failed") return failure
  return { ...failure, message: AGENT_MODEL_FAILURE_MESSAGE }
}

export function toPublicAgentEvent(event: AgentEvent): AgentEvent {
  if (event.type !== "run.failed" || event.data.code !== "model-failed") {
    return event
  }
  return {
    ...event,
    data: { ...event.data, message: AGENT_MODEL_FAILURE_MESSAGE },
  }
}
