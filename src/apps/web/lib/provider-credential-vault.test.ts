import { describe, expect, it } from "vitest"

import {
  isProviderCredentialVaultConfigured,
  openProviderCredential,
  sealProviderCredential,
} from "./provider-credential-vault"

const env = {
  MUSES_CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  MUSES_CREDENTIAL_MASTER_KEY_ID: "test-v1",
}

describe("provider credential vault", () => {
  it("round-trips a credential without storing plaintext", () => {
    const sealed = sealProviderCredential(
      {
        credentialId: "credential_1",
        connectionId: "connection_1",
        secret: "provider-secret-value",
      },
      env
    )
    expect(sealed.encryptedSecret).not.toContain("provider-secret-value")
    expect(sealed.secretHint).toBe("alue")
    expect(
      openProviderCredential(
        {
          id: "credential_1",
          connectionId: "connection_1",
          ...sealed,
        },
        env
      )
    ).toBe("provider-secret-value")
  })

  it("binds ciphertext to the credential and connection identity", () => {
    const sealed = sealProviderCredential(
      {
        credentialId: "credential_1",
        connectionId: "connection_1",
        secret: "provider-secret-value",
      },
      env
    )
    expect(() =>
      openProviderCredential(
        {
          id: "credential_1",
          connectionId: "connection_2",
          ...sealed,
        },
        env
      )
    ).toThrow(/could not be authenticated/)
  })

  it("rejects missing, malformed, and mismatched master keys", () => {
    expect(isProviderCredentialVaultConfigured({})).toBe(false)
    expect(() =>
      sealProviderCredential(
        {
          credentialId: "credential_1",
          connectionId: "connection_1",
          secret: "provider-secret-value",
        },
        { MUSES_CREDENTIAL_MASTER_KEY: "not-base64" }
      )
    ).toThrow(/base64/)

    const sealed = sealProviderCredential(
      {
        credentialId: "credential_1",
        connectionId: "connection_1",
        secret: "provider-secret-value",
      },
      env
    )
    expect(() =>
      openProviderCredential(
        {
          id: "credential_1",
          connectionId: "connection_1",
          ...sealed,
        },
        { ...env, MUSES_CREDENTIAL_MASTER_KEY_ID: "test-v2" }
      )
    ).toThrow(/different master key/)
  })
})
