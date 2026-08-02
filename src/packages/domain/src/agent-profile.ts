export const WORKFLOW_AGENT_PROFILE_REFS = [
  { profileId: "general-purpose", profileVersion: "0.1.0" },
  { profileId: "muses-platform", profileVersion: "0.1.0" },
] as const

export type WorkflowAgentProfileRef = (typeof WORKFLOW_AGENT_PROFILE_REFS)[number]

export function isWorkflowAgentProfileRef(
  value: unknown,
): value is WorkflowAgentProfileRef {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return WORKFLOW_AGENT_PROFILE_REFS.some(
    (profile) =>
      profile.profileId === candidate.profileId &&
      profile.profileVersion === candidate.profileVersion,
  )
}
