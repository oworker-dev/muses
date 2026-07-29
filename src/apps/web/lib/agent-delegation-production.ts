import type { Pool } from "pg"

import type { AgentDelegationChildRuntimePort } from "@muses/agent-core"

import {
  createAgentDelegationScheduler,
  type AgentDelegationEvidenceAuthorizationPort,
  type VersionedAgentProfileRegistration,
} from "./agent-delegation-runtime"
import { musesAgentProfile } from "./agent-runtime"

export function createMusesAgentDelegationScheduler(input: {
  readonly children: AgentDelegationChildRuntimePort
  readonly pool?: Pool
  readonly profiles?: readonly VersionedAgentProfileRegistration[]
  readonly evidence?: AgentDelegationEvidenceAuthorizationPort
}) {
  return createAgentDelegationScheduler({
    ...input,
    profiles: input.profiles || [{ profile: musesAgentProfile() }],
  })
}
