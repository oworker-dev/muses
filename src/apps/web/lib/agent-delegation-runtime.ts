import { createHash } from "node:crypto"

import Ajv, { type AnySchema, type ValidateFunction } from "ajv"
import type { Pool } from "pg"

import {
  AgentDelegationRuntimeError,
  DefaultAgentDelegationScheduler,
  type AgentDelegationArtifactAuthorizationPort,
  type AgentDelegationChildRuntimePort,
  type AgentDelegationEvidence,
  type AgentDelegationFingerprintPort,
  type AgentDelegationProfileRegistryPort,
  type AgentDelegationResultValidatorPort,
  type AgentDelegationTaskResult,
  type AgentProfileSnapshot,
} from "@muses/agent-core"

import {
  PostgresAgentDelegationBudget,
  PostgresAgentDelegationStore,
} from "./agent-delegation-store"
import { getPgPool } from "./database"
import { PostgresGeneratedAssetAuthorization } from "./generated-asset-authorization"

export { PostgresGeneratedAssetAuthorization } from "./generated-asset-authorization"

export class Sha256AgentDelegationFingerprint
  implements AgentDelegationFingerprintPort
{
  fingerprint(value: unknown) {
    return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
  }
}

export type VersionedAgentProfileRegistration = {
  readonly profile: AgentProfileSnapshot
  readonly workspaceIds?: readonly string[]
  readonly projectIds?: readonly string[]
}

export class VersionedAgentProfileRegistry
  implements AgentDelegationProfileRegistryPort
{
  private readonly registrations = new Map<
    string,
    VersionedAgentProfileRegistration
  >()

  constructor(registrations: readonly VersionedAgentProfileRegistration[]) {
    for (const registration of registrations) {
      validateProfileRegistration(registration)
      const key = profileKey(
        registration.profile.profileId,
        registration.profile.version
      )
      if (this.registrations.has(key)) {
        throw new AgentDelegationRuntimeError(
          "delegation-profile-invalid",
          `Agent Profile "${key}" is registered more than once.`
        )
      }
      this.registrations.set(key, structuredClone(registration))
    }
  }

  async resolve(input: {
    readonly workspaceId: string
    readonly projectId: string
    readonly profileId: string
    readonly version: string
  }) {
    const registration = this.registrations.get(
      profileKey(input.profileId, input.version)
    )
    if (!registration) return null
    if (
      registration.workspaceIds &&
      !registration.workspaceIds.includes(input.workspaceId)
    ) {
      return null
    }
    if (
      registration.projectIds &&
      !registration.projectIds.includes(input.projectId)
    ) {
      return null
    }
    return structuredClone(registration.profile)
  }
}

export type AgentDelegationEvidenceAuthorizationPort = {
  authorize(input: {
    readonly workspaceId: string
    readonly projectId: string
    readonly evidence: AgentDelegationEvidence
    readonly result: AgentDelegationTaskResult
  }): Promise<boolean>
}

export class ArtifactEvidenceAuthorization
  implements AgentDelegationEvidenceAuthorizationPort
{
  async authorize(input: {
    readonly evidence: AgentDelegationEvidence
    readonly result: AgentDelegationTaskResult
  }) {
    return (
      input.evidence.kind === "artifact" &&
      input.result.artifactRefs.includes(input.evidence.ref)
    )
  }
}

export class AjvAgentDelegationResultValidator
  implements AgentDelegationResultValidatorPort
{
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: true,
    validateSchema: true,
  })
  private readonly validators = new Map<string, ValidateFunction>()

  constructor(
    private readonly artifacts: AgentDelegationArtifactAuthorizationPort,
    private readonly evidence: AgentDelegationEvidenceAuthorizationPort =
      new ArtifactEvidenceAuthorization()
  ) {}

  async validate(
    input: Parameters<AgentDelegationResultValidatorPort["validate"]>[0]
  ): Promise<Awaited<ReturnType<AgentDelegationResultValidatorPort["validate"]>>> {
    const structureIssue = validateResultStructure(input.result)
    if (structureIssue) return structureIssue

    let serialized: string
    try {
      serialized = canonicalJson(input.result)
    } catch {
      return invalidResult(
        "result-not-json",
        "Delegated result is not JSON serializable."
      )
    }
    if (Buffer.byteLength(serialized, "utf8") > input.task.result.maxBytes) {
      return invalidResult(
        "result-size-exceeded",
        "Delegated result exceeds its byte limit."
      )
    }

    let validator: ValidateFunction
    try {
      const schemaKey = canonicalJson(input.task.result.outputSchema)
      validator = this.validators.get(schemaKey) || this.compile(schemaKey)
    } catch {
      return invalidResult(
        "result-schema-invalid",
        "Delegated result Schema is invalid."
      )
    }
    if (!validator(input.result.data)) {
      const issue = validator.errors?.[0]
      return invalidResult(
        "result-schema-mismatch",
        issue
          ? `Delegated result does not match its Schema at ${issue.instancePath || "/"} (${issue.keyword}).`
          : "Delegated result does not match its Schema."
      )
    }

    const kinds = new Set(input.result.evidence.map(({ kind }) => kind))
    if (
      input.task.result.requiredEvidenceKinds.some((kind) => !kinds.has(kind))
    ) {
      return invalidResult(
        "result-evidence-missing",
        "Delegated result is missing required evidence."
      )
    }

    const artifactAuthorization = await this.artifacts.authorize({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      artifactRefs: input.result.artifactRefs,
    })
    if (!artifactAuthorization.ok) {
      return invalidResult(
        "result-artifact-not-authorized",
        "Delegated result references an unauthorized Artifact."
      )
    }
    for (const evidence of input.result.evidence) {
      if (
        !(await this.evidence.authorize({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          evidence,
          result: input.result,
        }))
      ) {
        return invalidResult(
          "result-evidence-not-authorized",
          `Delegated result evidence kind "${evidence.kind}" is not authorized.`
        )
      }
    }
    return { ok: true }
  }

  private compile(schemaKey: string) {
    const validator = this.ajv.compile(
      JSON.parse(schemaKey) as AnySchema
    ) as ValidateFunction
    this.validators.set(schemaKey, validator)
    return validator
  }
}

export function createAgentDelegationScheduler(input: {
  readonly children: AgentDelegationChildRuntimePort
  readonly pool?: Pool
  readonly profiles: readonly VersionedAgentProfileRegistration[]
  readonly evidence?: AgentDelegationEvidenceAuthorizationPort
}) {
  const pool = input.pool || getPgPool()
  return new DefaultAgentDelegationScheduler({
    store: new PostgresAgentDelegationStore({ pool }),
    budget: new PostgresAgentDelegationBudget(pool),
    children: input.children,
    profiles: new VersionedAgentProfileRegistry(input.profiles),
    results: new AjvAgentDelegationResultValidator(
      new PostgresGeneratedAssetAuthorization(pool),
      input.evidence
    ),
    fingerprints: new Sha256AgentDelegationFingerprint(),
  })
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== "object") throw new TypeError("Unsupported JSON value")
  if (ancestors.has(value)) throw new TypeError("Cyclic JSON value")
  ancestors.add(value)
  let serialized: string
  if (Array.isArray(value)) {
    const items: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError("Sparse JSON array")
      items.push(canonicalJson(value[index], ancestors))
    }
    serialized = `[${items.join(",")}]`
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Non-plain JSON object")
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Symbol-keyed JSON property")
    }
    serialized = `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], ancestors)}`
      )
      .join(",")}}`
  }
  ancestors.delete(value)
  return serialized
}

function validateProfileRegistration(
  registration: VersionedAgentProfileRegistration
) {
  if (!registration || typeof registration !== "object") {
    throw invalidProfileRegistration()
  }
  const { profile } = registration
  if (!profile || typeof profile !== "object") {
    throw invalidProfileRegistration()
  }
  const identity = [profile.profileId, profile.version, profile.modelRef]
  const collections = [
    profile.toolNames,
    profile.skillRefs,
    profile.mcpConnectionRefs,
    registration.workspaceIds || [],
    registration.projectIds || [],
  ]
  if (
    identity.some((value) => !isNonEmptyString(value)) ||
    !isNonEmptyString(profile.instructions) ||
    collections.some((values) => !isUniqueNonEmptyStringList(values))
  ) {
    throw invalidProfileRegistration()
  }
}

function profileKey(profileId: string, version: string) {
  return JSON.stringify([profileId, version])
}

function validateResultStructure(result: AgentDelegationTaskResult) {
  if (
    !result ||
    typeof result !== "object" ||
    !Object.hasOwn(result, "data") ||
    !Array.isArray(result.artifactRefs) ||
    !Array.isArray(result.evidence) ||
    result.artifactRefs.some((ref) => typeof ref !== "string" || !ref.trim()) ||
    new Set(result.artifactRefs).size !== result.artifactRefs.length ||
    result.evidence.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof item.kind !== "string" ||
        !item.kind.trim() ||
        typeof item.ref !== "string" ||
        !item.ref.trim()
    ) ||
    new Set(result.evidence.map(({ kind, ref }) => `${kind}\u0000${ref}`)).size !==
      result.evidence.length
  ) {
    return invalidResult(
      "result-structure-invalid",
      "Delegated result structure is invalid."
    )
  }
  return null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim())
}

function isUniqueNonEmptyStringList(
  value: unknown
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  )
}

function invalidProfileRegistration() {
  return new AgentDelegationRuntimeError(
    "delegation-profile-invalid",
    "Agent Profile registration is malformed."
  )
}

function invalidResult(code: string, message: string) {
  return { ok: false as const, code, message }
}
