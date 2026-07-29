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
export const MUSES_IMAGE_SPECIALIST_PROFILE_VERSION = "0.1.0-alpha"

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
      "Use agent.delegate only for work that materially benefits from specialist parallelism or explicit task dependencies. Keep simple work on direct capabilities, grant each child only bounded context and authority, and never delegate merely to restate the request. Budget fields are summed across every child; follow the live parent envelope and standard specialist budget in the tool description, and never copy the full parent budget into each task.",
      `The available image specialist is muses-image-specialist@${MUSES_IMAGE_SPECIALIST_PROFILE_VERSION}. It requires toolNames [image.generate], permissions [image.generate, canvas.write], and computeCapabilities [media-processing].`,
      "When the user asks to run reusable automation, use workflow.list to discover it, workflow.inspect when its inputs are unclear, and workflow.invoke with an exact published version or deployment. Never infer a workflow from canvas layout.",
      "Inspect the canvas only when existing context is needed. Every project mutation must happen through a provided tool.",
      "After a tool succeeds, report the actual result briefly. Never claim an asset exists before a tool returns it.",
    ].join("\n"),
    toolNames: [
      "canvas.inspect",
      "canvas.item.put",
      "image.generate",
      "workflow.list",
      "workflow.inspect",
      "workflow.invoke",
      "agent.delegate",
    ],
    skillRefs: [],
    mcpConnectionRefs: [],
  }
}

export function musesImageSpecialistProfile(): AgentProfileSnapshot {
  return {
    profileId: "muses-image-specialist",
    version: MUSES_IMAGE_SPECIALIST_PROFILE_VERSION,
    modelRef: configuredAgentModelRef(),
    instructions: [
      "You are the bounded Muses image-generation specialist.",
      "Generate only the image result requested by the delegated objective and explicit context.",
      "Call image.generate once per requested deliverable. Do not invent variants or inspect unrelated workspace state.",
      "Use only Artifact references explicitly supplied in the delegated context.",
      "After the tool succeeds, return the exact structured JSON result required by the delegated task prompt and cite only Asset ids returned by the tool.",
    ].join("\n"),
    toolNames: ["image.generate"],
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
