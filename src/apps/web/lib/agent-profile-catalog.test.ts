import { describe, expect, it } from "vitest"

import {
  clampWorkflowAgentBudget,
  getWorkflowAgentProfile,
  hostCapabilitiesForWorkflowAgent,
} from "./agent-profile-catalog"

describe("workflow Agent profile policy", () => {
  const profile = getWorkflowAgentProfile("muses-platform", "0.1.0")!

  it("exposes only capabilities covered by the effective permissions", () => {
    expect(
      hostCapabilitiesForWorkflowAgent(profile, [
        "canvas.read",
        "workflow.read",
      ])
    ).toEqual([
      "canvas.inspect",
      "workflow.list",
      "workflow.inspect",
      "workflow.run.inspect",
      "workflow.run.wait",
      "workflow.validate",
    ])
    expect(hostCapabilitiesForWorkflowAgent(profile, ["canvas.write"])).toEqual(
      ["canvas.item.put"]
    )
  })

  it("clamps every requested budget dimension to the published Profile", () => {
    expect(
      clampWorkflowAgentBudget(profile, {
        maxTurns: profile.budget.maxTurns + 10,
        maxModelCalls: 2,
        maxToolCalls: profile.budget.maxToolCalls + 10,
        maxInputTokens: profile.budget.maxInputTokens + 1,
        maxOutputTokens: 1_000,
        maxDurationMs: profile.budget.maxDurationMs + 1,
      })
    ).toEqual({
      maxTurns: profile.budget.maxTurns,
      maxModelCalls: 2,
      maxToolCalls: profile.budget.maxToolCalls,
      maxInputTokens: profile.budget.maxInputTokens,
      maxOutputTokens: 1_000,
      maxDurationMs: profile.budget.maxDurationMs,
    })
  })
})
