import type { AgentDriverClaim, AgentDriverReclaim } from "./agent-state-store"

type WorkflowDriverStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type AgentDriverCoordinator = {
  claim(runId: string): Promise<AgentDriverClaim>
  start(runId: string, attemptId: string): Promise<{ runId: string }>
  attach(
    runId: string,
    attemptId: string,
    driverRunId: string
  ): Promise<boolean>
  release(runId: string, attemptId: string): Promise<unknown>
  status(driverRunId: string): Promise<WorkflowDriverStatus>
  renew(
    runId: string,
    attemptId: string,
    driverRunId: string
  ): Promise<string | null>
  reclaim(
    runId: string,
    attemptId: string,
    driverRunId: string
  ): Promise<AgentDriverReclaim>
}

export async function ensureAgentDriverWithCoordinator(
  runId: string,
  coordinator: AgentDriverCoordinator
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let claim: AgentDriverClaim | AgentDriverReclaim =
      await coordinator.claim(runId)

    if (claim.state === "stale-attached") {
      const sdkStatus = await coordinator.status(claim.driverRunId)
      if (sdkStatus === "pending" || sdkStatus === "running") {
        const leaseExpiresAt = await coordinator.renew(
          runId,
          claim.attemptId,
          claim.driverRunId
        )
        if (!leaseExpiresAt) continue
        return {
          state: "attached" as const,
          attemptId: claim.attemptId,
          driverRunId: claim.driverRunId,
          leaseExpiresAt,
        }
      }
      claim = await coordinator.reclaim(
        runId,
        claim.attemptId,
        claim.driverRunId
      )
      if (claim.state === "changed") continue
    }

    if (claim.state !== "claimed") return claim

    let driver: { runId: string }
    try {
      driver = await coordinator.start(runId, claim.attemptId)
    } catch (error) {
      await coordinator.release(runId, claim.attemptId).catch(() => undefined)
      throw error
    }
    const attached = await coordinator.attach(
      runId,
      claim.attemptId,
      driver.runId
    )
    if (!attached) continue
    return {
      state: "attached" as const,
      attemptId: claim.attemptId,
      driverRunId: driver.runId,
      leaseExpiresAt: claim.leaseExpiresAt,
    }
  }

  throw new Error("Agent driver ownership changed too frequently to reconcile.")
}
