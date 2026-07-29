import type { AgentDelegationRunSnapshot } from "@muses/agent-core"
import { getWorkflowMetadata, sleep } from "workflow"

import { createMusesAgentDelegationChildRuntime } from "@/lib/agent-delegation-child-runtime-production"
import { PostgresAgentDelegationDriverStore } from "@/lib/agent-delegation-driver-store"
import { createMusesAgentDelegationScheduler } from "@/lib/agent-delegation-production"

export type AgentDelegationDriverResult = {
  delegationRunId: string
  status: AgentDelegationRunSnapshot["status"]
  revision: number
}

export async function agentDelegationDriver(
  delegationRunId: string,
  attemptId: string
): Promise<AgentDelegationDriverResult> {
  "use workflow"

  const { workflowRunId } = getWorkflowMetadata()
  const ownership = await attachAgentDelegationDriverStep(
    delegationRunId,
    attemptId,
    workflowRunId
  )
  if (!ownership.owned) return ownership.run

  while (true) {
    const driven = await driveAgentDelegationStep(
      delegationRunId,
      attemptId,
      workflowRunId
    )
    if (!driven.owned) return driven.run
    if (isTerminal(driven.run.status)) {
      await finishAgentDelegationDriverStep(
        delegationRunId,
        attemptId,
        workflowRunId
      )
      return driven.run
    }
    await sleep("2s")
  }
}

async function attachAgentDelegationDriverStep(
  delegationRunId: string,
  attemptId: string,
  driverRunId: string
): Promise<
  | { owned: true }
  | { owned: false; run: AgentDelegationDriverResult }
> {
  "use step"

  const drivers = new PostgresAgentDelegationDriverStore()
  if (await drivers.attach(delegationRunId, attemptId, driverRunId)) {
    return { owned: true }
  }
  return {
    owned: false,
    run: await inspectDelegation(delegationRunId),
  }
}

async function driveAgentDelegationStep(
  delegationRunId: string,
  attemptId: string,
  driverRunId: string
): Promise<
  | { owned: true; run: AgentDelegationDriverResult }
  | { owned: false; run: AgentDelegationDriverResult }
> {
  "use step"

  const drivers = new PostgresAgentDelegationDriverStore()
  if (!(await drivers.renew(delegationRunId, attemptId, driverRunId))) {
    return {
      owned: false,
      run: await inspectDelegation(delegationRunId),
    }
  }
  const scheduler = createMusesAgentDelegationScheduler({
    children: createMusesAgentDelegationChildRuntime(),
  })
  const run = await scheduler.resume(delegationRunId)
  return { owned: true, run: toDriverResult(run) }
}

async function finishAgentDelegationDriverStep(
  delegationRunId: string,
  attemptId: string,
  driverRunId: string
) {
  "use step"

  return new PostgresAgentDelegationDriverStore().finish(
    delegationRunId,
    attemptId,
    driverRunId,
    "completed"
  )
}

async function inspectDelegation(delegationRunId: string) {
  const scheduler = createMusesAgentDelegationScheduler({
    children: createMusesAgentDelegationChildRuntime(),
  })
  return toDriverResult(await scheduler.inspect(delegationRunId))
}

function toDriverResult(
  run: AgentDelegationRunSnapshot
): AgentDelegationDriverResult {
  return {
    delegationRunId: run.delegationRunId,
    status: run.status,
    revision: run.revision,
  }
}

function isTerminal(status: AgentDelegationRunSnapshot["status"]) {
  return (
    status === "completed" ||
    status === "completed-with-failures" ||
    status === "failed" ||
    status === "cancelled"
  )
}
