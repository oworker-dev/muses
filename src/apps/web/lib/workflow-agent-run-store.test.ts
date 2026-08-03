import type { PoolClient } from "pg"
import { describe, expect, it, vi } from "vitest"

import {
  listWorkflowAgentRunIds,
  recordWorkflowAgentRun,
} from "./workflow-agent-run-store"

describe("Workflow AgentRun store", () => {
  it("persists one stable mapping under the parent-run cancellation lock", async () => {
    const statements: string[] = []
    const query = vi.fn(async (text: string) => {
      statements.push(text)
      if (text.includes("from muses_workflow_run run")) {
        return {
          rows: [{ status: "running", cancellationRequested: false }],
          rowCount: 1,
        }
      }
      if (text.includes('agent_run_id as "agentRunId"')) {
        return { rows: [{ agentRunId: "arun-1" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    })
    const release = vi.fn()

    await expect(
      recordWorkflowAgentRun(
        {
          workspaceId: "workspace-1",
          workflowRunId: "wrun-1",
          workflowNodeId: "agent-1",
          agentRunId: "arun-1",
        },
        {
          connect: async () => ({
            query: query as unknown as PoolClient["query"],
            release,
          }),
        }
      )
    ).resolves.toEqual({ shouldCancelAgentRun: false })

    expect(statements[1]).toContain("pg_advisory_xact_lock")
    expect(
      statements.some((statement) =>
        statement.includes("insert into muses_workflow_agent_run")
      )
    ).toBe(true)
    expect(statements.at(-1)).toBe("commit")
    expect(release).toHaveBeenCalledOnce()
  })

  it("asks the starter to cancel a late AgentRun after parent cancellation", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from muses_workflow_run run")) {
        return {
          rows: [{ status: "cancelled", cancellationRequested: true }],
          rowCount: 1,
        }
      }
      if (text.includes('agent_run_id as "agentRunId"')) {
        return { rows: [{ agentRunId: "arun-late" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    })

    await expect(
      recordWorkflowAgentRun(
        {
          workspaceId: "workspace-1",
          workflowRunId: "wrun-1",
          workflowNodeId: "agent-1",
          agentRunId: "arun-late",
        },
        {
          connect: async () => ({
            query: query as unknown as PoolClient["query"],
            release: vi.fn(),
          }),
        }
      )
    ).resolves.toEqual({ shouldCancelAgentRun: true })
  })

  it("lists all durable child runs for cancellation", async () => {
    const query = vi.fn(async () => ({
      rows: [{ agentRunId: "arun-1" }, { agentRunId: "arun-2" }],
      rowCount: 2,
    }))
    await expect(
      listWorkflowAgentRunIds(
        { workspaceId: "workspace-1", workflowRunId: "wrun-1" },
        { query: query as unknown as PoolClient["query"] }
      )
    ).resolves.toEqual(["arun-1", "arun-2"])
  })
})
