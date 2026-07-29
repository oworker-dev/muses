import type { Pool } from "pg"
import { describe, expect, it, vi } from "vitest"

import type { AgentDelegationRecord, AgentRunSnapshot } from "@muses/agent-core"

import { readAgentDelegationActivity } from "./agent-delegation-activity"

describe("Agent delegation activity projection", () => {
  it("projects bounded task progress and pending Child approval", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("muses_agent_delegation_run")) {
        return {
          rows: [
            {
              delegationRunId: "delegation-1",
              status: "running",
              record: delegationRecord(),
            },
          ],
        }
      }
      return {
        rows: [{ runId: "run-child", snapshot: childRun() }],
      }
    })

    const activity = await readAgentDelegationActivity({
      workspaceId: "workspace-1",
      run: rootRun(),
      pool: { query } as unknown as Pool,
    })

    expect(activity).toEqual({
      rootRunId: "run-root",
      active: true,
      runs: [
        {
          delegationRunId: "delegation-1",
          status: "running",
          failureMode: "fail-fast",
          tasks: [
            {
              taskId: "render",
              objective: "Render one launch image.",
              status: "waiting-approval",
              childRunId: "run-child",
              profile: {
                profileId: "muses-image-specialist",
                version: "0.1.0-alpha",
              },
              artifactRefs: [],
            },
          ],
        },
      ],
      approvals: [
        {
          runId: "run-child",
          taskId: "render",
          profile: {
            profileId: "muses-image-specialist",
            version: "0.1.0-alpha",
          },
          approvalId: "approval-1",
          reason: "This tool creates an external side effect.",
          requestedAt: "2026-07-30T08:00:01.000Z",
          toolCall: {
            name: "image.generate",
            input: { prompt: "Minimal red launch poster" },
          },
        },
      ],
    })
    expect(query).toHaveBeenCalledTimes(2)
    for (const [, values] of query.mock.calls) {
      expect(values).toEqual([
        "workspace-1",
        "project-1",
        "session-1",
        "run-root",
      ])
    }
  })

  it("rejects a cross-Workspace root before querying persistence", async () => {
    const query = vi.fn()

    await expect(
      readAgentDelegationActivity({
        workspaceId: "workspace-attacker",
        run: rootRun(),
        pool: { query } as unknown as Pool,
      })
    ).rejects.toThrow("scope does not match")
    expect(query).not.toHaveBeenCalled()
  })
})

function delegationRecord() {
  return {
    plan: {
      tasks: [
        {
          taskId: "render",
          objective: "Render one launch image.",
          profile: {
            profileId: "muses-image-specialist",
            version: "0.1.0-alpha",
          },
        },
      ],
    },
    snapshot: {
      delegationRunId: "delegation-1",
      status: "running",
      failureMode: "fail-fast",
      tasks: [
        {
          taskId: "render",
          status: "waiting-approval",
          childRunId: "run-child",
        },
      ],
    },
  } as unknown as AgentDelegationRecord
}

function rootRun() {
  return {
    runId: "run-root",
    session: {
      workspaceId: "workspace-1",
      projectId: "project-1",
      sessionId: "session-1",
    },
  } as unknown as AgentRunSnapshot
}

function childRun() {
  return {
    runId: "run-child",
    parent: {
      runId: "run-root",
      rootRunId: "run-root",
      delegationTaskId: "render",
    },
    profile: {
      profileId: "muses-image-specialist",
      version: "0.1.0-alpha",
    },
    pendingApproval: {
      approvalId: "approval-1",
      reason: "This tool creates an external side effect.",
      requestedAt: "2026-07-30T08:00:01.000Z",
      status: "pending",
      toolCall: {
        name: "image.generate",
        input: { prompt: "Minimal red launch poster" },
      },
    },
  } as unknown as AgentRunSnapshot
}
