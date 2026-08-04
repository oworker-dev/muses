import { describe, expect, it, vi } from "vitest"

import {
  createMusesAgentHostClient,
  createMusesAgentHostToken,
  MusesAgentHostError,
} from "./muses-agent-host"

const environment = {
  MUSES_AGENT_HOST_JWT_SECRET: "a-secure-development-secret-that-is-long-enough",
  MUSES_AGENT_HOST_JWT_ISSUER: "muses.test",
  MUSES_AGENT_HOST_JWT_AUDIENCE: "muses-agent.test",
  MUSES_AGENT_SERVICE_URL: "https://agent.test",
}

describe("Muses standalone Agent host", () => {
  it("issues a short-lived tenant-scoped HS256 token", () => {
    const issued = createMusesAgentHostToken(
      {
        userId: "user-1",
        workspaceId: "workspace-1",
        scope: { projectId: "project-1", canvasId: "canvas-1" },
      },
      environment,
    )
    const [header, payload, signature] = issued.token.split(".")
    expect(header).toBeTruthy()
    expect(payload).toBeTruthy()
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))).toMatchObject({
      actorType: "user",
      aud: "muses-agent.test",
      iss: "muses.test",
      sub: "user-1",
      tenantId: "workspace-1",
      agentHostScope: JSON.stringify({ projectId: "project-1", canvasId: "canvas-1" }),
    })
  })

  it("uses a fresh short-lived token for each service request", async () => {
    const calls: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      calls.push(request)
      if (request.url.includes("/events?")) {
        return Response.json({ run: runSnapshot(), events: [], nextCursor: 0 })
      }
      if (request.method === "DELETE") {
        return Response.json({ run: runSnapshot(), cancellation: "accepted" })
      }
      return Response.json({ run: runSnapshot() })
    })
    const client = createMusesAgentHostClient({ userId: "user-1", workspaceId: "workspace-1" }, environment, fetchMock)
    await client.inspect("arun-1")
    await client.events("arun-1", 3)
    await client.cancel("arun-1")
    expect(calls).toHaveLength(3)
    expect(calls[0]?.headers.get("authorization")).toMatch(/^Bearer /)
    expect(calls[0]?.headers.get("authorization")).not.toBe(calls[1]?.headers.get("authorization"))
    expect(calls[1]?.url).toContain("/events?after=3")
    expect(calls[2]?.method).toBe("DELETE")
  })

  it("keeps structured Agent service errors", async () => {
    const client = createMusesAgentHostClient(
      { userId: "user-1", workspaceId: "workspace-1" },
      environment,
      async () => Response.json({ message: "No access" }, { status: 403 }),
    )
    await expect(client.inspect("arun-1")).rejects.toBeInstanceOf(MusesAgentHostError)
  })
})

function runSnapshot() {
  return {
    contractVersion: "0.1.0-draft",
    correlationId: "correlation-1",
    createdAt: "2026-08-02T00:00:00.000Z",
    eventCount: 0,
    harness: { kind: "eve" },
    metadata: {},
    policy: {},
    profile: { profileId: "muses-platform", version: "0.1.0" },
    revision: 1,
    runId: "arun-1",
    status: "running",
    updatedAt: "2026-08-02T00:00:00.000Z",
    usage: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      steps: 0,
    },
  }
}
