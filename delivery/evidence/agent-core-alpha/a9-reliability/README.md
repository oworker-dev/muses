# A9 Reliability Progress Evidence

Date: 2026-07-29

Environment: local PostgreSQL and Workflow SDK Postgres World with Studio at
`http://127.0.0.1:4730/studio`.

## Outcome

The driver-recovery, context-compaction and budget/billing A9 slices passed.
The overall A9 gate remains in progress; approval/cancellation,
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

Model calls now have a Muses-owned receipt separate from Workflow driver
ownership. The stable identity is AgentRun id plus next turn and context
version. The receipt stores a request fingerprint, conservative Token/output
estimate, credit estimate, attempt lease, provider request id when available,
validated result and actual usage. Credits are reserved before provider work.
Completed results replay; expired pre-provider claims can be reclaimed;
expired calls that already crossed the provider boundary become ambiguous and
retain `review_required` funds; definite non-timeout 4xx rejection releases
once; timeout/network/5xx/unknown failure never auto-retries. Actual usage over
the reservation retains the result for review and is not silently completed.

The isolated PostgreSQL fixture applied all 11 migrations in a disposable
schema and proved duplicate fencing, completed replay, expired claim reclaim,
calling-lease ambiguity, definite failure idempotence, over-reservation review
and insufficient-balance rejection. Its known settlement posted 600 micros,
retained 1,100 reserved micros across the two review cases, and produced one
each of reserve/settle/release for the successful call. The schema was dropped
after verification, so the append-only development ledger was not polluted.

The first real image E2E exposed that ad-hoc Agent image definitions were
incorrectly persisted with published `version = 0`; PostgreSQL rejected both
child starts. That contract was fixed so ad-hoc children store null published
definition identity and explicit parent AgentRun caller lineage. A clean rerun
passed in 48.8 seconds: one AgentRun completed with two completed model receipts,
one tool call, one completed ad-hoc child WorkflowRun, one generated Asset and
one settled image reservation. Refresh and canvas position recovery passed.

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
pnpm --filter ./src/apps/web run verify:agent-billing
set -a; source .env.development; set +a
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'expired Agent driver claims'
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'MusesAgent generates a real image'
```

- Domain: 39/39 tests passed.
- Agent Core: 19/19 tests passed.
- Agent Harness adapters: 3/3 tests passed.
- Web unit: 18/18 tests passed, including 9 model-receipt adapter cases.
- Recovery state-machine tests: 4/4 passed.
- Workflow validation: 198 files scanned, 2 workflow patterns, no serde issues.
- Production build, repository typecheck, migration application and targeted
  driver lint passed.
- Real Studio recovery probe: 1/1 passed. It covered an expired unbound claim
  and an expired attached claim whose SDK run was terminal; both replacement
  paths preserved zero model, image, workflow-child and credit side effects.
- Database migration `0010_agent_driver_lease.sql` was applied and its three
  columns plus lease constraint were verified through PostgreSQL metadata.
- Database migration `0011_agent_model_call_receipts.sql` was applied; the
  23-column receipt table and credit-reservation owner constraint were verified.
- Real PostgreSQL context probe passed with summary version 1, 26 source
  messages, 21 retained messages, one compaction event, 15 model calls, zero
  tool calls and zero credit usage.

## Boundaries and residual risk

This slice does not claim the provider offers exactly-once model execution.
When a crash prevents Muses from proving a post-provider outcome, the receipt
intentionally stops in review rather than retrying or silently accepting it;
operator reconciliation UI remains part of tracing/admin work. Live text-model
credit rates were zero in this environment, so the real image E2E created no
text-model ledger entries; nonzero single-settlement behavior is proven by the
isolated PostgreSQL fixture, while versioned text-model prices remain catalog
work. Cancellation propagation to child WorkflowRuns, approval UX, full
tracing, isolation evals and fixed eval bundles remain separate A9 tasks. The
deterministic compactor bounds conversational history; provider-specific
tokenization and semantic-summary quality still need model-profile evals.

The local server still emits a known `pg@9` query-concurrency deprecation
warning during Workflow/Postgres activity. It is recorded as an A9 diagnostic
item and is not treated as silent recovery success.

## Artifacts

- `README.md`: human-readable outcome, commands and limits.
- `results.json`: sanitized machine-readable facts without credentials,
  prompts, user identity or provider payloads.
