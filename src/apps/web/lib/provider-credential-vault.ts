import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm" as const
const NONCE_BYTES = 12
const KEY_BYTES = 32

type CredentialVaultEnv = Readonly<Record<string, string | undefined>>

export type SealedProviderCredential = {
  encryptedSecret: string
  nonce: string
  authTag: string
  algorithm: typeof ALGORITHM
  keyId: string
  secretHint: string
}

export type StoredProviderCredential = SealedProviderCredential & {
  id: string
  connectionId: string
}

export function isProviderCredentialVaultConfigured(
  env: CredentialVaultEnv = process.env
) {
  return Boolean(env.MUSES_CREDENTIAL_MASTER_KEY?.trim())
}

export function sealProviderCredential(
  input: {
    credentialId: string
    connectionId: string
    secret: string
  },
  env: CredentialVaultEnv = process.env
): SealedProviderCredential {
  const secret = normalizeSecret(input.secret)
  const { key, keyId } = readKey(env)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  cipher.setAAD(aad(input.credentialId, input.connectionId, keyId))
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ])
  return {
    encryptedSecret: encrypted.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    algorithm: ALGORITHM,
    keyId,
    secretHint: secret.slice(-4),
  }
}

export function openProviderCredential(
  credential: StoredProviderCredential,
  env: CredentialVaultEnv = process.env
) {
  if (credential.algorithm !== ALGORITHM) {
    throw new Error(
      "The provider credential encryption algorithm is unsupported."
    )
  }
  const { key, keyId } = readKey(env)
  if (credential.keyId !== keyId) {
    throw new Error(
      "The provider credential was encrypted with a different master key."
    )
  }
  const nonce = decodeExactBase64(credential.nonce, NONCE_BYTES, "nonce")
  const authTag = decodeExactBase64(
    credential.authTag,
    16,
    "authentication tag"
  )
  const encrypted = decodeBase64(
    credential.encryptedSecret,
    "encrypted provider credential"
  )
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce)
    decipher.setAAD(aad(credential.id, credential.connectionId, keyId))
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new Error("The provider credential could not be authenticated.")
  }
}

function readKey(env: CredentialVaultEnv) {
  const encoded = env.MUSES_CREDENTIAL_MASTER_KEY?.trim()
  if (!encoded) {
    throw new Error("MUSES_CREDENTIAL_MASTER_KEY is required.")
  }
  const key = decodeExactBase64(encoded, KEY_BYTES, "master key")
  const keyId = (env.MUSES_CREDENTIAL_MASTER_KEY_ID || "primary-v1").trim()
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(keyId)) {
    throw new Error("MUSES_CREDENTIAL_MASTER_KEY_ID is invalid.")
  }
  return { key, keyId }
}

function normalizeSecret(value: string) {
  const secret = value.trim()
  if (secret.length < 8 || secret.length > 8192) {
    throw new Error(
      "A provider credential must contain between 8 and 8192 characters."
    )
  }
  if (/[\u0000-\u001f\u007f]/.test(secret)) {
    throw new Error("A provider credential cannot contain control characters.")
  }
  return secret
}

function aad(credentialId: string, connectionId: string, keyId: string) {
  return Buffer.from(
    `muses-provider-credential-v1:${credentialId}:${connectionId}:${keyId}`,
    "utf8"
  )
}

function decodeExactBase64(value: string, bytes: number, label: string) {
  const decoded = decodeBase64(value, label)
  if (decoded.length !== bytes) {
    throw new Error(
      `The provider credential ${label} must contain ${bytes} bytes.`
    )
  }
  return decoded
}

function decodeBase64(value: string, label: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`The provider credential ${label} is not valid base64.`)
  }
  return Buffer.from(value, "base64")
}
