import { describe, expect, it, vi } from "vitest"

import {
  ensureAgentDriverWithCoordinator,
  type AgentDriverCoordinator,
} from "./agent-driver-recovery"

const leaseExpiresAt = "2099-01-01T00:00:00.000Z"

describe("Agent driver recovery", () => {
  it("recovers an expired unbound claim after a crash before SDK start", async () => {
    const release = vi.fn(async () => true)
    const failedStart = coordinator({
      claim: async () => claimed("attempt-1"),
      start: async () => {
        throw new Error("process stopped before SDK start")
      },
      release,
    })

    await expect(
      ensureAgentDriverWithCoordinator("agent-run-1", failedStart)
    ).rejects.toThrow("process stopped before SDK start")
    expect(release).toHaveBeenCalledWith("agent-run-1", "attempt-1")

    const recovered = await ensureAgentDriverWithCoordinator(
      "agent-run-1",
      coordinator({
        claim: async () => claimed("attempt-2"),
        start: async () => ({ runId: "workflow-run-2" }),
        attach: async () => true,
      })
    )
    expect(recovered).toMatchObject({
      state: "attached",
      attemptId: "attempt-2",
      driverRunId: "workflow-run-2",
    })
  })

  it("fences an orphan started before DB attachment when its claim is replaced", async () => {
    const currentAttemptId = "attempt-2"
    const attach = vi.fn(
      async (_runId: string, attemptId: string, driverRunId: string) =>
        attemptId === currentAttemptId && driverRunId.length > 0
    )
    const recovered = await ensureAgentDriverWithCoordinator(
      "agent-run-1",
      coordinator({
        claim: async () => claimed(currentAttemptId),
        start: async () => ({ runId: "workflow-run-2" }),
        attach,
      })
    )

    expect(recovered.state).toBe("attached")
    expect(
      await attach("agent-run-1", "attempt-1", "orphan-workflow-run")
    ).toBe(false)
    expect(
      await attach("agent-run-1", currentAttemptId, "workflow-run-2")
    ).toBe(true)
  })

  it("renews a stale lease when the attached SDK run is still active", async () => {
    const start = vi.fn(async () => ({ runId: "unexpected" }))
    const reclaim = vi.fn(async () => ({ state: "changed" as const }))
    const renew = vi.fn(async () => leaseExpiresAt)
    const result = await ensureAgentDriverWithCoordinator(
      "agent-run-1",
      coordinator({
        claim: async () => ({
          state: "stale-attached",
          attemptId: "attempt-1",
          driverRunId: "workflow-run-1",
        }),
        status: async () => "running",
        renew,
        reclaim,
        start,
      })
    )

    expect(result).toEqual({
      state: "attached",
      attemptId: "attempt-1",
      driverRunId: "workflow-run-1",
      leaseExpiresAt,
    })
    expect(renew).toHaveBeenCalledOnce()
    expect(reclaim).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("allows only one replacement when concurrent callers reconcile a terminal SDK run", async () => {
    type State =
      | { kind: "stale"; attemptId: string; driverRunId: string }
      | { kind: "starting"; attemptId: string }
      | { kind: "running"; attemptId: string; driverRunId: string }

    let state: State = {
      kind: "stale",
      attemptId: "attempt-1",
      driverRunId: "workflow-run-1",
    }
    let starts = 0
    const shared = coordinator({
      claim: async () => {
        if (state.kind === "stale") {
          return {
            state: "stale-attached" as const,
            attemptId: state.attemptId,
            driverRunId: state.driverRunId,
          }
        }
        if (state.kind === "starting") {
          return {
            state: "in-progress" as const,
            attemptId: state.attemptId,
            leaseExpiresAt,
          }
        }
        return {
          state: "attached" as const,
          attemptId: state.attemptId,
          driverRunId: state.driverRunId,
          leaseExpiresAt,
        }
      },
      status: async () => {
        await Promise.resolve()
        return "completed"
      },
      reclaim: async (_runId, attemptId, driverRunId) => {
        if (
          state.kind !== "stale" ||
          state.attemptId !== attemptId ||
          state.driverRunId !== driverRunId
        ) {
          return { state: "changed" }
        }
        state = { kind: "starting", attemptId: "attempt-2" }
        return claimed("attempt-2")
      },
      start: async () => {
        starts += 1
        await Promise.resolve()
        return { runId: "workflow-run-2" }
      },
      attach: async (_runId, attemptId, driverRunId) => {
        if (state.kind !== "starting" || state.attemptId !== attemptId) {
          return false
        }
        state = { kind: "running", attemptId, driverRunId }
        return true
      },
    })

    const results = await Promise.all([
      ensureAgentDriverWithCoordinator("agent-run-1", shared),
      ensureAgentDriverWithCoordinator("agent-run-1", shared),
    ])

    expect(starts).toBe(1)
    expect(results.some((result) => result.state === "attached")).toBe(true)
    expect(state).toEqual({
      kind: "running",
      attemptId: "attempt-2",
      driverRunId: "workflow-run-2",
    })
  })
})

function claimed(attemptId: string) {
  return { state: "claimed" as const, attemptId, leaseExpiresAt }
}

function coordinator(
  overrides: Partial<AgentDriverCoordinator>
): AgentDriverCoordinator {
  return {
    claim: async () => {
      throw new Error("Unexpected claim")
    },
    start: async () => {
      throw new Error("Unexpected start")
    },
    attach: async () => {
      throw new Error("Unexpected attach")
    },
    release: async () => undefined,
    status: async () => {
      throw new Error("Unexpected status")
    },
    renew: async () => {
      throw new Error("Unexpected renew")
    },
    reclaim: async () => {
      throw new Error("Unexpected reclaim")
    },
    ...overrides,
  }
}
