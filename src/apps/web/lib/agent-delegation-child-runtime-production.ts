import type { Pool } from "pg"

import { cancelAgentRunAndChildren } from "./agent-cancellation"
import {
  MusesAgentDelegationChildRuntime,
  PostgresAgentDelegationChildCostOutcome,
} from "./agent-delegation-child-runtime"
import { Sha256AgentDelegationFingerprint } from "./agent-delegation-runtime"
import { ensureAgentDriver } from "./agent-driver"
import { createMusesAgentRuntime } from "./agent-runtime"
import { getPgPool } from "./database"

export function createMusesAgentDelegationChildRuntime(input: {
  readonly pool?: Pool
} = {}) {
  const pool = input.pool || getPgPool()
  return new MusesAgentDelegationChildRuntime({
    runtime: createMusesAgentRuntime(),
    drivers: { ensure: ensureAgentDriver },
    cancellations: {
      cancel: async (cancellation) =>
        (await cancelAgentRunAndChildren(cancellation)).state,
    },
    costs: new PostgresAgentDelegationChildCostOutcome(pool),
    fingerprints: new Sha256AgentDelegationFingerprint(),
  })
}
