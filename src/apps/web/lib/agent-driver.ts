import { start } from "workflow/api"

import {
  attachAgentDriver,
  claimAgentDriver,
  releaseAgentDriverClaim,
} from "@/lib/agent-state-store"
import { agentRunDriver } from "@/workflows/agent-run-driver"

export async function ensureAgentDriver(runId: string) {
  const claim = await claimAgentDriver(runId)
  if (claim.state !== "claimed") return claim
  try {
    const driver = await start(agentRunDriver, [runId])
    await attachAgentDriver(runId, driver.runId)
    return { state: "attached" as const, driverRunId: driver.runId }
  } catch (error) {
    await releaseAgentDriverClaim(runId).catch(() => undefined)
    throw error
  }
}
