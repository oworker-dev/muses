import {
  AGENT_RUNTIME_CONFIG_CONTRACT_VERSION,
  parseAgentRuntimeConfigSnapshot,
  type AgentRuntimeConfigSnapshot,
  type AgentRuntimeModel,
} from "@oworker/open-agent-contracts/runtime-config"

import { getPgPool } from "./database"
import { getWorkflowAgentProfile } from "./agent-profile-catalog"

const DEFAULT_MODEL_IDS = [
  {
    id: "gpt-5.6-sol",
    providerModelId: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
  },
  {
    id: "gpt-5.6-terra",
    providerModelId: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
  },
] as const

const DEFAULT_PROFILE = getWorkflowAgentProfile("muses-platform", "0.1.0")

export type MusesAgentProfileRef = {
  readonly profileId: string
  readonly profileVersion: string
}

export function readMusesAgentRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  requestedProfile?: MusesAgentProfileRef,
): AgentRuntimeConfigSnapshot {
  const profile = resolveProfile(requestedProfile)
  const configured = environment.MUSES_AGENT_RUNTIME_CONFIG_JSON?.trim()
  if (configured) {
    try {
      return assertMusesProfile(
        parseAgentRuntimeConfigSnapshot(JSON.parse(configured)),
        profile,
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes("Muses Open Agent runtime config")) {
        throw error
      }
      throw new Error(
        "MUSES_AGENT_RUNTIME_CONFIG_JSON is not a valid Open Agent runtime config.",
        { cause: error },
      )
    }
  }
  const defaultModelId = environment.MUSES_AGENT_DEFAULT_MODEL_ID?.trim()
  const models = parseEnvironmentModels(environment.MUSES_AGENT_MODELS_JSON)
  return createSnapshot(models ?? defaultModels(), defaultModelId, profile)
}

/**
 * Resolve the published, credential-backed LLM catalog managed by Muses.
 * The credential itself is never returned; only the model contract is placed
 * in the signed Host token.
 */
export async function getMusesAgentRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  requestedProfile?: MusesAgentProfileRef,
): Promise<AgentRuntimeConfigSnapshot> {
  const profile = resolveProfile(requestedProfile)
  if (environment.MUSES_AGENT_RUNTIME_CONFIG_JSON?.trim()) {
    return readMusesAgentRuntimeConfig(environment, profile)
  }

  try {
    const result = await getPgPool().query<{
      modelRef: string
      providerModelId: string
      displayName: string
    }>(`
      select distinct on (offering.id)
        offering.model_ref as "modelRef",
        offering.provider_model_id as "providerModelId",
        offering.display_name as "displayName"
      from model_offering offering
      join model_provider provider on provider.id = offering.provider_id
      join provider_connection_offering binding
        on binding.model_offering_id = offering.id and binding.enabled = true
      join provider_connection connection
        on connection.id = binding.connection_id and connection.status = 'active'
      join provider_credential_version credential
        on credential.connection_id = connection.id and credential.status = 'active'
      left join provider_connection_health health
        on health.connection_id = connection.id
       and health.capability_family = 'llm'
      where offering.capability_family = 'llm'
        and offering.lifecycle_status = 'published'
        and offering.enabled = true
        and provider.status = 'active'
        and connection.capabilities ? 'llm'
        and coalesce(health.status, 'unknown') <> 'unavailable'
      order by offering.id, binding.priority, connection.priority
    `)
    const models = result.rows.map((row) => ({
      id: row.modelRef,
      providerModelId: row.providerModelId,
      label: row.displayName,
    }))
    if (models.length > 0) {
      return createSnapshot(
        models,
        environment.MUSES_AGENT_DEFAULT_MODEL_ID?.trim() || models[0]!.id,
        profile,
      )
    }
  } catch (error) {
    // Token issuance must remain available during a catalog migration or a
    // temporary database outage. The Agent broker still fails closed if the
    // selected model has no actual provider connection.
    console.warn("Unable to resolve the Muses LLM catalog for Open Agent token", error)
  }
  return readMusesAgentRuntimeConfig(environment, profile)
}

function createSnapshot(
  modelInputs: readonly Pick<AgentRuntimeModel, "id" | "providerModelId" | "label">[],
  requestedDefault?: string,
  profile = DEFAULT_PROFILE,
): AgentRuntimeConfigSnapshot {
  const models: AgentRuntimeModel[] = modelInputs.map((model) => ({
    id: model.id,
    providerModelId: model.providerModelId,
    label: model.label,
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    reasoningLevels: ["low", "medium", "high", "xhigh"],
    defaultReasoning: "high",
  }))
  const defaultModelId = models.some((model) => model.id === requestedDefault)
    ? requestedDefault!
    : models[0]!.id
  if (!profile) throw new Error("The requested Muses Agent profile is missing.")
  return parseAgentRuntimeConfigSnapshot({
    contractVersion: AGENT_RUNTIME_CONFIG_CONTRACT_VERSION,
    id: "muses-platform",
    version: "0.1.0",
    defaultModelId,
    models,
    profile: {
      id: profile.profileId,
      version: profile.profileVersion,
      label: profile.label,
      outputMode: profile.outputMode,
      allowedSkills: [],
      defaultSkills: [],
      allowedMcpConnections: [],
      defaultMcpConnections: [],
    },
    compaction: { thresholdPercent: 0.82 },
    limits: {
      maxDurationMs: profile.budget.maxDurationMs,
      maxInputTokens: profile.budget.maxInputTokens,
      maxModelCalls: profile.budget.maxModelCalls,
      maxOutputTokens: profile.budget.maxOutputTokens,
      maxToolCalls: profile.budget.maxToolCalls,
      maxTurns: profile.budget.maxTurns,
    },
  })
}

function assertMusesProfile(
  config: AgentRuntimeConfigSnapshot,
  requestedProfile = DEFAULT_PROFILE,
): AgentRuntimeConfigSnapshot {
  if (
    !requestedProfile ||
    config.profile.id !== requestedProfile.profileId ||
    config.profile.version !== requestedProfile.profileVersion
  ) {
    throw new Error(
      `Muses Open Agent runtime config must publish the ${requestedProfile?.profileId ?? "requested"}@${requestedProfile?.profileVersion ?? "unknown"} profile.`,
    )
  }
  return config
}

function resolveProfile(requestedProfile?: MusesAgentProfileRef) {
  const profile = requestedProfile
    ? getWorkflowAgentProfile(
      requestedProfile.profileId,
      requestedProfile.profileVersion,
    )
    : DEFAULT_PROFILE
  if (!profile) {
    throw new Error(
      `Muses Open Agent profile ${requestedProfile?.profileId ?? "muses-platform"}@${requestedProfile?.profileVersion ?? "0.1.0"} is not published.`,
    )
  }
  return profile
}

function defaultModels() {
  return DEFAULT_MODEL_IDS
}

function parseEnvironmentModels(value: string | undefined) {
  if (!value?.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error()
    const models = parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return []
      const candidate = item as Record<string, unknown>
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.providerModelId !== "string" ||
        typeof candidate.label !== "string"
      ) return []
      return [{
        id: candidate.id,
        providerModelId: candidate.providerModelId,
        label: candidate.label,
      }]
    })
    return models.length > 0 ? models : undefined
  } catch {
    throw new Error("MUSES_AGENT_MODELS_JSON must be a JSON array of model descriptors.")
  }
}
