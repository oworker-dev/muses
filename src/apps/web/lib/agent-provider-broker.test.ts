import { describe, expect, it, vi } from "vitest"

import {
  AGENT_PROVIDER_BROKER_MAX_BODY_BYTES,
  handleAgentProviderResponsesRequest,
} from "./agent-provider-broker"

const brokerSecret = "broker-secret-that-is-at-least-thirty-two-bytes"

describe("Agent Provider broker", () => {
  it("fails closed before resolving a credential when the broker is unconfigured", async () => {
    const resolveConnection = vi.fn()
    const response = await handleAgentProviderResponsesRequest(
      providerRequest({ model: "gpt-5.6-sol" }),
      { resolveConnection },
      {}
    )

    expect(response.status).toBe(503)
    expect(await errorCode(response)).toBe("provider-broker-not-configured")
    expect(resolveConnection).not.toHaveBeenCalled()
  })

  it("rejects an invalid service credential in constant-time authentication", async () => {
    const resolveConnection = vi.fn()
    const response = await handleAgentProviderResponsesRequest(
      providerRequest({ model: "gpt-5.6-sol" }, "wrong-secret"),
      { resolveConnection },
      brokerEnvironment()
    )

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain("Bearer")
    expect(await errorCode(response)).toBe("provider-broker-unauthorized")
    expect(resolveConnection).not.toHaveBeenCalled()
  })

  it("bounds request bodies before resolving a Provider Connection", async () => {
    const resolveConnection = vi.fn()
    const request = providerRequest({ model: "gpt-5.6-sol" })
    request.headers.set(
      "content-length",
      String(AGENT_PROVIDER_BROKER_MAX_BODY_BYTES + 1)
    )
    const response = await handleAgentProviderResponsesRequest(
      request,
      { resolveConnection },
      brokerEnvironment()
    )

    expect(response.status).toBe(413)
    expect(await errorCode(response)).toBe("request-too-large")
    expect(resolveConnection).not.toHaveBeenCalled()
  })

  it("requires a valid model id and an active LLM connection", async () => {
    const resolveConnection = vi.fn().mockResolvedValue(null)
    const invalid = await handleAgentProviderResponsesRequest(
      providerRequest({ model: " gpt-5.6-sol" }),
      { resolveConnection },
      brokerEnvironment()
    )
    expect(invalid.status).toBe(400)
    expect(await errorCode(invalid)).toBe("invalid-model")

    const unavailable = await handleAgentProviderResponsesRequest(
      providerRequest({ model: "gpt-5.6-sol" }),
      { resolveConnection },
      brokerEnvironment()
    )
    expect(unavailable.status).toBe(503)
    expect(await errorCode(unavailable)).toBe("provider-connection-unavailable")
    expect(resolveConnection).toHaveBeenLastCalledWith({
      capabilityFamily: "llm",
      providerModelId: "gpt-5.6-sol",
    })
  })

  it("rejects a non-UTF-8 JSON body without touching the credential vault", async () => {
    const resolveConnection = vi.fn()
    const response = await handleAgentProviderResponsesRequest(
      new Request("http://localhost/api/internal/agent-provider/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${brokerSecret}`,
          "content-type": "application/json",
        },
        body: new Uint8Array([0xff]),
      }),
      { resolveConnection },
      brokerEnvironment()
    )

    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe("invalid-json")
    expect(resolveConnection).not.toHaveBeenCalled()
  })

  it("streams an upstream Responses result without exposing the stored key", async () => {
    const resolveConnection = vi.fn().mockResolvedValue({
      id: "provider_connection_1",
      providerId: "provider_openai",
      providerSlug: "openai",
      apiKey: "stored-provider-key",
      source: "credential-vault",
    })
    const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(_url)).toBe("https://api.openai.com/v1/responses")
      const headers = new Headers(init?.headers)
      expect(headers.get("authorization")).toBe("Bearer stored-provider-key")
      expect(headers.get("authorization")).not.toContain(brokerSecret)
      expect(init?.body).toBe(
        JSON.stringify({ model: "gpt-5.6-sol", input: "hello", stream: true })
      )
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.completed"}\n\n'
              )
            )
            controller.close()
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "openai-request-id": "req_provider_1",
            "set-cookie": "must-not-cross-the-broker=1",
          },
        }
      )
    })

    const response = await handleAgentProviderResponsesRequest(
      providerRequest({ model: "gpt-5.6-sol", input: "hello", stream: true }),
      { resolveConnection, fetch: fetch as typeof globalThis.fetch },
      brokerEnvironment()
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(response.headers.get("openai-request-id")).toBe("req_provider_1")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).toContain("response.completed")
  })

  it("uses an Admin-managed compatible base URL and preserves upstream errors", async () => {
    const resolveConnection = vi.fn().mockResolvedValue({
      id: "provider_connection_2",
      providerId: "provider_compatible",
      providerSlug: "compatible",
      apiKey: "compatible-key",
      baseURL: "https://provider.example/v1",
      source: "credential-vault",
    })
    const fetch = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe("https://provider.example/v1/responses")
      return Response.json(
        { error: { code: "rate_limit_exceeded", message: "retry later" } },
        { status: 429, headers: { "retry-after": "2" } }
      )
    })

    const response = await handleAgentProviderResponsesRequest(
      providerRequest({ model: "compatible/model" }),
      { resolveConnection, fetch: fetch as typeof globalThis.fetch },
      brokerEnvironment()
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("2")
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limit_exceeded" },
    })
  })

  it("does not expose unexpected credential resolver failures", async () => {
    const response = await handleAgentProviderResponsesRequest(
      providerRequest({ model: "gpt-5.6-sol" }),
      {
        resolveConnection: vi
          .fn()
          .mockRejectedValue(new Error("secret resolver diagnostics")),
      },
      brokerEnvironment()
    )

    expect(response.status).toBe(503)
    expect(await response.clone().text()).not.toContain("secret resolver")
    expect(await errorCode(response)).toBe("provider-broker-unavailable")
  })
})

function providerRequest(body: unknown, secret = brokerSecret) {
  return new Request(
    "http://localhost/api/internal/agent-provider/v1/responses",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  )
}

function brokerEnvironment() {
  return {
    MUSES_AGENT_PROVIDER_BROKER_SECRET: brokerSecret,
    MUSES_AGENT_PROVIDER_TIMEOUT_MS: "120000",
  }
}

async function errorCode(response: Response) {
  const body = (await response.json()) as { error: { code: string } }
  return body.error.code
}
