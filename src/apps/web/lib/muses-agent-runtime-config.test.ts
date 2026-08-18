import { beforeEach, describe, expect, it, vi } from "vitest"

const database = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("./database", () => ({ getPgPool: () => database }))

import {
  getMusesAgentRuntimeConfig,
  readMusesAgentRuntimeConfig,
} from "./muses-agent-runtime-config"

describe("Muses Open Agent runtime config", () => {
  beforeEach(() => database.query.mockReset())

  it("publishes the Muses profile without credentials", () => {
    const config = readMusesAgentRuntimeConfig({})
    expect(config.profile).toMatchObject({
      id: "muses-platform",
      version: "0.1.0",
    })
    expect(config.models.length).toBeGreaterThan(0)
    expect(JSON.stringify(config)).not.toMatch(/api[_-]?key|secret|credential/i)
  })

  it("accepts a host-managed model catalog while keeping the Muses profile", () => {
    const config = readMusesAgentRuntimeConfig({
      MUSES_AGENT_MODELS_JSON: JSON.stringify([
        { id: "openai/gpt-5@2026", providerModelId: "gpt-5", label: "GPT-5" },
      ]),
      MUSES_AGENT_DEFAULT_MODEL_ID: "openai/gpt-5@2026",
    })
    expect(config.defaultModelId).toBe("openai/gpt-5@2026")
    expect(config.models[0]?.providerModelId).toBe("gpt-5")
  })

  it("publishes the requested workflow profile for Agent nodes", () => {
    const config = readMusesAgentRuntimeConfig(
      {},
      {
        profileId: "general-purpose",
        profileVersion: "0.1.0",
      }
    )
    expect(config.profile).toMatchObject({
      id: "general-purpose",
      version: "0.1.0",
    })
  })

  it("rejects an override that tries to publish a non-Muses profile", () => {
    const config = readMusesAgentRuntimeConfig({})
    expect(() =>
      readMusesAgentRuntimeConfig({
        MUSES_AGENT_RUNTIME_CONFIG_JSON: JSON.stringify({
          ...config,
          profile: {
            ...config.profile,
            id: "general-purpose",
          },
        }),
      })
    ).toThrow(/muses-platform/)

    expect(() =>
      readMusesAgentRuntimeConfig(
        { MUSES_AGENT_RUNTIME_CONFIG_JSON: JSON.stringify(config) },
        { profileId: "general-purpose", profileVersion: "0.1.0" }
      )
    ).toThrow(/general-purpose/)
  })

  it("publishes only an administrator-routable catalog model", async () => {
    database.query.mockResolvedValue({
      rows: [
        {
          modelRef: "openai/gpt-5.6-sol@2026-08-17",
          providerModelId: "gpt-5.6-sol",
          displayName: "GPT-5.6 Sol",
          specification: {
            kind: "language-model",
            contextWindowTokens: 256_000,
            maxOutputTokens: 16_384,
            reasoningLevels: ["low", "medium", "high"],
            defaultReasoning: "medium",
          },
        },
      ],
    })

    const config = await getMusesAgentRuntimeConfig({ NODE_ENV: "production" })

    expect(config.models[0]).toMatchObject({
      id: "openai/gpt-5.6-sol@2026-08-17",
      contextWindowTokens: 256_000,
      defaultReasoning: "medium",
    })
    const sql = database.query.mock.calls[0]?.[0] as string
    expect(sql).toContain(
      "connection.model_allowlist ? offering.provider_model_id"
    )
    expect(sql).toContain("candidate.capability_id = 'llm.responses.v1'")
  })

  it("fails closed in production when no administrator runtime is available", async () => {
    database.query.mockResolvedValue({ rows: [] })

    await expect(
      getMusesAgentRuntimeConfig({ NODE_ENV: "production" })
    ).rejects.toThrow(/administrator-managed LLM runtime/)
  })
})
