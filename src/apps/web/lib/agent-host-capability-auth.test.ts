import { describe, expect, it } from "vitest"

import {
  AgentHostCapabilityAuthError,
  signAgentHostCapabilityRequest,
  verifyAgentHostCapabilityRequest,
} from "@muses/agent-host/signature"

const SECRET = "01234567890123456789012345678901"
const NOW = 1_800_000_000_000

describe("Agent Host capability HMAC", () => {
  it("accepts the exact timestamp, method, path, and body", () => {
    const body = JSON.stringify({ capability: "canvas.inspect", input: {} })
    const request = signedRequest(body, NOW)
    expect(() =>
      verifyAgentHostCapabilityRequest({
        body,
        headers: request.headers,
        method: request.method,
        secret: SECRET,
        now: NOW,
        url: request.url,
      }),
    ).not.toThrow()
  })

  it("rejects body tampering", () => {
    const body = JSON.stringify({ capability: "canvas.inspect", input: {} })
    const request = signedRequest(body, NOW)
    expect(() =>
      verifyAgentHostCapabilityRequest({
        body: `${body} `,
        headers: request.headers,
        method: request.method,
        secret: SECRET,
        now: NOW,
        url: request.url,
      }),
    ).toThrowError(AgentHostCapabilityAuthError)
  })

  it("rejects an expired replay", () => {
    const body = "{}"
    const request = signedRequest(body, NOW - 60_001)
    expect(() =>
      verifyAgentHostCapabilityRequest({
        body,
        headers: request.headers,
        method: request.method,
        secret: SECRET,
        now: NOW,
        url: request.url,
      }),
    ).toThrowError("timestamp is expired")
  })
})

function signedRequest(body: string, timestamp: number) {
  const url = "https://muses.test/api/studio/agent-host-tools/invoke"
  const method = "POST"
  const headers = signAgentHostCapabilityRequest({
    body,
    identity: {
      actorType: "user",
      principalId: "user-1",
      tenantId: "workspace-1",
    },
    method,
    secret: SECRET,
    timestamp,
    url,
  })
  return new Request(url, {
    method,
    body,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  })
}
