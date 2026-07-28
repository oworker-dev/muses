import type { AgentRunSnapshot } from "@muses/agent-core"

import { createMusesAgentRuntime } from "@/lib/agent-runtime"
import { finishAgentDriver } from "@/lib/agent-state-store"

export type AgentRunDriverResult = {
  runId: string
  status: AgentRunSnapshot["status"]
  revision: number
}

export async function agentRunDriver(
  runId: string
): Promise<AgentRunDriverResult> {
  "use workflow"

  return driveAgentRunStep(runId)
}

async function driveAgentRunStep(runId: string): Promise<AgentRunDriverResult> {
  "use step"

  const runtime = createMusesAgentRuntime()
  try {
    let run = await runtime.inspect(runId)
    if (!isTerminal(run.status) && run.status !== "waiting-approval") {
      await runtime.resume(runId)
      run = await runtime.inspect(runId)
    }
    await finishAgentDriver(runId, "completed")
    return { runId, status: run.status, revision: run.revision }
  } catch (error) {
    await finishAgentDriver(runId, "failed").catch(() => undefined)
    throw error
  }
}

function isTerminal(status: AgentRunSnapshot["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}
