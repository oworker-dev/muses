import { describe, expect, it } from "vitest"

import { readMusesAgentRuntimeConfig } from "./muses-agent-runtime-config"

describe("Muses Open Agent runtime config", () => {
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
    const config = readMusesAgentRuntimeConfig({}, {
      profileId: "general-purpose",
      profileVersion: "0.1.0",
    })
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
      }),
    ).toThrow(/muses-platform/)

    expect(() =>
      readMusesAgentRuntimeConfig(
        { MUSES_AGENT_RUNTIME_CONFIG_JSON: JSON.stringify(config) },
        { profileId: "general-purpose", profileVersion: "0.1.0" },
      ),
    ).toThrow(/general-purpose/)
  })
})
