import { describe, expect, it } from "vitest"

import {
  AGENT_CORE_SCHEMA_VERSION,
  AGENT_MODEL_FAILURE_MESSAGE,
  type AgentEvent,
} from "@muses/agent-core"

import {
  toPublicAgentEvent,
  toPublicAgentFailure,
} from "./agent-client-projection"

describe("Agent client projection", () => {
  it("redacts historical model failures from snapshots and events", () => {
    const rawMessage = "Provider balance and request id"
    const failure = {
      code: "model-failed",
      message: rawMessage,
      retryable: true,
    }
    const event: AgentEvent = {
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      eventId: "event-1",
      runId: "run-1",
      sequence: 1,
      type: "run.failed",
      createdAt: "2026-07-29T00:00:00.000Z",
      data: failure,
    }

    expect(toPublicAgentFailure(failure)?.message).toBe(
      AGENT_MODEL_FAILURE_MESSAGE
    )
    expect(toPublicAgentEvent(event).data.message).toBe(
      AGENT_MODEL_FAILURE_MESSAGE
    )
    expect(
      JSON.stringify({
        failure: toPublicAgentFailure(failure),
        event: toPublicAgentEvent(event),
      })
    ).not.toContain(rawMessage)
  })

  it("preserves domain failures that are already safe", () => {
    const failure = {
      code: "duration-budget-exceeded",
      message: "Agent budget exceeded: duration-budget-exceeded.",
      retryable: false,
    }

    expect(toPublicAgentFailure(failure)).toBe(failure)
  })
})
