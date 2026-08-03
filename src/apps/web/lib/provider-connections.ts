import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

import { getPgPool } from "./database"
import {
  isProviderCredentialVaultConfigured,
  openProviderCredential,
  sealProviderCredential,
  type StoredProviderCredential,
} from "./provider-credential-vault"

export const PROVIDER_CAPABILITY_FAMILIES = [
  "llm",
  "image",
  "video",
  "audio",
  "music",
] as const

export type ProviderCapabilityFamily =
  (typeof PROVIDER_CAPABILITY_FAMILIES)[number]
export type ProviderConnectionStatus = "active" | "disabled"
export type ProviderHealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unavailable"

export type AdminProviderConnection = {
  id: string
  providerId: string
  providerSlug: string
  providerDisplayName: string
  name: string
  baseUrl: string | null
  status: ProviderConnectionStatus
  capabilities: ProviderCapabilityFamily[]
  modelAllowlist: string[]
  priority: number
  credential: null | {
    id: string
    secretHint: string
    keyId: string
    createdAt: string
  }
  offeringIds: string[]
  health: Array<{
    capability: ProviderCapabilityFamily
    status: ProviderHealthStatus
    httpStatus: number | null
    latencyMs: number | null
    resultCode: string | null
    checkedAt: string | null
    lastSuccessAt: string | null
  }>
  createdAt: string
  updatedAt: string
}

export type AdminProviderControlPlane = {
  vaultConfigured: boolean
  providers: Array<{ id: string; slug: string; displayName: string }>
  offerings: Array<{
    id: string
    providerId: string
    displayName: string
    modelRef: string
    capabilityFamily: ProviderCapabilityFamily
  }>
  connections: AdminProviderConnection[]
}

export type ProviderRuntimeConnection = {
  id: string
  providerId: string
  providerSlug: string
  apiKey: string
  baseURL?: string
  source: "credential-vault"
}

export class ProviderConnectionError extends Error {
  constructor(
    readonly code:
      | "vault-not-configured"
      | "connection-unavailable"
      | "connection-invalid"
      | "provider-unavailable",
    message: string
  ) {
    super(message)
    this.name = "ProviderConnectionError"
  }
}

export async function getAdminProviderControlPlane(): Promise<AdminProviderControlPlane> {
  const pool = getPgPool()
  const [
    providersResult,
    offeringsResult,
    connectionsResult,
    credentialsResult,
    bindingsResult,
    healthResult,
  ] = await Promise.all([
    pool.query<ProviderRow>(
      `select id, slug, display_name as "displayName" from model_provider order by display_name, slug`
    ),
    pool.query<OfferingRow>(
      `
          select
            id,
            provider_id as "providerId",
            display_name as "displayName",
            model_ref as "modelRef",
            capability_family as "capabilityFamily"
          from model_offering
          where lifecycle_status in ('published', 'deprecated')
          order by sort_order, display_name, model_ref
        `
    ),
    pool.query<ConnectionRow>(
      `
          select
            connection.id,
            connection.provider_id as "providerId",
            provider.slug as "providerSlug",
            provider.display_name as "providerDisplayName",
            connection.name,
            connection.base_url as "baseUrl",
            connection.status,
            connection.capabilities,
            connection.model_allowlist as "modelAllowlist",
            connection.priority,
            connection.created_at as "createdAt",
            connection.updated_at as "updatedAt"
          from provider_connection connection
          join model_provider provider on provider.id = connection.provider_id
          order by connection.priority, provider.display_name, connection.name
        `
    ),
    pool.query<CredentialMetadataRow>(
      `
          select
            id,
            connection_id as "connectionId",
            secret_hint as "secretHint",
            key_id as "keyId",
            created_at as "createdAt"
          from provider_credential_version
          where status = 'active'
        `
    ),
    pool.query<{ connectionId: string; offeringId: string }>(
      `
          select
            connection_id as "connectionId",
            model_offering_id as "offeringId"
          from provider_connection_offering
          where enabled = true
          order by priority, model_offering_id
        `
    ),
    pool.query<HealthRow>(
      `
          select
            connection_id as "connectionId",
            capability_family as capability,
            status,
            http_status as "httpStatus",
            latency_ms as "latencyMs",
            result_code as "resultCode",
            checked_at as "checkedAt",
            last_success_at as "lastSuccessAt"
          from provider_connection_health
          order by capability_family
        `
    ),
  ])

  const credentials = new Map(
    credentialsResult.rows.map((row) => [row.connectionId, row])
  )
  const offeringIds = groupFieldByConnection(bindingsResult.rows, "offeringId")
  const health = groupRowsByConnection(healthResult.rows)
  return {
    vaultConfigured: isProviderCredentialVaultConfigured(),
    providers: providersResult.rows,
    offerings: offeringsResult.rows.map((row) => ({
      ...row,
      capabilityFamily: parseCapability(row.capabilityFamily),
    })),
    connections: connectionsResult.rows.map((row) => {
      const credential = credentials.get(row.id)
      return {
        ...row,
        status: parseConnectionStatus(row.status),
        capabilities: parseCapabilities(row.capabilities),
        modelAllowlist: parseStringArray(row.modelAllowlist),
        credential: credential
          ? {
              id: credential.id,
              secretHint: credential.secretHint,
              keyId: credential.keyId,
              createdAt: toIso(credential.createdAt),
            }
          : null,
        offeringIds: offeringIds.get(row.id) || [],
        health: (health.get(row.id) || []).map((item) => ({
          capability: parseCapability(item.capability),
          status: parseHealthStatus(item.status),
          httpStatus: item.httpStatus,
          latencyMs: item.latencyMs,
          resultCode: item.resultCode,
          checkedAt: item.checkedAt ? toIso(item.checkedAt) : null,
          lastSuccessAt: item.lastSuccessAt ? toIso(item.lastSuccessAt) : null,
        })),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      }
    }),
  }
}

export async function createProviderConnection(input: {
  providerId: string
  name: string
  baseUrl?: string
  credential: string
  capabilities: readonly string[]
  modelAllowlist?: readonly string[]
  offeringIds?: readonly string[]
  actorUserId: string
  actorEmail: string
}) {
  const connectionId = prefixedId("provider_connection")
  const credentialId = prefixedId("provider_credential")
  const name = normalizedName(input.name)
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const capabilities = normalizeCapabilities(input.capabilities)
  const modelAllowlist = normalizeModelAllowlist(input.modelAllowlist || [])
  const offeringIds = uniqueIds(input.offeringIds || [])
  const sealed = sealProviderCredential({
    credentialId,
    connectionId,
    secret: input.credential,
  })
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    await assertProviderAndOfferings(client, {
      providerId: input.providerId,
      capabilities,
      offeringIds,
    })
    await client.query(
      `
        insert into provider_connection (
          id, provider_id, name, base_url, capabilities, model_allowlist,
          created_by_user_id
        ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
      `,
      [
        connectionId,
        input.providerId,
        name,
        baseUrl,
        JSON.stringify(capabilities),
        JSON.stringify(modelAllowlist),
        input.actorUserId,
      ]
    )
    await insertCredential(client, {
      credentialId,
      connectionId,
      actorUserId: input.actorUserId,
      sealed,
    })
    for (const capability of capabilities) {
      await client.query(
        `
          insert into provider_connection_health (connection_id, capability_family)
          values ($1, $2)
          on conflict (connection_id, capability_family) do nothing
        `,
        [connectionId, capability]
      )
    }
    await replaceOfferingBindings(client, connectionId, offeringIds)
    await insertAudit(client, {
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "provider_connection.created",
      targetId: connectionId,
      metadata: {
        providerId: input.providerId,
        name,
        baseUrlConfigured: Boolean(baseUrl),
        capabilities,
        modelAllowlistCount: modelAllowlist.length,
        offeringIds,
        credentialHint: sealed.secretHint,
        credentialKeyId: sealed.keyId,
      },
    })
    await client.query("commit")
    return { id: connectionId }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw sanitizeMutationError(error)
  } finally {
    client.release()
  }
}

export async function rotateProviderCredential(input: {
  connectionId: string
  credential: string
  actorUserId: string
  actorEmail: string
}) {
  const credentialId = prefixedId("provider_credential")
  const sealed = sealProviderCredential({
    credentialId,
    connectionId: input.connectionId,
    secret: input.credential,
  })
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const locked = await client.query(
      `select id from provider_connection where id = $1 for update`,
      [input.connectionId]
    )
    if (!locked.rowCount) {
      throw new ProviderConnectionError(
        "connection-unavailable",
        "The provider connection does not exist."
      )
    }
    await client.query(
      `
        update provider_credential_version
        set status = 'revoked', revoked_at = now()
        where connection_id = $1 and status = 'active'
      `,
      [input.connectionId]
    )
    await insertCredential(client, {
      credentialId,
      connectionId: input.connectionId,
      actorUserId: input.actorUserId,
      sealed,
    })
    await client.query(
      `
        update provider_connection_health
        set status = 'unknown', http_status = null, latency_ms = null,
            result_code = null, checked_at = null
        where connection_id = $1
      `,
      [input.connectionId]
    )
    await insertAudit(client, {
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "provider_connection.credential_rotated",
      targetId: input.connectionId,
      metadata: {
        credentialHint: sealed.secretHint,
        credentialKeyId: sealed.keyId,
      },
    })
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw sanitizeMutationError(error)
  } finally {
    client.release()
  }
}

export async function setProviderConnectionStatus(input: {
  connectionId: string
  status: ProviderConnectionStatus
  actorUserId: string
  actorEmail: string
}) {
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const result = await client.query(
      `
        update provider_connection
        set status = $2, updated_at = now()
        where id = $1
        returning id
      `,
      [input.connectionId, input.status]
    )
    if (!result.rowCount) {
      throw new ProviderConnectionError(
        "connection-unavailable",
        "The provider connection does not exist."
      )
    }
    await insertAudit(client, {
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action:
        input.status === "active"
          ? "provider_connection.enabled"
          : "provider_connection.disabled",
      targetId: input.connectionId,
      metadata: { status: input.status },
    })
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw sanitizeMutationError(error)
  } finally {
    client.release()
  }
}

export async function setProviderConnectionOfferings(input: {
  connectionId: string
  offeringIds: readonly string[]
  actorUserId: string
  actorEmail: string
}) {
  const offeringIds = uniqueIds(input.offeringIds)
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const connection = await client.query<{
      providerId: string
      capabilities: unknown
    }>(
      `
        select provider_id as "providerId", capabilities
        from provider_connection
        where id = $1
        for update
      `,
      [input.connectionId]
    )
    const row = connection.rows[0]
    if (!row) {
      throw new ProviderConnectionError(
        "connection-unavailable",
        "The provider connection does not exist."
      )
    }
    await assertProviderAndOfferings(client, {
      providerId: row.providerId,
      capabilities: parseCapabilities(row.capabilities),
      offeringIds,
    })
    await replaceOfferingBindings(client, input.connectionId, offeringIds)
    await insertAudit(client, {
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "provider_connection.offerings_updated",
      targetId: input.connectionId,
      metadata: { offeringIds },
    })
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw sanitizeMutationError(error)
  } finally {
    client.release()
  }
}

export async function resolveProviderConnectionIdForOffering(input: {
  offeringId: string
  capabilityFamily: ProviderCapabilityFamily
}) {
  if (!isProviderCredentialVaultConfigured()) return undefined
  const result = await getPgPool().query<{ id: string }>(
    `
      select connection.id
      from provider_connection_offering binding
      join provider_connection connection on connection.id = binding.connection_id
      join provider_credential_version credential
        on credential.connection_id = connection.id and credential.status = 'active'
      left join provider_connection_health health
        on health.connection_id = connection.id
       and health.capability_family = $2
      where binding.model_offering_id = $1
        and binding.enabled = true
        and connection.status = 'active'
        and connection.capabilities ? $2
        and coalesce(health.status, 'unknown') <> 'unavailable'
      order by binding.priority, connection.priority, connection.created_at
      limit 1
    `,
    [input.offeringId, input.capabilityFamily]
  )
  return result.rows[0]?.id
}

export async function resolveProviderRuntimeConnection(input: {
  capabilityFamily: ProviderCapabilityFamily
  providerId?: string
  providerSlug?: string
  providerModelId?: string
  offeringId?: string
  connectionId?: string
}): Promise<ProviderRuntimeConnection | null> {
  if (!isProviderCredentialVaultConfigured()) {
    if (input.connectionId) {
      throw new ProviderConnectionError(
        "vault-not-configured",
        "The frozen provider connection cannot be opened because the credential vault is unavailable."
      )
    }
    return null
  }
  const values: Array<string> = [input.capabilityFamily]
  const conditions = [
    "connection.status = 'active'",
    "provider.status = 'active'",
    "connection.capabilities ? $1",
    "credential.status = 'active'",
    "coalesce(health.status, 'unknown') <> 'unavailable'",
  ]
  if (input.connectionId) {
    values.push(input.connectionId)
    conditions.push(`connection.id = $${values.length}`)
  }
  if (input.providerId) {
    values.push(input.providerId)
    conditions.push(`provider.id = $${values.length}`)
  }
  if (input.providerSlug) {
    values.push(input.providerSlug)
    conditions.push(`provider.slug = $${values.length}`)
  }
  if (input.providerModelId) {
    values.push(input.providerModelId)
    conditions.push(
      `(jsonb_array_length(connection.model_allowlist) = 0 or connection.model_allowlist ? $${values.length})`
    )
  }
  if (input.offeringId) {
    values.push(input.offeringId)
    conditions.push(`binding.model_offering_id = $${values.length}`)
    conditions.push("binding.enabled = true")
  }
  const result = await getPgPool().query<RuntimeConnectionRow>(
    `
      select
        connection.id,
        connection.provider_id as "providerId",
        provider.slug as "providerSlug",
        connection.base_url as "baseUrl",
        credential.id as "credentialId",
        credential.encrypted_secret as "encryptedSecret",
        credential.nonce,
        credential.auth_tag as "authTag",
        credential.algorithm,
        credential.key_id as "keyId",
        credential.secret_hint as "secretHint"
      from provider_connection connection
      join model_provider provider on provider.id = connection.provider_id
      join provider_credential_version credential
        on credential.connection_id = connection.id
      left join provider_connection_health health
        on health.connection_id = connection.id
       and health.capability_family = $1
      ${input.offeringId ? "join provider_connection_offering binding on binding.connection_id = connection.id" : "left join provider_connection_offering binding on false"}
      where ${conditions.join(" and ")}
      order by coalesce(binding.priority, 100), connection.priority, credential.created_at desc
      limit 1
    `,
    values
  )
  const row = result.rows[0]
  if (!row) {
    if (input.connectionId) {
      throw new ProviderConnectionError(
        "connection-unavailable",
        "The frozen provider connection is unavailable."
      )
    }
    return null
  }
  const apiKey = openProviderCredential({
    id: row.credentialId,
    connectionId: row.id,
    encryptedSecret: row.encryptedSecret,
    nonce: row.nonce,
    authTag: row.authTag,
    algorithm: row.algorithm,
    keyId: row.keyId,
    secretHint: row.secretHint,
  } satisfies StoredProviderCredential)
  return {
    id: row.id,
    providerId: row.providerId,
    providerSlug: row.providerSlug,
    apiKey,
    ...(row.baseUrl ? { baseURL: normalizeProviderBaseUrl(row.baseUrl)! } : {}),
    source: "credential-vault",
  }
}

export async function checkProviderConnectionHealth(input: {
  connectionId: string
  actorUserId: string
  actorEmail: string
}) {
  const connection = await readConnectionForHealth(input.connectionId)
  const credential = openProviderCredential({
    id: connection.credentialId,
    connectionId: connection.id,
    encryptedSecret: connection.encryptedSecret,
    nonce: connection.nonce,
    authTag: connection.authTag,
    algorithm: connection.algorithm,
    keyId: connection.keyId,
    secretHint: connection.secretHint,
  })
  const results = []
  for (const capability of parseCapabilities(connection.capabilities)) {
    const modelId = connection.models.find(
      (candidate) => candidate.capabilityFamily === capability
    )?.providerModelId
    results.push(
      await probeProvider({
        providerSlug: connection.providerSlug,
        baseUrl: connection.baseUrl,
        apiKey: credential,
        modelId,
        capability,
      })
    )
  }
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    for (const result of results) {
      await client.query(
        `
          insert into provider_connection_health (
            connection_id, capability_family, status, http_status, latency_ms,
            result_code, checked_at, last_success_at
          ) values ($1, $2, $3, $4, $5, $6, now(), $7)
          on conflict (connection_id, capability_family) do update set
            status = excluded.status,
            http_status = excluded.http_status,
            latency_ms = excluded.latency_ms,
            result_code = excluded.result_code,
            checked_at = excluded.checked_at,
            last_success_at = case
              when excluded.status = 'healthy' then excluded.checked_at
              else provider_connection_health.last_success_at
            end
        `,
        [
          input.connectionId,
          result.capability,
          result.status,
          result.httpStatus,
          result.latencyMs,
          result.resultCode,
          result.status === "healthy" ? new Date() : null,
        ]
      )
    }
    await insertAudit(client, {
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "provider_connection.health_checked",
      targetId: input.connectionId,
      metadata: {
        results: results.map(
          ({ capability, status, httpStatus, resultCode }) => ({
            capability,
            status,
            httpStatus,
            resultCode,
          })
        ),
      },
    })
    await client.query("commit")
    return results
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw sanitizeMutationError(error)
  } finally {
    client.release()
  }
}

async function readConnectionForHealth(connectionId: string) {
  const result = await getPgPool().query<HealthConnectionRow>(
    `
      select
        connection.id,
        provider.slug as "providerSlug",
        connection.base_url as "baseUrl",
        connection.capabilities,
        credential.id as "credentialId",
        credential.encrypted_secret as "encryptedSecret",
        credential.nonce,
        credential.auth_tag as "authTag",
        credential.algorithm,
        credential.key_id as "keyId",
        credential.secret_hint as "secretHint",
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'providerModelId', offering.provider_model_id,
              'capabilityFamily', offering.capability_family
            )
          ) filter (where offering.id is not null),
          '[]'::jsonb
        ) as models
      from provider_connection connection
      join model_provider provider on provider.id = connection.provider_id
      join provider_credential_version credential
        on credential.connection_id = connection.id and credential.status = 'active'
      left join provider_connection_offering binding
        on binding.connection_id = connection.id and binding.enabled = true
      left join model_offering offering on offering.id = binding.model_offering_id
      where connection.id = $1
      group by connection.id, provider.slug, credential.id
    `,
    [connectionId]
  )
  const row = result.rows[0]
  if (!row) {
    throw new ProviderConnectionError(
      "connection-unavailable",
      "The provider connection or active credential is unavailable."
    )
  }
  return { ...row, models: parseHealthModels(row.models) }
}

async function probeProvider(input: {
  providerSlug: string
  baseUrl: string | null
  apiKey: string
  modelId?: string
  capability: ProviderCapabilityFamily
}) {
  const baseUrl = input.baseUrl || defaultProviderBaseUrl(input.providerSlug)
  if (!baseUrl) {
    return {
      capability: input.capability,
      status: "unavailable" as const,
      httpStatus: null,
      latencyMs: 0,
      resultCode: "base_url_required",
    }
  }
  const safeBaseUrl = input.baseUrl
    ? normalizeProviderBaseUrl(input.baseUrl)
    : baseUrl
  const url = new URL(
    input.modelId ? `models/${encodeURIComponent(input.modelId)}` : "models",
    ensureTrailingSlash(safeBaseUrl!)
  )
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${input.apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
    return classifyProbeResponse(
      input.capability,
      response.status,
      Date.now() - startedAt
    )
  } catch {
    return {
      capability: input.capability,
      status: "degraded" as const,
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      resultCode: "network_error",
    }
  }
}

export function classifyProbeResponse(
  capability: ProviderCapabilityFamily,
  httpStatus: number,
  latencyMs: number
) {
  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      capability,
      status: "healthy" as const,
      httpStatus,
      latencyMs,
      resultCode: "ok",
    }
  }
  if (httpStatus === 429) {
    return {
      capability,
      status: "degraded" as const,
      httpStatus,
      latencyMs,
      resultCode: "rate_limited",
    }
  }
  if (httpStatus >= 500) {
    return {
      capability,
      status: "degraded" as const,
      httpStatus,
      latencyMs,
      resultCode: "provider_unavailable",
    }
  }
  return {
    capability,
    status: "unavailable" as const,
    httpStatus,
    latencyMs,
    resultCode:
      httpStatus === 401 || httpStatus === 403
        ? "credential_rejected"
        : httpStatus === 404
          ? "model_not_found"
          : "provider_rejected",
  }
}

function defaultProviderBaseUrl(providerSlug: string) {
  return providerSlug === "openai" ? "https://api.openai.com/v1/" : null
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`
}

async function assertProviderAndOfferings(
  client: PoolClient,
  input: {
    providerId: string
    capabilities: readonly ProviderCapabilityFamily[]
    offeringIds: readonly string[]
  }
) {
  const provider = await client.query(
    `select id from model_provider where id = $1`,
    [input.providerId]
  )
  if (!provider.rowCount) {
    throw new ProviderConnectionError(
      "provider-unavailable",
      "The selected provider does not exist."
    )
  }
  if (input.offeringIds.length === 0) return
  const offerings = await client.query<{
    id: string
    providerId: string
    capabilityFamily: string
  }>(
    `
      select
        id,
        provider_id as "providerId",
        capability_family as "capabilityFamily"
      from model_offering
      where id = any($1::text[])
    `,
    [input.offeringIds]
  )
  if (
    offerings.rows.length !== input.offeringIds.length ||
    offerings.rows.some(
      (row) =>
        row.providerId !== input.providerId ||
        !input.capabilities.includes(parseCapability(row.capabilityFamily))
    )
  ) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "Each bound model must belong to the provider and a declared capability."
    )
  }
}

async function replaceOfferingBindings(
  client: PoolClient,
  connectionId: string,
  offeringIds: readonly string[]
) {
  await client.query(
    `delete from provider_connection_offering where connection_id = $1`,
    [connectionId]
  )
  for (const offeringId of offeringIds) {
    await client.query(
      `
        insert into provider_connection_offering (connection_id, model_offering_id)
        values ($1, $2)
      `,
      [connectionId, offeringId]
    )
  }
}

async function insertCredential(
  client: PoolClient,
  input: {
    credentialId: string
    connectionId: string
    actorUserId: string
    sealed: ReturnType<typeof sealProviderCredential>
  }
) {
  await client.query(
    `
      insert into provider_credential_version (
        id, connection_id, encrypted_secret, nonce, auth_tag, algorithm,
        key_id, secret_hint, created_by_user_id
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      input.credentialId,
      input.connectionId,
      input.sealed.encryptedSecret,
      input.sealed.nonce,
      input.sealed.authTag,
      input.sealed.algorithm,
      input.sealed.keyId,
      input.sealed.secretHint,
      input.actorUserId,
    ]
  )
}

async function insertAudit(
  client: PoolClient,
  input: {
    actorUserId: string
    actorEmail: string
    action: string
    targetId: string
    metadata: Record<string, unknown>
  }
) {
  await client.query(
    `
      insert into audit_log (
        id, actor_user_id, actor_email, action, target_type, target_id, metadata
      ) values ($1, $2, $3, $4, 'provider_connection', $5, $6::jsonb)
    `,
    [
      prefixedId("audit"),
      input.actorUserId,
      input.actorEmail,
      input.action,
      input.targetId,
      JSON.stringify(input.metadata),
    ]
  )
}

function normalizedName(value: string) {
  const name = value.trim()
  if (name.length < 2 || name.length > 80) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "A provider connection name must contain between 2 and 80 characters."
    )
  }
  return name
}

export function normalizeProviderBaseUrl(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) return null
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider base URL is invalid."
    )
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider base URL cannot contain credentials, query parameters, or a fragment."
    )
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider base URL must use HTTP or HTTPS."
    )
  }
  const production = process.env.NODE_ENV === "production"
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  const localDevelopment = local && !production
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && localDevelopment) &&
    process.env.MUSES_ALLOW_INSECURE_PROVIDER_URLS !== "true"
  ) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "Provider connections require HTTPS unless an explicit development override is enabled."
    )
  }
  if (
    production &&
    !providerAllowedHosts().has(url.hostname.toLowerCase())
  ) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider host is not included in MUSES_PROVIDER_ALLOWED_HOSTS."
    )
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/"
  return url.toString().replace(/\/$/, "")
}

function providerAllowedHosts() {
  return new Set(
    (process.env.MUSES_PROVIDER_ALLOWED_HOSTS || "api.openai.com")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )
}

function normalizeCapabilities(values: readonly string[]) {
  const capabilities = [...new Set(values.map((value) => value.trim()))]
  if (
    capabilities.length === 0 ||
    capabilities.some(
      (value) =>
        !PROVIDER_CAPABILITY_FAMILIES.includes(
          value as ProviderCapabilityFamily
        )
    )
  ) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "At least one supported provider capability is required."
    )
  }
  return capabilities as ProviderCapabilityFamily[]
}

function normalizeModelAllowlist(values: readonly string[]) {
  const models = values
    .flatMap((value) => value.split(/[\n,]/))
    .map((value) => value.trim())
    .filter(Boolean)
  if (models.some((model) => model.length > 160)) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "A provider model id is too long."
    )
  }
  return [...new Set(models)]
}

function uniqueIds(values: readonly string[]) {
  const ids = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (ids.some((id) => !/^[a-zA-Z0-9._-]{1,160}$/.test(id))) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "A model offering id is invalid."
    )
  }
  return ids
}

function parseCapabilities(value: unknown) {
  const values = parseStringArray(value)
  if (
    values.length === 0 ||
    values.some(
      (item) =>
        !PROVIDER_CAPABILITY_FAMILIES.includes(item as ProviderCapabilityFamily)
    )
  ) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider connection capabilities are invalid."
    )
  }
  return values as ProviderCapabilityFamily[]
}

function parseCapability(value: string) {
  if (
    !PROVIDER_CAPABILITY_FAMILIES.includes(value as ProviderCapabilityFamily)
  ) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider capability family is invalid."
    )
  }
  return value as ProviderCapabilityFamily
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider connection list is invalid."
    )
  }
  return value
}

function parseConnectionStatus(value: string) {
  if (value !== "active" && value !== "disabled") {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider connection status is invalid."
    )
  }
  return value
}

function parseHealthStatus(value: string) {
  if (
    value !== "unknown" &&
    value !== "healthy" &&
    value !== "degraded" &&
    value !== "unavailable"
  ) {
    throw new ProviderConnectionError(
      "connection-invalid",
      "The provider health status is invalid."
    )
  }
  return value
}

function parseHealthModels(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const candidate = item as Record<string, unknown>
    if (
      typeof candidate.providerModelId !== "string" ||
      typeof candidate.capabilityFamily !== "string"
    ) {
      return []
    }
    return [
      {
        providerModelId: candidate.providerModelId,
        capabilityFamily: parseCapability(candidate.capabilityFamily),
      },
    ]
  })
}

function groupRowsByConnection<T extends { connectionId: string }>(rows: T[]) {
  const result = new Map<string, T[]>()
  for (const row of rows) {
    const values = result.get(row.connectionId) || []
    values.push(row)
    result.set(row.connectionId, values)
  }
  return result
}

function groupFieldByConnection<
  T extends { connectionId: string },
  K extends keyof T,
>(rows: T[], field: K) {
  const result = new Map<string, T[K][]>()
  for (const row of rows) {
    const values = result.get(row.connectionId) || []
    values.push(row[field])
    result.set(row.connectionId, values)
  }
  return result
}

function toIso(value: Date | string) {
  return new Date(value).toISOString()
}

function prefixedId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`
}

function sanitizeMutationError(error: unknown) {
  if (error instanceof ProviderConnectionError) return error
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  ) {
    return new ProviderConnectionError(
      "connection-invalid",
      "A provider connection with this name already exists."
    )
  }
  return error
}

type ProviderRow = { id: string; slug: string; displayName: string }
type OfferingRow = {
  id: string
  providerId: string
  displayName: string
  modelRef: string
  capabilityFamily: string
}
type ConnectionRow = {
  id: string
  providerId: string
  providerSlug: string
  providerDisplayName: string
  name: string
  baseUrl: string | null
  status: string
  capabilities: unknown
  modelAllowlist: unknown
  priority: number
  createdAt: Date | string
  updatedAt: Date | string
}
type CredentialMetadataRow = {
  id: string
  connectionId: string
  secretHint: string
  keyId: string
  createdAt: Date | string
}
type HealthRow = {
  connectionId: string
  capability: string
  status: string
  httpStatus: number | null
  latencyMs: number | null
  resultCode: string | null
  checkedAt: Date | string | null
  lastSuccessAt: Date | string | null
}
type RuntimeConnectionRow = {
  id: string
  providerId: string
  providerSlug: string
  baseUrl: string | null
  credentialId: string
  encryptedSecret: string
  nonce: string
  authTag: string
  algorithm: "aes-256-gcm"
  keyId: string
  secretHint: string
}
type HealthConnectionRow = RuntimeConnectionRow & {
  capabilities: unknown
  models: unknown
}
