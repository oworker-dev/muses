import { createHmac, randomUUID } from "node:crypto"
import {
  AgentClientHttpError,
  createAgentRunClient,
  type AgentRunClient,
  type AgentRunEventsResponse,
  type AgentRunStartResponse,
} from "@oworker/open-agent-client"
import {
  type AgentEvent,
  type AgentProfileRef,
  type AgentRunPolicy,
  type AgentRunSnapshot,
  type StartAgentRunRequest,
} from "@oworker/open-agent-contracts/agent-run"
import {
  AGENT_HOST_CONTRACT_VERSION,
} from "@oworker/open-agent-contracts/host"
import {
  parseAgentRuntimeConfigSnapshot,
  type AgentRuntimeConfigSnapshot,
} from "@oworker/open-agent-contracts/runtime-config"
import { readMusesAgentRuntimeConfig } from "./muses-agent-runtime-config"

export const MUSES_AGENT_HOST_CONTRACT_VERSION = AGENT_HOST_CONTRACT_VERSION
const DEFAULT_TOKEN_TTL_SECONDS = 300

export type MusesAgentHostActor = {
  readonly userId: string
  readonly workspaceId: string
  readonly actorType?: "user" | "service"
  /** Opaque host scope. Open Agent signs and forwards it without interpretation. */
  readonly scope?: Readonly<Record<string, string>>
  readonly runtimeConfig?: AgentRuntimeConfigSnapshot
}

export type MusesAgentProfileRef = AgentProfileRef
export type MusesAgentRunPolicy = AgentRunPolicy
export type MusesAgentRunStartRequest = StartAgentRunRequest
export type MusesAgentRunSnapshot = AgentRunSnapshot
export type MusesAgentRunEvent = AgentEvent
export type MusesAgentRunEventsResponse = AgentRunEventsResponse
export type MusesAgentRunStartResponse = AgentRunStartResponse
export type MusesAgentRunClient = AgentRunClient

export function isMusesAgentConfigured(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return Boolean(environment.MUSES_AGENT_SERVICE_URL?.trim() && environment.MUSES_AGENT_HOST_JWT_SECRET?.trim())
}

export function createMusesAgentHostToken(
  actor: MusesAgentHostActor,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { readonly token: string; readonly expiresAt: string } {
  const secret = required(environment.MUSES_AGENT_HOST_JWT_SECRET, "MUSES_AGENT_HOST_JWT_SECRET")
  if (secret.length < 32) throw new Error("MUSES_AGENT_HOST_JWT_SECRET must contain at least 32 characters.")
  const issuer = required(environment.MUSES_AGENT_HOST_JWT_ISSUER, "MUSES_AGENT_HOST_JWT_ISSUER")
  const audience = required(environment.MUSES_AGENT_HOST_JWT_AUDIENCE, "MUSES_AGENT_HOST_JWT_AUDIENCE")
  const ttl = parseTokenTtl(environment.MUSES_AGENT_HOST_JWT_TTL_SECONDS)
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = new Date((now + ttl) * 1000).toISOString()
  const header = { alg: "HS256", typ: "JWT" }
  const runtimeConfig = parseAgentRuntimeConfigSnapshot(
    actor.runtimeConfig ?? readMusesAgentRuntimeConfig(environment),
  )
  const payload = {
    actorType: actor.actorType ?? "user",
    aud: audience,
    exp: now + ttl,
    iat: now,
    iss: issuer,
    jti: `muses-host-${randomUUID()}`,
    scope: ["agent:runs"],
    ...(actor.scope ? { agentHostScope: JSON.stringify(actor.scope) } : {}),
    agentRuntimeConfig: JSON.stringify(runtimeConfig),
    sub: actor.userId,
    tenantId: actor.workspaceId,
  }
  const encodedHeader = encodeBase64Url(JSON.stringify(header))
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url")
  return { token: `${signingInput}.${signature}`, expiresAt }
}

export function createMusesAgentHostClient(
  actor: MusesAgentHostActor,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): MusesAgentRunClient {
  const baseUrl = required(environment.MUSES_AGENT_SERVICE_URL, "MUSES_AGENT_SERVICE_URL").replace(/\/$/, "")
  return createAgentRunClient({
    baseUrl,
    fetch: fetchImplementation,
    getAccessToken: () => createMusesAgentHostToken(actor, environment).token,
  })
}

export { AgentClientHttpError as MusesAgentHostError }

function required(value: string | undefined, name: string) {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required.`)
  return normalized
}

function parseTokenTtl(value: string | undefined) {
  if (!value?.trim()) return DEFAULT_TOKEN_TTL_SECONDS
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 60 || parsed > 900) {
    throw new Error("MUSES_AGENT_HOST_JWT_TTL_SECONDS must be an integer from 60 to 900.")
  }
  return parsed
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}
