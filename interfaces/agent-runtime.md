# Agent Runtime Interface

This document describes the implemented Muses Agent Runtime boundary. It is a
product contract, not a promise that every surface is already a public API.

## Authority layers

| Layer | Current authority |
| --- | --- |
| `@muses/agent-core` | Framework-neutral Session, AgentRun, message, plan, approval, budget and event state machine |
| Muses Scheduler and PostgreSQL | Delegation DAG, root/direct-parent/child lineage, task state, result validation, logical budget, continuation receipt and cancellation receipt |
| Operation Gateway | Server-authoritative creative canvas mutations and Asset placement |
| Workflow SDK | Durable driver execution, Step retry, sleep/wake and Workflow World execution evidence |
| AI SDK/provider adapters | Model and tool protocol behind Muses receipts, limits and approval policy |

Workflow SDK, Eve and other harnesses are replaceable adapters. They do not
own Workspace authorization, product state, budget, billing or audit facts.

## Framework-neutral runtime

`AgentRuntimePort` currently supports `start`, `stream`, `steer`, `followUp`,
`approve`, `cancel`, `resume`, `inspect`, `compact`, `updatePlan` and `close`.
The same Headless Runtime is used by production adapters and deterministic
evals; it has no React, Next.js, canvas or Workflow SDK dependency.

Messages have stable ids. Replaying the same id, role, content, timestamp and
metadata is idempotent whether the message is still pending or already in the
bounded context. Reusing an id with a different payload fails with
`message-id-conflict`.

## Authenticated Studio projection

The current HTTP projection is same-origin Studio infrastructure rather than a
published third-party API:

- `POST /api/studio/agent-runs` starts one root AgentRun from a user prompt and
  stable request idempotency key.
- `GET /api/studio/agent-runs?workspaceId=...&runId=...&afterSequence=...`
  returns the authorized public Run, cursor-based events, driver state and the
  root delegation-tree projection.
- `PATCH /api/studio/agent-runs` accepts `steer`, `follow-up`, `approve`,
  `resume`, `cancel` and `cancel-delegation` actions.

Every request requires a verified Better Auth session and Workspace
membership. Mutations reject the `viewer` role. AgentRun lookups and
DelegationRun cancellation recheck exact Workspace, Project, Session and root
Run scope; a cross-scope id is returned as not found.

## Delegation continuation

When a DelegationRun reaches `completed`, `completed-with-failures` or
`failed`, the server projects only its identity, terminal status, task/Profile
facts, authorized Artifact refs and failure codes. It appends that projection
to the direct parent as one trusted `system` message and starts at most one
additional bounded parent turn.

One PostgreSQL continuation receipt per DelegationRun freezes the projection
fingerprint and message identity. Claim leases, a separate message-committed
milestone and terminal replay allow recovery without duplicate context,
provider calls or charges. Child prompts, objectives, raw results, hidden
history, reasoning and credentials are excluded from this projection.

A user-cancelled DelegationRun creates a `skipped` continuation receipt. It
does not call the parent model or create another parent model-call budget.

An accepted DelegationRun owns a Scheduler-frozen authority snapshot. A parent
AgentRun becoming `completed` or `failed` does not abandon already accepted
Child work; the result may still be projected back through the bounded
continuation path. Explicit cancellation is the revocation boundary. This does
not relax Workspace, Project, Session, root/direct-parent lineage, grant or
budget validation.

## Independent cancellation

`cancel-delegation` addresses one active DelegationRun even when its parent
AgentRun is already complete. It requires:

- `workspaceId`, root-scope `runId` and exact `delegationRunId`;
- a stable `idempotencyKey`; and
- a non-empty cancellation `reason`.

The Scheduler first persists `cancelling`, fences new work, cancels/reconciles
active Child AgentRuns and releases or settles known budget facts. It then
persists terminal `cancelled`. Only afterward does the adapter cancel an active
Workflow SDK driver and persist driver state as `cancelled`; a missing SDK Run
is persisted as `failed`. Audit identity is deterministic for idempotent API
replay.

`queued`, `running` and `cancelling` remain active projection states so Studio
continues polling through cancellation. Replaying the same request returns the
existing result; changing the reason under the same key is a conflict. A
terminal DelegationRun is never rewritten.

## Current exclusions

- No public service-account Agent API or externally supported SDK is published
  yet.
- Logical Run isolation and a compute-sandbox port exist, but provider-backed
  microVM/container/browser isolation is not yet claimed.
- Skill and MCP snapshots are frozen and least-authority checked, but arbitrary
  production Skill/MCP installation and execution are not yet claimed.
- A11 does not establish PPT readiness or whole-platform production readiness.

Canonical design is in `docs/internal/Agent优先创作与工作流模型.md` and
`docs/internal/Agent委托与调度协议.md`. A11 acceptance is in
`delivery/agent-orchestration-a11-continuation.md`.
