import { afterEach, describe, expect, it, vi } from "vitest"

import {
  classifyProbeResponse,
  normalizeProviderBaseUrl,
  resolveProviderRuntimeConnection,
} from "./provider-connections"

afterEach(() => vi.unstubAllEnvs())

describe("provider connection health classification", () => {
  it("keeps successful capability probes routable", () => {
    expect(classifyProbeResponse("image", 200, 42)).toEqual({
      capability: "image",
      status: "healthy",
      httpStatus: 200,
      latencyMs: 42,
      resultCode: "ok",
    })
  })

  it("distinguishes auth rejection from temporary provider failures", () => {
    expect(classifyProbeResponse("llm", 401, 20).status).toBe("unavailable")
    expect(classifyProbeResponse("llm", 401, 20).resultCode).toBe(
      "credential_rejected"
    )
    expect(classifyProbeResponse("llm", 429, 20).status).toBe("degraded")
    expect(classifyProbeResponse("llm", 503, 20).status).toBe("degraded")
  })

  it("fails closed when a frozen connection cannot access the vault", async () => {
    vi.stubEnv("MUSES_CREDENTIAL_MASTER_KEY", "")
    await expect(
      resolveProviderRuntimeConnection({
        capabilityFamily: "image",
        connectionId: "provider_connection_frozen",
      })
    ).rejects.toMatchObject({ code: "vault-not-configured" })
  })
})

describe("provider connection URL policy", () => {
  it("allows loopback HTTP only outside production", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(normalizeProviderBaseUrl("http://127.0.0.1:4000/v1")).toBe(
      "http://127.0.0.1:4000/v1"
    )

    vi.stubEnv("NODE_ENV", "production")
    expect(() =>
      normalizeProviderBaseUrl("http://127.0.0.1:4000/v1")
    ).toThrow("Provider connections require HTTPS")
  })

  it("requires every production host to be explicitly allowed", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MUSES_PROVIDER_ALLOWED_HOSTS", "provider.example")

    expect(normalizeProviderBaseUrl("https://provider.example/v1")).toBe(
      "https://provider.example/v1"
    )
    expect(() =>
      normalizeProviderBaseUrl("https://127.0.0.1:4443/v1")
    ).toThrow("MUSES_PROVIDER_ALLOWED_HOSTS")
  })
})
