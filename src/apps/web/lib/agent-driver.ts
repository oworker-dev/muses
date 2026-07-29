import { getRun, start } from "workflow/api"

import {
  attachAgentDriver,
  claimAgentDriver,
  reclaimAgentDriver,
  releaseAgentDriverClaim,
  renewAgentDriverLease,
} from "@/lib/agent-state-store"
import {
  ensureAgentDriverWithCoordinator,
  type AgentDriverCoordinator,
} from "@/lib/agent-driver-recovery"
import { agentRunDriver } from "@/workflows/agent-run-driver"

const defaultCoordinator: AgentDriverCoordinator = {
  claim: claimAgentDriver,
  start: async (runId, attemptId) => start(agentRunDriver, [runId, attemptId]),
  attach: attachAgentDriver,
  release: releaseAgentDriverClaim,
  status: async (driverRunId) => getRun(driverRunId).status,
  renew: renewAgentDriverLease,
  reclaim: reclaimAgentDriver,
}

export async function ensureAgentDriver(runId: string) {
  return ensureAgentDriverWithCoordinator(runId, defaultCoordinator)
}
