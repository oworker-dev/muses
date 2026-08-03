import { describe, expect, it } from "vitest"

import { requireAgentJsonObject } from "../lib/agent-json-boundary"
import { type WorkflowRuntimeEvent } from "./workflow-definition-interpreter"
import {
  getActiveAgentRunIds,
  mergeAgentRunIds,
} from "./workflow-agent-run-state"

type WorkflowRuntimeEventPayload = WorkflowRuntimeEvent extends infer Event
  ? Event extends WorkflowRuntimeEvent
    ? Omit<Event, "at" | "eventId" | "runId">
    : never
  : never

describe("getActiveAgentRunIds", () => {
  it("returns started AgentRuns whose nodes are not terminal", () => {
    const events = [
      runtimeEvent({
        type: "node.agent.started",
        nodeId: "agent-a",
        nodeKind: "agent-run",
        agentRunId: "arun-a",
      }),
      runtimeEvent({
        type: "node.agent.started",
        nodeId: "agent-b",
        nodeKind: "agent-run",
        agentRunId: "arun-b",
      }),
      runtimeEvent({
        type: "node.succeeded",
        nodeId: "agent-a",
        nodeKind: "agent-run",
        outputs: {},
      }),
    ]

    expect(getActiveAgentRunIds(events)).toEqual(["arun-b"])
  })

  it("excludes an AgentRun when its node caused the run failure", () => {
    const events = [
      runtimeEvent({
        type: "node.agent.started",
        nodeId: "agent-a",
        nodeKind: "agent-run",
        agentRunId: "arun-a",
      }),
      runtimeEvent({
        type: "run.failed",
        failure: {
          category: "permanent",
          code: "agent-failed",
          message: "failed",
          nodeId: "agent-a",
          nodeKind: "agent-run",
          retryable: false,
        },
      }),
    ]

    expect(getActiveAgentRunIds(events)).toEqual([])
  })

  it("unions persisted and runtime-event AgentRun ids without duplicates", () => {
    expect(
      mergeAgentRunIds(
        ["arun-persisted", "arun-shared"],
        ["arun-shared", "arun-event"]
      )
    ).toEqual(["arun-persisted", "arun-shared", "arun-event"])
  })
})

describe("requireAgentJsonObject", () => {
  it("normalizes a bounded JSON Schema without retaining mutable input objects", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        slides: {
          type: "array",
          items: { type: "object" },
        },
      },
      required: ["title", "slides"],
    }

    const normalized = requireAgentJsonObject(schema)

    expect(normalized).toEqual(schema)
    expect(normalized).not.toBe(schema)
    expect(normalized.properties).not.toBe(schema.properties)
  })

  it.each([
    ["non-finite number", { minimum: Number.NaN }],
    ["function", { transform: () => "invalid" }],
    ["non-plain object", { generatedAt: new Date() }],
  ])("rejects a %s", (_case, schema) => {
    expect(() => requireAgentJsonObject(schema)).toThrowError(
      /Agent output schema/
    )
  })

  it("rejects circular references", () => {
    const schema: Record<string, unknown> = { type: "object" }
    schema.self = schema

    expect(() => requireAgentJsonObject(schema)).toThrowError(
      /circular reference/
    )
  })

  it("rejects schemas above the bounded string budget", () => {
    expect(() =>
      requireAgentJsonObject({ description: "x".repeat(1_000_001) })
    ).toThrowError(/string limit/)
  })
})

function runtimeEvent(
  payload: WorkflowRuntimeEventPayload
): WorkflowRuntimeEvent {
  return {
    ...payload,
    at: "2026-08-01T00:00:00.000Z",
    eventId: crypto.randomUUID(),
    runId: "wrun-test",
  }
}
