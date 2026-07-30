import type { Pool } from "pg"
import { describe, expect, it, vi } from "vitest"

import type { AgentDelegationRecord } from "@muses/agent-core"

import { authorizeAgentDelegationExecution } from "./agent-delegation-authorization"

describe("Agent delegation execution authorization", () => {
  it("requires the exact Workspace, Project, Session and root Run scope", async () => {
    const query = vi.fn(async () => ({
      rows: [{ status: "running", record: scopedRecord() }],
    }))

    const authorized = await authorizeAgentDelegationExecution({
      ...scope(),
      pool: { query } as unknown as Pool,
    })

    expect(authorized?.snapshot.delegationRunId).toBe("delegation-1")
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("root_run_id = $5"),
      [
        "delegation-1",
        "workspace-1",
        "project-1",
        "session-1",
        "run-root",
      ]
    )
  })

  it("returns not found instead of revealing a delegation outside the scope", async () => {
    const query = vi.fn(async () => ({ rows: [] }))

    const authorized = await authorizeAgentDelegationExecution({
      ...scope(),
      workspaceId: "workspace-attacker",
      pool: { query } as unknown as Pool,
    })

    expect(authorized).toBeNull()
  })

  it("fails closed when persisted record and indexed scope drift", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          status: "running",
          record: {
            ...scopedRecord(),
            plan: { ...scopedRecord().plan, projectId: "project-other" },
          },
        },
      ],
    }))

    await expect(
      authorizeAgentDelegationExecution({
        ...scope(),
        pool: { query } as unknown as Pool,
      })
    ).rejects.toThrow("scope is inconsistent")
  })
})

function scope() {
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    sessionId: "session-1",
    rootRunId: "run-root",
    delegationRunId: "delegation-1",
  }
}

function scopedRecord(): AgentDelegationRecord {
  return {
    plan: {
      workspaceId: "workspace-1",
      projectId: "project-1",
      sessionId: "session-1",
      rootRunId: "run-root",
    },
    snapshot: {
      delegationRunId: "delegation-1",
      status: "running",
    },
  } as unknown as AgentDelegationRecord
}
