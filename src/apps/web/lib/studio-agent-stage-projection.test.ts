import { describe, expect, it } from "vitest"

import type { AgentEvent, AgentRunSnapshot } from "@muses/agent-core"

import { agentStages } from "./studio-agent-stage-projection"

describe("Studio Agent stage projection", () => {
  it("projects a failed restored run as terminal instead of active", () => {
    const run = { status: "failed" } as AgentRunSnapshot

    expect(agentStages(run, [])).toEqual([
      { key: "understand", state: "failed" },
      { key: "create", state: "idle" },
      { key: "place", state: "idle" },
    ])
  })

  it("marks the active image stage failed when the provider turn stops", () => {
    const run = { status: "failed" } as AgentRunSnapshot
    const events = [
      { type: "model.completed", data: {} },
      { type: "tool.started", data: { toolName: "image.generate" } },
    ] as AgentEvent[]

    expect(agentStages(run, events)).toEqual([
      { key: "understand", state: "done" },
      { key: "create", state: "failed" },
      { key: "place", state: "idle" },
    ])
  })
})
