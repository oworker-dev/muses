import { AgentModelError, type AgentRunSnapshot } from "@muses/agent-core"
import { getWorkflowMetadata, RetryableError } from "workflow"

import { AGENT_MODEL_CALL_LEASE_MS } from "@/lib/agent-model-call-store"
import { createMusesAgentRuntime } from "@/lib/agent-runtime"
import {
  attachAgentDriver,
  finishAgentDriver,
  renewAgentDriverLease,
} from "@/lib/agent-state-store"

export type AgentRunDriverResult = {
  runId: string
  status: AgentRunSnapshot["status"]
  revision: number
}

export async function agentRunDriver(
  runId: string,
  attemptId: string
): Promise<AgentRunDriverResult> {
  "use workflow"

  const { workflowRunId } = getWorkflowMetadata()
  const ownership = await attachAgentRunDriverStep(
    runId,
    attemptId,
    workflowRunId
  )
  if (!ownership.owned) return ownership.run
  return driveAgentRunStep(runId, attemptId, workflowRunId)
}

async function attachAgentRunDriverStep(
  runId: string,
  attemptId: string,
  driverRunId: string
): Promise<{ owned: true } | { owned: false; run: AgentRunDriverResult }> {
  "use step"

  if (await attachAgentDriver(runId, attemptId, driverRunId)) {
    return { owned: true }
  }
  const run = await createMusesAgentRuntime().inspect(runId)
  return {
    owned: false,
    run: { runId, status: run.status, revision: run.revision },
  }
}

async function driveAgentRunStep(
  runId: string,
  attemptId: string,
  driverRunId: string
): Promise<AgentRunDriverResult> {
  "use step"

  const runtime = createMusesAgentRuntime()
  const owned = await renewAgentDriverLease(runId, attemptId, driverRunId)
  if (!owned) {
    const run = await runtime.inspect(runId)
    return { runId, status: run.status, revision: run.revision }
  }
  let run = await runtime.inspect(runId)
  if (!isTerminal(run.status) && !isSuspended(run.status)) {
    try {
      await runtime.resume(runId)
    } catch (error) {
      if (
        error instanceof AgentModelError &&
        error.runtimeAction === "retry-driver"
      ) {
        const retryAfter =
          error.code === "model-receipt-commit-unknown"
            ? 2_000
            : AGENT_MODEL_CALL_LEASE_MS + 1_000
        throw new RetryableError(error.publicMessage, { retryAfter })
      }
      throw error
    }
    run = await runtime.inspect(runId)
  }
  await finishAgentDriver(runId, attemptId, driverRunId, "completed")
  return { runId, status: run.status, revision: run.revision }
}

function isTerminal(status: AgentRunSnapshot["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function isSuspended(status: AgentRunSnapshot["status"]) {
  return status === "waiting-approval" || status === "waiting-input"
}
