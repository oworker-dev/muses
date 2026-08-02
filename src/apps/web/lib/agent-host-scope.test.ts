import { describe, expect, it, vi } from "vitest"

import {
  AgentHostScopeError,
  requireAuthorizedAgentHostScope,
} from "./agent-host-scope"

describe("Agent Host Project and Canvas scope", () => {
  it("returns only a Canvas joined to the requested Project and Workspace", async () => {
    const query = vi.fn(async (_text: string, _values: unknown[]) => ({
      rows: [{ projectId: "project-1", canvasId: "canvas-1" }],
    }))
    await expect(
      requireAuthorizedAgentHostScope(
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          canvasId: "canvas-1",
        },
        { query },
      ),
    ).resolves.toEqual({ projectId: "project-1", canvasId: "canvas-1" })
    expect(query.mock.calls[0]?.[1]).toEqual([
      "workspace-1",
      "project-1",
      "canvas-1",
    ])
  })

  it("fails closed when the requested scope has no joined row", async () => {
    await expect(
      requireAuthorizedAgentHostScope(
        { workspaceId: "workspace-1", projectId: "other-project" },
        { query: async () => ({ rows: [] }) },
      ),
    ).rejects.toBeInstanceOf(AgentHostScopeError)
  })
})
