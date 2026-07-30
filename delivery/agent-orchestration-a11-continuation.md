# Agent Orchestration A11 Continuation Gate

## Outcome

A11 closes the product gap between an accepted `agent.delegate` call and the
parent Agent's final user-facing answer. The Muses Scheduler remains the
authority for the delegation DAG, task outcomes, aggregate terminal state and
logical budget. Workflow SDK remains a durable wake/sleep/Step adapter.

The Gate delivers two independent product behaviors:

1. a terminal delegation result is projected as bounded, trusted data and
   resumes its direct parent Agent exactly once; and
2. a user can cancel an active DelegationRun after the parent AgentRun has
   already completed, without pretending that root-Run cancellation still
   applies.

This Gate does not add PPT behavior, a provider-backed physical sandbox or
production Skill/MCP resolution.

## Parent-result continuation contract

### Authority and scope

- The source must be one persisted terminal `muses_agent_delegation_run`.
- Workspace, Project, Session, root Run and direct-parent Run are copied from
  the Scheduler-owned record and protected by database foreign keys.
- The direct parent AgentRun must match the same Workspace, Project and Session.
- Once the Scheduler accepts a delegation, a later `completed` or `failed`
  parent AgentRun does not revoke that frozen authority. Only explicit parent
  or DelegationRun cancellation revokes it; lineage and scope checks remain
  mandatory throughout Child execution.
- Browser input, Child prompts, hidden histories and raw Child result bodies
  are never accepted as continuation data.

### Trusted projection

The server creates a deterministic projection containing only:

- schema version, projection kind, DelegationRun id and terminal status;
- each task's id, status and exact Profile id/version;
- authorized result Artifact refs;
- a failure code when a task failed; and
- a unique aggregate list of Artifact refs.

The parent receives this projection in a server-authored `system` message. The
message explicitly treats the projection as data, not instructions. It does
not include task objectives, delegated context facts, Child messages, raw
structured result data, credentials or hidden reasoning.

`completed`, `completed-with-failures` and `failed` results may resume the
parent. A user-cancelled DelegationRun is projected in Studio but does not
resume the model or consume another model-call budget.

### Idempotency and recovery

- One PostgreSQL continuation receipt exists per DelegationRun.
- The receipt freezes exact scope, deterministic message id and projection
  fingerprint.
- A leased attempt coordinates concurrent drivers; an expired attempt can be
  reclaimed.
- `AgentRuntime.followUp` treats an identical message id and payload as an
  idempotent replay whether the message is pending or already in context.
- Reusing a message id with different role, content, timestamp or metadata is
  a closed conflict.
- The receipt records message commit before parent-driver completion. A crash
  at any boundary can replay both operations without appending another message
  or starting another active driver.
- Parent continuation uses the parent's existing bounded model-call, token,
  duration and credit budgets. It does not create an implicit budget or bypass
  approval policy.

The receipt states are `pending`, `processing`, `completed`, `skipped` and
`failed`. `message_committed_at` is an independent durable milestone so a
reclaimed attempt can distinguish a committed follow-up from an uncommitted
one. A retryable infrastructure error releases the attempt to `pending`; a
permanent scope or fingerprint conflict fails closed.

## Independent cancellation contract

- Studio and API address one exact DelegationRun id under an already authorized
  Agent root scope.
- The server rechecks Workspace, Project, Session and root Run before invoking
  cancellation. A guessed DelegationRun id outside that scope is returned as
  not found.
- The API accepts a stable idempotency key and non-empty reason.
- The Scheduler first records `cancelling` and its cancellation receipt, then
  cancels or reconciles Child AgentRuns and task budgets, and finally records
  the terminal Muses state.
- Only after the Scheduler mutation does the adapter explicitly cancel an
  active Workflow SDK delegation driver.
- Replaying the same cancellation request returns the existing outcome;
  changing its identity or reason is a conflict.
- Cancelling a terminal DelegationRun is a state conflict and never rewrites
  completed facts or known billing outcomes.
- `cancelling` remains active in the Studio projection so polling continues
  until the durable terminal state is visible after refresh.

## Acceptance

The Gate passes only when all of the following are proven:

1. a completed parallel delegation appends one trusted parent message and
   causes one new bounded parent turn;
2. the parent's final answer references the aggregated authorized Artifacts;
3. replay, refresh and driver recovery do not append a duplicate message,
   perform a duplicate model call or add a duplicate charge;
4. an active DelegationRun can be cancelled while its parent AgentRun is
   completed;
5. cancellation reaches Child AgentRuns, Scheduler task/envelope terminal
   state and the active Workflow SDK driver;
6. cross-Workspace, cross-Project, cross-Session and wrong-root cancellation
   attempts fail closed;
7. PostgreSQL adapter verification, Agent Core tests, Web tests, Workflow serde
   validation and a real authenticated browser run pass; and
8. committed evidence contains no credentials, prompts, raw provider payloads
   or private user data.

## Verification status

All deterministic Agent Core, Web, PostgreSQL and Workflow SDK gates pass. The
real authenticated cancellation case passes after the parent AgentRun has
completed. The real two-Specialist result case also passes with two independent
image Artifacts, one trusted continuation message, parent turn `+1`, a
completed continuation receipt, complete three-Agent lineage, two image
reservations and unchanged facts after browser refresh.

The passing configuration uses an independent image-capable route rather than
assuming the LLM key also exposes image models. This validates the
capability-scoped Provider boundary and closes A11. Provider-backed physical
sandboxing, production Skill/MCP resolution, KMS/HSM-backed credentials and
PPT scenario behavior remain separate later gates. See
`delivery/evidence/agent-core-alpha/a11-continuation/README.md`.
