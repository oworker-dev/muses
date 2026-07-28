import {
  DefaultAgentPolicy,
  HeadlessAgentRuntime,
  type AgentBudgetLimit,
  type AgentProfileSnapshot,
} from "@muses/agent-core"

import { AiSdkAgentModel, configuredAgentModelRef } from "@/lib/agent-model"
import { PostgresAgentStateStore } from "@/lib/agent-state-store"
import { MusesAgentToolRegistry } from "@/lib/agent-tools"

export const MUSES_AGENT_PROFILE_VERSION = "0.1.0-alpha"

export function createMusesAgentRuntime() {
  return new HeadlessAgentRuntime({
    model: new AiSdkAgentModel(),
    tools: new MusesAgentToolRegistry(),
    policy: new DefaultAgentPolicy(),
    store: new PostgresAgentStateStore(),
  })
}

export function musesAgentProfile(): AgentProfileSnapshot {
  return {
    profileId: "muses-agent",
    version: MUSES_AGENT_PROFILE_VERSION,
    modelRef: configuredAgentModelRef(),
    instructions: [
      "You are MusesAgent, the execution Agent inside an AI design platform.",
      "Turn the user's concrete creative request into an observable result by using Muses tools.",
      "For an image request, call image.generate directly with a faithful visual prompt. Do not invent multiple directions unless the user asks for variants.",
      "Inspect the canvas only when existing context is needed. Every project mutation must happen through a provided tool.",
      "After a tool succeeds, report the actual result briefly. Never claim an asset exists before a tool returns it.",
    ].join("\n"),
    toolNames: ["canvas.inspect", "canvas.item.put", "image.generate"],
    skillRefs: [],
    mcpConnectionRefs: [],
  }
}

export function defaultAgentBudget(): AgentBudgetLimit {
  return {
    maxTurns: 8,
    maxModelCalls: 8,
    maxToolCalls: 8,
    maxInputTokens: 80_000,
    maxOutputTokens: 16_000,
    maxCreditMicros: process.env.MUSES_AGENT_MAX_CREDIT_MICROS || "100000000",
    maxDurationMs: 15 * 60 * 1000,
  }
}
