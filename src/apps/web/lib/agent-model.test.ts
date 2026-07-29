import { APICallError, type generateText } from "ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AgentRunSnapshot } from "@muses/agent-core"

import { AiSdkAgentModel } from "./agent-model"
import type {
  AgentModelCallClaim,
  AgentModelCallCompletion,
  AgentModelCallStore,
} from "./agent-model-call-store"

describe("AiSdkAgentModel durable receipts", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-sent")
    vi.stubEnv("MUSES_AGENT_INPUT_CREDIT_MICROS_PER_MILLION", "1000000")
    vi.stubEnv("MUSES_AGENT_OUTPUT_CREDIT_MICROS_PER_MILLION", "1000000")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("replays a completed receipt without another provider call", async () => {
    const replay = modelResult("persisted")
    const calls = new FixtureCallStore({ state: "replayed", result: replay })
    const generate = vi.fn()
    const model = new AiSdkAgentModel(calls, asGenerate(generate))

    await expect(model.complete(modelInput())).resolves.toEqual(replay)
    expect(generate).not.toHaveBeenCalled()
    expect(calls.beginCalls).toBe(0)
  })

  it("claims, calls, persists and settles before returning a provider result", async () => {
    const calls = new FixtureCallStore(claimed())
    const generate = vi.fn(async () => providerResult())
    const model = new AiSdkAgentModel(calls, asGenerate(generate))

    const result = await model.complete(modelInput())

    expect(result).toMatchObject({
      content: "provider result",
      usage: { inputTokens: 7, outputTokens: 3, creditMicros: "10" },
    })
    expect(generate).toHaveBeenCalledOnce()
    expect(calls.beginCalls).toBe(1)
    expect(calls.completeCalls).toBe(1)
    expect(calls.lastProviderRequestId).toBe("provider-request-1")
  })

  it("defers an active duplicate to driver recovery without a provider call", async () => {
    const calls = new FixtureCallStore({ state: "in-progress" })
    const generate = vi.fn()
    const model = new AiSdkAgentModel(calls, asGenerate(generate))

    await expect(model.complete(modelInput())).rejects.toMatchObject({
      code: "model-call-in-progress",
      runtimeAction: "retry-driver",
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it("releases a new reservation when the provider is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "")
    const calls = new FixtureCallStore(claimed())
    const generate = vi.fn()
    const model = new AiSdkAgentModel(calls, asGenerate(generate))

    await expect(model.complete(modelInput())).rejects.toMatchObject({
      code: "model-provider-not-configured",
      retryable: false,
    })
    expect(calls.failCalls).toBe(1)
    expect(calls.lastFailureCode).toBe("model-provider-not-configured")
    expect(generate).not.toHaveBeenCalled()
  })

  it("releases a reservation once for a definite provider rejection", async () => {
    const calls = new FixtureCallStore(claimed())
    const generate = vi.fn(async () => {
      throw new APICallError({
        message: "invalid request",
        url: "https://api.openai.com/v1/responses",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "x-request-id": "request-rejected" },
      })
    })
    const model = new AiSdkAgentModel(calls, asGenerate(generate))

    await expect(model.complete(modelInput())).rejects.toMatchObject({
      code: "model-provider-rejected",
      retryable: false,
    })
    expect(calls.failCalls).toBe(1)
    expect(calls.ambiguousCalls).toBe(0)
    expect(calls.lastFailureCode).toBe("provider-http-400")
    expect(calls.lastProviderRequestId).toBe("request-rejected")
  })

  it("retains the reservation and blocks automatic retry for an unknown outcome", async () => {
    const calls = new FixtureCallStore(claimed())
    const generate = vi.fn(async () => {
      throw new Error("network disconnected after request send")
    })
    const model = new AiSdkAgentModel(calls, asGenerate(generate))

    await expect(model.complete(modelInput())).rejects.toMatchObject({
      code: "model-call-review-required",
      retryable: false,
      runtimeAction: "fail-run",
    })
    expect(calls.ambiguousCalls).toBe(1)
    expect(calls.failCalls).toBe(0)
    expect(calls.completeCalls).toBe(0)
  })

  it("treats an HTTP timeout as an ambiguous provider outcome", async () => {
    const calls = new FixtureCallStore(claimed())
    const generate = vi.fn(async () => {
      throw new APICallError({
        message: "request timed out",
        url: "https://api.openai.com/v1/responses",
        requestBodyValues: {},
        statusCode: 408,
      })
    })
    const model = new AiSdkAgentModel(calls, asGenerate(generate))

    await expect(model.complete(modelInput())).rejects.toMatchObject({
      code: "model-call-review-required",
      retryable: false,
    })
    expect(calls.ambiguousCalls).toBe(1)
    expect(calls.failCalls).toBe(0)
  })

  it("fails closed when actual usage exceeds the persisted reservation", async () => {
    const calls = new FixtureCallStore(claimed())
    calls.completion = { state: "review-required" }
    const model = new AiSdkAgentModel(
      calls,
      asGenerate(vi.fn(async () => providerResult()))
    )

    await expect(model.complete(modelInput())).rejects.toMatchObject({
      code: "model-call-review-required",
      retryable: false,
    })
    expect(calls.completeCalls).toBe(1)
  })

  it("uses a conservative UTF-8 input estimate and remaining output cap", () => {
    const model = new AiSdkAgentModel(new FixtureCallStore(claimed()), asGenerate(vi.fn()))
    const input = modelInput()
    const estimate = model.estimate({
      callId: input.callId,
      run: input.run,
      messages: [
        {
          id: "message-cjk",
          role: "user",
          content: "生成一张高质量图片",
          createdAt: "2026-07-29T00:00:00.000Z",
        },
      ],
      tools: input.tools,
    })

    expect(estimate.inputTokens).toBeGreaterThan("生成一张高质量图片".length)
    expect(estimate.outputTokens).toBe(96)
    expect(estimate.creditMicros).toBe(
      String(estimate.inputTokens + estimate.outputTokens)
    )
  })
})

class FixtureCallStore implements AgentModelCallStore {
  beginCalls = 0
  completeCalls = 0
  failCalls = 0
  ambiguousCalls = 0
  completion: AgentModelCallCompletion = { state: "completed" }
  lastFailureCode?: string
  lastProviderRequestId?: string

  constructor(private readonly claimResult: AgentModelCallClaim) {}

  async claim() {
    return this.claimResult
  }

  async begin() {
    this.beginCalls += 1
  }

  async complete(input: Parameters<AgentModelCallStore["complete"]>[0]) {
    this.completeCalls += 1
    this.lastProviderRequestId = input.providerRequestId
    return this.completion
  }

  async failDefinitive(
    input: Parameters<AgentModelCallStore["failDefinitive"]>[0]
  ) {
    this.failCalls += 1
    this.lastFailureCode = input.failureCode
    this.lastProviderRequestId = input.providerRequestId
  }

  async markAmbiguous(
    input: Parameters<AgentModelCallStore["markAmbiguous"]>[0]
  ) {
    this.ambiguousCalls += 1
    this.lastFailureCode = input.failureCode
    this.lastProviderRequestId = input.providerRequestId
  }
}

function claimed(): AgentModelCallClaim {
  return { state: "claimed", attemptId: "attempt-1" }
}

function modelInput() {
  const run = {
    runId: "agent-run-1",
    turn: 0,
    context: {
      version: 1,
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "Create an image",
          createdAt: "2026-07-29T00:00:00.000Z",
        },
      ],
      artifactRefs: [],
      createdAt: "2026-07-29T00:00:00.000Z",
    },
    profile: { modelRef: "openai/gpt-5.6-sol" },
    budget: {
      limit: { maxOutputTokens: 100 },
      usage: { outputTokens: 4 },
    },
  } as unknown as AgentRunSnapshot
  return {
    callId: "agent-run-1:model:1:context:1",
    run,
    messages: [
      {
        id: "message-1",
        role: "user" as const,
        content: "Create an image",
        createdAt: "2026-07-29T00:00:00.000Z",
      },
    ],
    tools: [],
    estimate: { inputTokens: 100, outputTokens: 96, creditMicros: "196" },
  }
}

function modelResult(content: string) {
  return {
    content,
    finishReason: "stop" as const,
    toolCalls: [],
    usage: { inputTokens: 7, outputTokens: 3, creditMicros: "10" },
  }
}

function providerResult() {
  return {
    text: "provider result",
    toolCalls: [],
    usage: { inputTokens: 7, outputTokens: 3 },
    response: { id: "provider-request-1" },
  }
}

function asGenerate(value: unknown) {
  return value as typeof generateText
}
