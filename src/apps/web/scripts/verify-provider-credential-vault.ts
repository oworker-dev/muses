import { Buffer } from "node:buffer"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required.")
const database = new URL(databaseUrl)
if (database.hostname !== "127.0.0.1" && database.hostname !== "localhost") {
  throw new Error(
    "Provider credential verification only runs against local PostgreSQL."
  )
}

process.env.MUSES_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 23).toString(
  "base64"
)
process.env.MUSES_CREDENTIAL_MASTER_KEY_ID = "verification-v1"

const {
  createProviderConnection,
  getAdminProviderControlPlane,
  resolveProviderConnectionIdForOffering,
  resolveProviderRuntimeConnection,
  rotateProviderCredential,
} = await import("../lib/provider-connections")
const { getPgPool } = await import("../lib/database")

const firstSecret = "verification-image-key-first"
const secondSecret = "verification-image-key-rotated"
let connectionId: string | undefined

try {
  const created = await createProviderConnection({
    providerId: "provider_openai",
    name: `Verification ${Date.now()}`,
    baseUrl: "https://api.openai.com/v1",
    credential: firstSecret,
    capabilities: ["image"],
    modelAllowlist: ["gpt-image-2"],
    offeringIds: ["offering_openai_gpt_image_2_20260728"],
    actorUserId: "provider-vault-verifier",
    actorEmail: "provider-vault-verifier@invalid.local",
  })
  connectionId = created.id

  const raw = await getPgPool().query<{
    encryptedSecret: string
    activeCredentials: string
  }>(
    `
      select
        max(encrypted_secret) as "encryptedSecret",
        count(*) filter (where status = 'active')::text as "activeCredentials"
      from provider_credential_version
      where connection_id = $1
    `,
    [connectionId]
  )
  if (
    !raw.rows[0]?.encryptedSecret ||
    raw.rows[0].encryptedSecret.includes(firstSecret) ||
    raw.rows[0].activeCredentials !== "1"
  ) {
    throw new Error(
      "The credential was not stored as one encrypted active version."
    )
  }

  const routeId = await resolveProviderConnectionIdForOffering({
    offeringId: "offering_openai_gpt_image_2_20260728",
    capabilityFamily: "image",
  })
  if (routeId !== connectionId) {
    throw new Error("The Offering did not resolve to its explicit connection.")
  }
  const runtime = await resolveProviderRuntimeConnection({
    capabilityFamily: "image",
    providerId: "provider_openai",
    providerModelId: "gpt-image-2",
    offeringId: "offering_openai_gpt_image_2_20260728",
    connectionId,
  })
  if (runtime?.apiKey !== firstSecret || runtime.id !== connectionId) {
    throw new Error(
      "The runtime could not open the frozen provider connection."
    )
  }

  await rotateProviderCredential({
    connectionId,
    credential: secondSecret,
    actorUserId: "provider-vault-verifier",
    actorEmail: "provider-vault-verifier@invalid.local",
  })
  const rotated = await resolveProviderRuntimeConnection({
    capabilityFamily: "image",
    providerId: "provider_openai",
    providerModelId: "gpt-image-2",
    offeringId: "offering_openai_gpt_image_2_20260728",
    connectionId,
  })
  if (rotated?.apiKey !== secondSecret) {
    throw new Error(
      "Credential rotation did not replace the active runtime key."
    )
  }

  const projection = await getAdminProviderControlPlane()
  const projected = projection.connections.find(
    (item) => item.id === connectionId
  )
  const serialized = JSON.stringify(projected)
  if (
    !projected ||
    projected.credential?.secretHint !== secondSecret.slice(-4) ||
    serialized.includes(firstSecret) ||
    serialized.includes(secondSecret) ||
    serialized.includes("encryptedSecret")
  ) {
    throw new Error(
      "The Admin projection exposed more than credential metadata."
    )
  }

  console.log("Provider Connection credential-vault verification passed.")
} finally {
  if (connectionId) {
    const client = await getPgPool().connect()
    try {
      await client.query("begin")
      await client.query(
        `delete from audit_log where target_type = 'provider_connection' and target_id = $1`,
        [connectionId]
      )
      await client.query(
        `delete from provider_connection_health where connection_id = $1`,
        [connectionId]
      )
      await client.query(
        `delete from provider_connection_offering where connection_id = $1`,
        [connectionId]
      )
      await client.query(
        `delete from provider_credential_version where connection_id = $1`,
        [connectionId]
      )
      await client.query(`delete from provider_connection where id = $1`, [
        connectionId,
      ])
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
  await getPgPool().end()
}
