import { describe, expect, it, vi } from "vitest"

import {
  cancelAgentDelegationSdkDriver,
  ensureAgentDelegationDriverWithCoordinator,
  type AgentDelegationDriverCoordinator,
  type AgentDelegationPersistedDriverStatus,
  type AgentDelegationWorkflowDriverStatus,
} from "./agent-delegation-driver-recovery"

const leaseExpiresAt = "2099-01-01T00:00:00.000Z"

describe("Agent delegation driver recovery", () => {
  it("releases a claim when SDK start fails before attachment", async () => {
    const release = vi.fn(async () => true)
    const failed = coordinator({
      claim: async () => claimed("attempt-1"),
      start: async () => {
        throw new Error("SDK start unavailable")
      },
      release,
    })

    await expect(
      ensureAgentDelegationDriverWithCoordinator("delegation-1", failed)
    ).rejects.toThrow("SDK start unavailable")
    expect(release).toHaveBeenCalledWith("delegation-1", "attempt-1")
  })

  it("renews a stale attachment while its SDK Run is still active", async () => {
    const start = vi.fn(async () => ({ runId: "unexpected" }))
    const reclaim = vi.fn(async () => ({ state: "changed" as const }))
    const renew = vi.fn(async () => leaseExpiresAt)

    const result = await ensureAgentDelegationDriverWithCoordinator(
      "delegation-1",
      coordinator({
        claim: async () => ({
          state: "stale-attached",
          attemptId: "attempt-1",
          driverRunId: "workflow-1",
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
      driverRunId: "workflow-1",
      leaseExpiresAt,
    })
    expect(reclaim).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("allows only one replacement for an expired terminal SDK Run", async () => {
    type State =
      | { kind: "stale"; attemptId: string; driverRunId: string }
      | { kind: "starting"; attemptId: string }
      | { kind: "running"; attemptId: string; driverRunId: string }

    let state: State = {
      kind: "stale",
      attemptId: "attempt-1",
      driverRunId: "workflow-1",
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
      status: async () => "failed",
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
        return { runId: "workflow-2" }
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
      ensureAgentDelegationDriverWithCoordinator("delegation-1", shared),
      ensureAgentDelegationDriverWithCoordinator("delegation-1", shared),
    ])

    expect(starts).toBe(1)
    expect(
      results.some(({ state: resultState }) => resultState === "attached")
    ).toBe(true)
    expect(state).toEqual({
      kind: "running",
      attemptId: "attempt-2",
      driverRunId: "workflow-2",
    })
  })

  it("does not start a driver for a terminal DelegationRun", async () => {
    const start = vi.fn(async () => ({ runId: "unexpected" }))

    const result = await ensureAgentDelegationDriverWithCoordinator(
      "delegation-1",
      coordinator({
        claim: async () => ({ state: "terminal", status: "completed" }),
        start,
      })
    )

    expect(result).toEqual({ state: "terminal", status: "completed" })
    expect(start).not.toHaveBeenCalled()
  })

  it("cancels an active SDK Run and persists the cancelled driver state", async () => {
    let sdkStatus: AgentDelegationWorkflowDriverStatus = "running"
    let persistedStatus: AgentDelegationPersistedDriverStatus = "running"
    const cancel = vi.fn(async () => {
      sdkStatus = "cancelled"
    })
    const finish = vi.fn(
      async (
        _delegationRunId: string,
        _attemptId: string,
        _driverRunId: string,
        status: "completed" | "failed" | "cancelled"
      ) => {
        persistedStatus = status
        return true
      }
    )

    const result = await cancelAgentDelegationSdkDriver("delegation-1", {
      drivers: {
        inspect: async () => ({
          status: persistedStatus,
          runId: "workflow-1",
          attemptId: "attempt-1",
          leaseExpiresAt: leaseExpiresAt,
        }),
        finish,
      },
      readRun: () => ({
        exists: Promise.resolve(true),
        get status() {
          return Promise.resolve(sdkStatus)
        },
        cancel,
      }),
    })

    expect(cancel).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledWith(
      "delegation-1",
      "attempt-1",
      "workflow-1",
      "cancelled"
    )
    expect(result).toMatchObject({
      status: "cancelled",
      runId: "workflow-1",
      attemptId: "attempt-1",
    })
  })

  it("marks a missing SDK Run as a failed driver without cancelling", async () => {
    let persistedStatus: AgentDelegationPersistedDriverStatus = "running"
    const cancel = vi.fn(async () => undefined)
    const finish = vi.fn(
      async (
        _delegationRunId: string,
        _attemptId: string,
        _driverRunId: string,
        status: "completed" | "failed" | "cancelled"
      ) => {
        persistedStatus = status
        return true
      }
    )

    const result = await cancelAgentDelegationSdkDriver("delegation-1", {
      drivers: {
        inspect: async () => ({
          status: persistedStatus,
          runId: "workflow-missing",
          attemptId: "attempt-1",
          leaseExpiresAt: leaseExpiresAt,
        }),
        finish,
      },
      readRun: () => ({
        exists: Promise.resolve(false),
        status: Promise.resolve("running"),
        cancel,
      }),
    })

    expect(cancel).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(
      "delegation-1",
      "attempt-1",
      "workflow-missing",
      "failed"
    )
    expect(result?.status).toBe("failed")
  })
})

function claimed(attemptId: string) {
  return { state: "claimed" as const, attemptId, leaseExpiresAt }
}

function coordinator(
  overrides: Partial<AgentDelegationDriverCoordinator>
): AgentDelegationDriverCoordinator {
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
