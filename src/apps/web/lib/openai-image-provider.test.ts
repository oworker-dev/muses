import { APICallError } from "ai"
import { describe, expect, it } from "vitest"

import {
  isDefinitiveImageProviderRejection,
  resolveOpenAiImageProviderConfig,
} from "./openai-image-provider"

describe("OpenAI image provider configuration", () => {
  it("uses an explicit image provider without inheriting the shared endpoint", () => {
    expect(
      resolveOpenAiImageProviderConfig({
        OPENAI_API_KEY: "shared-key",
        OPENAI_BASE_URL: "https://shared.example/v1",
        OPENAI_IMAGE_API_KEY: "image-key",
      })
    ).toEqual({ apiKey: "image-key" })
  })

  it("uses the shared provider when no image-specific provider is configured", () => {
    expect(
      resolveOpenAiImageProviderConfig({
        OPENAI_API_KEY: "shared-key",
        OPENAI_BASE_URL: "https://shared.example/v1",
      })
    ).toEqual({
      apiKey: "shared-key",
      baseURL: "https://shared.example/v1",
    })
  })

  it("rejects an image endpoint without an explicit image key", () => {
    expect(() =>
      resolveOpenAiImageProviderConfig({
        OPENAI_API_KEY: "shared-key",
        OPENAI_IMAGE_BASE_URL: "https://images.example/v1",
      })
    ).toThrow(/requires OPENAI_IMAGE_API_KEY/)
  })
})

describe("OpenAI image provider failure classification", () => {
  it("treats ordinary 4xx rejections as definitive", () => {
    expect(
      isDefinitiveImageProviderRejection(providerError(400, "invalid_value"))
    ).toBe(true)
  })

  it("keeps rate limits and unknown server failures reviewable", () => {
    expect(
      isDefinitiveImageProviderRejection(providerError(429, "rate_limit"))
    ).toBe(false)
    expect(
      isDefinitiveImageProviderRejection(providerError(503, "upstream_error"))
    ).toBe(false)
  })

  it("recognizes a model_not_found rejection even when a gateway returns 503", () => {
    expect(
      isDefinitiveImageProviderRejection(providerError(503, "model_not_found"))
    ).toBe(true)
  })
})

function providerError(statusCode: number, code: string) {
  return new APICallError({
    message: "provider rejected request",
    url: "https://provider.invalid/images/generations",
    requestBodyValues: {},
    statusCode,
    data: { error: { code } },
  })
}
