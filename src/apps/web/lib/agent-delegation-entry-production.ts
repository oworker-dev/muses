import type {
  AgentToolExecutionContext,
  AgentRunSnapshot,
} from "@muses/agent-core"

import {
  submitAuthorizedAgentDelegation,
  type AgentDelegationToolInput,
} from "./agent-delegation-entry"
import { createMusesAgentDelegationChildRuntime } from "./agent-delegation-child-runtime-production"
import { ensureAgentDelegationDriver } from "./agent-delegation-driver"
import { createMusesAgentDelegationScheduler } from "./agent-delegation-production"
import { authorizeAgentRun } from "./agent-state-store"
import { getPgPool } from "./database"

export async function submitProductionAgentDelegation(input: {
  readonly context: AgentToolExecutionContext
  readonly request: AgentDelegationToolInput
}) {
  const pool = getPgPool()
  const scheduler = createMusesAgentDelegationScheduler({
    pool,
    children: createMusesAgentDelegationChildRuntime({ pool }),
  })
  return submitAuthorizedAgentDelegation({
    ...input,
    dependencies: {
      loadRun: async (workspaceId, runId): Promise<AgentRunSnapshot | null> =>
        (await authorizeAgentRun(workspaceId, runId))?.snapshot || null,
      submit: (submission) => scheduler.submit(submission),
      ensureDriver: ensureAgentDelegationDriver,
      now: () => new Date(),
    },
  })
}
