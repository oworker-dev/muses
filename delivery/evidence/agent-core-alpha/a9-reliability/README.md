# A9 Reliability Progress Evidence

Date: 2026-07-29

Environment: local PostgreSQL and Workflow SDK Postgres World with Studio at
`http://127.0.0.1:4730/studio`.

## Outcome

The driver-recovery and context-compaction A9 slices passed. The overall A9
gate remains in progress; budget/billing, approval/cancellation,
isolation/tracing and the fixed eval bundle are still blocking.

Agent driver ownership is now Muses-owned rather than inferred from a nullable
Workflow SDK run id:

- a claim contains an opaque attempt id, an expiring lease and a heartbeat;
- a durable driver self-attaches its SDK run id in the first step, before
  Agent model or tool work;
- attach, renew, release and finish are conditional on the attempt id and SDK
  run id, so a delayed old workflow cannot execute after a reclaim;
- an expired unbound claim is replaced directly;
- an expired bound claim is reconciled against the SDK status, renewed while
  pending/running, and replaced only after a terminal SDK status;
- authorized Studio polling performs read repair so a refresh or a Web
  process restart can recover persisted Agent state without client ownership.

The driver fixture intentionally exhausted the model-call budget before
recovery. Both the unbound-claim and stale-attached-terminal probes therefore
failed before provider/model work. Each produced a new driver and a failed
AgentRun with zero model-completed events, child workflow runs, generated
assets and credit reservations.

Long Agent sessions now compact across separate high and retained watermarks:

- automatic compaction triggers above 24 messages or 48K characters and
  targets 16 messages and 32K characters;
- system, recent and pending-tool source messages remain verbatim;
- current plan, permissions, budget, artifacts, pending actions and omitted
  tool results remain structured facts;
- ordinary conversation rolls into one bounded 16K-character history fact;
- synchronous and asynchronous compactors are replaceable, but Agent Core
  validates source/version/retention/authority before commit and renders the
  structured facts into model input itself.

The PostgreSQL fixture completed 14 deterministic turns, rebuilt the Runtime
over the same Store and completed turn 15. It compacted once from 26 source
messages, ended with 21 retained messages, preserved a 720-character history,
and kept plan, permissions, tool usage and credit usage unchanged. It executed
no external model or tool and cleaned up its persisted fixture.

## Verification

```bash
pnpm run check:platform-core
pnpm run typecheck
pnpm --filter ./src/apps/web run build
pnpm --filter ./src/apps/web exec workflow validate
pnpm --filter ./src/apps/web run test:unit
set -a; source .env.development; set +a
pnpm --filter ./src/apps/web run verify:agent-context
set -a; source .env.development; set +a
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'expired Agent driver claims'
```

- Domain: 39/39 tests passed.
- Agent Core: 17/17 tests passed.
- Agent Harness adapters: 3/3 tests passed.
- Web unit: 9/9 tests passed.
- Recovery state-machine tests: 4/4 passed.
- Workflow validation: 196 files scanned, 2 workflow patterns, no serde issues.
- Production build, repository typecheck, migration application and targeted
  driver lint passed.
- Real Studio recovery probe: 1/1 passed. It covered an expired unbound claim
  and an expired attached claim whose SDK run was terminal; both replacement
  paths preserved zero model, image, workflow-child and credit side effects.
- Database migration `0010_agent_driver_lease.sql` was applied and its three
  columns plus lease constraint were verified through PostgreSQL metadata.
- Real PostgreSQL context probe passed with summary version 1, 26 source
  messages, 21 retained messages, one compaction event, 15 model calls, zero
  tool calls and zero credit usage.

## Boundaries and residual risk

This slice does not claim provider model calls are exactly once. A process can
still fail after a provider response and before the Agent checkpoint commits;
provider idempotency or a durable model request receipt remains an explicit
budget/billing risk. Cancellation propagation to child WorkflowRuns, approval
UX, full tracing, isolation evals and fixed eval bundles remain separate A9
tasks. The deterministic compactor bounds conversational history; provider-
specific tokenization and semantic-summary quality still need model-profile
evals before production-scale context limits can be claimed.

The local server still emits a known `pg@9` query-concurrency deprecation
warning during Workflow/Postgres activity. It is recorded as an A9 diagnostic
item and is not treated as silent recovery success.

## Artifacts

- `README.md`: human-readable outcome, commands and limits.
- `results.json`: sanitized machine-readable facts without credentials,
  prompts, user identity or provider payloads.
