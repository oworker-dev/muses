import {
  WORKFLOW_AGENT_PROFILE_REFS,
  type WorkflowAgentProfileRef,
} from "@muses/domain"

export type MusesWorkflowAgentProfile = WorkflowAgentProfileRef & {
  readonly label: string
  readonly description: string
  readonly outputMode: "text" | "json"
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly outputSchema: Readonly<Record<string, unknown>>
  readonly requiredPermissions: readonly string[]
  readonly hostCapabilities: readonly string[]
  readonly hostCapabilityPermissions: Readonly<
    Record<string, readonly string[]>
  >
  readonly budget: {
    readonly maxTurns: number
    readonly maxModelCalls: number
    readonly maxToolCalls: number
    readonly maxInputTokens: number
    readonly maxOutputTokens: number
    readonly maxDurationMs: number
  }
}

export const MUSES_WORKFLOW_AGENT_PROFILES = [
  {
    ...WORKFLOW_AGENT_PROFILE_REFS[0],
    label: "General purpose Agent",
    description:
      "A host-neutral Agent for research, files, shell work, and knowledge tasks.",
    outputMode: "text",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    },
    outputSchema: { type: "string" },
    requiredPermissions: ["canvas.read", "workflow.read"],
    hostCapabilities: [],
    hostCapabilityPermissions: {},
    budget: {
      maxTurns: 12,
      maxModelCalls: 12,
      maxToolCalls: 24,
      maxInputTokens: 120_000,
      maxOutputTokens: 24_000,
      maxDurationMs: 15 * 60 * 1000,
    },
  },
  {
    ...WORKFLOW_AGENT_PROFILE_REFS[1],
    label: "Muses platform Agent",
    description:
      "The Muses host-aware Agent that can inspect and mutate the current canvas and Workflow drafts.",
    outputMode: "text",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    },
    outputSchema: { type: "string" },
    requiredPermissions: [
      "canvas.read",
      "canvas.write",
      "image.generate",
      "workflow.read",
      "workflow.write",
      "workflow.publish",
      "workflow.invoke",
    ],
    hostCapabilities: [
      "canvas.inspect",
      "canvas.item.put",
      "image.generate",
      "workflow.list",
      "workflow.inspect",
      "workflow.invoke",
      "workflow.run.inspect",
      "workflow.run.wait",
      "workflow.draft.create",
      "workflow.draft.command",
      "workflow.validate",
      "workflow.publish",
    ],
    hostCapabilityPermissions: {
      "canvas.inspect": ["canvas.read"],
      "canvas.item.put": ["canvas.write"],
      "image.generate": ["image.generate", "canvas.write"],
      "workflow.list": ["workflow.read"],
      "workflow.inspect": ["workflow.read"],
      "workflow.invoke": ["workflow.invoke"],
      "workflow.run.inspect": ["workflow.read"],
      "workflow.run.wait": ["workflow.read"],
      "workflow.draft.create": ["workflow.write"],
      "workflow.draft.command": ["workflow.write"],
      "workflow.validate": ["workflow.read"],
      "workflow.publish": ["workflow.publish"],
    },
    budget: {
      maxTurns: 16,
      maxModelCalls: 16,
      maxToolCalls: 32,
      maxInputTokens: 160_000,
      maxOutputTokens: 32_000,
      maxDurationMs: 20 * 60 * 1000,
    },
  },
] as const satisfies readonly MusesWorkflowAgentProfile[]

export function getWorkflowAgentProfile(
  profileId: string,
  profileVersion: string
): MusesWorkflowAgentProfile | undefined {
  return MUSES_WORKFLOW_AGENT_PROFILES.find(
    (profile) =>
      profile.profileId === profileId &&
      profile.profileVersion === profileVersion
  )
}

export function isPublishedWorkflowAgentProfile(
  profileId: string,
  profileVersion: string
): boolean {
  return Boolean(getWorkflowAgentProfile(profileId, profileVersion))
}

export function hostCapabilitiesForWorkflowAgent(
  profile: MusesWorkflowAgentProfile,
  requiredPermissions?: readonly string[]
): readonly string[] {
  const allowed = new Set(requiredPermissions ?? profile.requiredPermissions)
  return profile.hostCapabilities.filter((capability) =>
    (profile.hostCapabilityPermissions[capability] || []).every((permission) =>
      allowed.has(permission)
    )
  )
}

export function clampWorkflowAgentBudget(
  profile: MusesWorkflowAgentProfile,
  requested?: Partial<MusesWorkflowAgentProfile["budget"]>
): MusesWorkflowAgentProfile["budget"] {
  const source = requested || profile.budget
  return {
    maxTurns: Math.min(
      source.maxTurns ?? profile.budget.maxTurns,
      profile.budget.maxTurns
    ),
    maxModelCalls: Math.min(
      source.maxModelCalls ?? profile.budget.maxModelCalls,
      profile.budget.maxModelCalls
    ),
    maxToolCalls: Math.min(
      source.maxToolCalls ?? profile.budget.maxToolCalls,
      profile.budget.maxToolCalls
    ),
    maxInputTokens: Math.min(
      source.maxInputTokens ?? profile.budget.maxInputTokens,
      profile.budget.maxInputTokens
    ),
    maxOutputTokens: Math.min(
      source.maxOutputTokens ?? profile.budget.maxOutputTokens,
      profile.budget.maxOutputTokens
    ),
    maxDurationMs: Math.min(
      source.maxDurationMs ?? profile.budget.maxDurationMs,
      profile.budget.maxDurationMs
    ),
  }
}
