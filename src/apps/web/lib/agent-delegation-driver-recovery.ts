import type {
  AgentDelegationDriverClaim,
  AgentDelegationDriverReclaim,
} from "./agent-delegation-driver-store"

export type AgentDelegationWorkflowDriverStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type AgentDelegationDriverCoordinator = {
  claim(delegationRunId: string): Promise<AgentDelegationDriverClaim>
  start(
    delegationRunId: string,
    attemptId: string
  ): Promise<{ runId: string }>
  attach(
    delegationRunId: string,
    attemptId: string,
    driverRunId: string
  ): Promise<boolean>
  release(delegationRunId: string, attemptId: string): Promise<unknown>
  status(driverRunId: string): Promise<AgentDelegationWorkflowDriverStatus>
  renew(
    delegationRunId: string,
    attemptId: string,
    driverRunId: string
  ): Promise<string | null>
  reclaim(
    delegationRunId: string,
    attemptId: string,
    driverRunId: string
  ): Promise<AgentDelegationDriverReclaim>
}

export async function ensureAgentDelegationDriverWithCoordinator(
  delegationRunId: string,
  coordinator: AgentDelegationDriverCoordinator
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let claim: AgentDelegationDriverClaim | AgentDelegationDriverReclaim =
      await coordinator.claim(delegationRunId)

    if (claim.state === "stale-attached") {
      const sdkStatus = await coordinator.status(claim.driverRunId)
      if (sdkStatus === "pending" || sdkStatus === "running") {
        const leaseExpiresAt = await coordinator.renew(
          delegationRunId,
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
        delegationRunId,
        claim.attemptId,
        claim.driverRunId
      )
      if (claim.state === "changed") continue
    }

    if (claim.state !== "claimed") return claim

    let driver: { runId: string }
    try {
      driver = await coordinator.start(delegationRunId, claim.attemptId)
    } catch (error) {
      await coordinator
        .release(delegationRunId, claim.attemptId)
        .catch(() => undefined)
      throw error
    }
    const attached = await coordinator.attach(
      delegationRunId,
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

  throw new Error(
    "Agent delegation driver ownership changed too frequently to reconcile."
  )
}
