import type { Pool } from "pg"
import { getRun, start } from "workflow/api"

import { createMusesAgentDelegationChildRuntime } from "./agent-delegation-child-runtime-production"
import { continueAgentDelegationParent } from "./agent-delegation-continuation"
import {
  cancelAgentDelegationSdkDriver,
  type AgentDelegationDriverCoordinator,
  ensureAgentDelegationDriverWithCoordinator,
} from "./agent-delegation-driver-recovery"
import { PostgresAgentDelegationDriverStore } from "./agent-delegation-driver-store"
import { createMusesAgentDelegationScheduler } from "./agent-delegation-production"
import { getPgPool } from "./database"
import { agentDelegationDriver } from "../workflows/agent-delegation-driver"

export function createAgentDelegationDriverCoordinator(
  input: {
    readonly store?: PostgresAgentDelegationDriverStore
  } = {}
): AgentDelegationDriverCoordinator {
  const store = input.store || new PostgresAgentDelegationDriverStore()
  return {
    claim: (runId) => store.claim(runId),
    start: async (runId, attemptId) =>
      start(agentDelegationDriver, [runId, attemptId]),
    attach: (runId, attemptId, driverRunId) =>
      store.attach(runId, attemptId, driverRunId),
    release: (runId, attemptId) => store.release(runId, attemptId),
    status: async (driverRunId) => getRun(driverRunId).status,
    renew: (runId, attemptId, driverRunId) =>
      store.renew(runId, attemptId, driverRunId),
    reclaim: (runId, attemptId, driverRunId) =>
      store.reclaim(runId, attemptId, driverRunId),
  }
}

export async function ensureAgentDelegationDriver(
  delegationRunId: string,
  coordinator: AgentDelegationDriverCoordinator = createAgentDelegationDriverCoordinator()
) {
  return ensureAgentDelegationDriverWithCoordinator(
    delegationRunId,
    coordinator
  )
}

export async function inspectAgentDelegationExecution(
  delegationRunId: string,
  input: { readonly pool?: Pool } = {}
) {
  const pool = input.pool || getPgPool()
  const scheduler = createMusesAgentDelegationScheduler({
    pool,
    children: createMusesAgentDelegationChildRuntime({ pool }),
  })
  const driver = await new PostgresAgentDelegationDriverStore(pool).inspect(
    delegationRunId
  )
  return {
    run: await scheduler.inspect(delegationRunId),
    driver,
  }
}

export async function cancelAgentDelegationExecution(input: {
  readonly delegationRunId: string
  readonly idempotencyKey: string
  readonly reason: string
  readonly pool?: Pool
}) {
  const pool = input.pool || getPgPool()
  const scheduler = createMusesAgentDelegationScheduler({
    pool,
    children: createMusesAgentDelegationChildRuntime({ pool }),
  })
  const run = await scheduler.cancel(input)
  if (run.status !== "cancelled") {
    return {
      run,
      driver: await new PostgresAgentDelegationDriverStore(pool).inspect(
        input.delegationRunId
      ),
    }
  }
  await continueAgentDelegationParent(input.delegationRunId, { pool })
  const drivers = new PostgresAgentDelegationDriverStore(pool)
  const driver = await cancelAgentDelegationSdkDriver(input.delegationRunId, {
    drivers,
    readRun: getRun,
  })
  return { run, driver }
}
