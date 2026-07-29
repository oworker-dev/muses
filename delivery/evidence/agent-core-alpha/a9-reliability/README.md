# A9 Reliability Evidence

Date: 2026-07-29

Environment: local PostgreSQL and Workflow SDK Postgres World with Studio at
`http://127.0.0.1:4730/studio`.

## Outcome

The driver-recovery, context-compaction, budget/billing,
approval/cancellation, isolation/tracing and fixed-eval slices passed. The A9
single-Agent reliability gate is complete.

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

The isolated PostgreSQL fixture applied all 11 migrations available to that
budget/billing slice in a disposable schema and proved duplicate fencing,
completed replay, expired claim reclaim,
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

External-effect tools now use a server-authoritative approval state rather than
inferring consent from chat. `image.generate` and `workflow.invoke` always
pause before execution and expose a bounded tool-input projection. Approval and
denial record the deciding member, identical decisions replay idempotently, and
conflicting decisions fail closed. Denial is returned to Agent context without
executing the tool. Workspace viewers cannot start, steer, follow up, approve,
deny or cancel, and execution rechecks that the original requester is still an
active non-viewer member before a child workflow or canvas mutation commits.

Agent cancellation now has a Muses-owned receipt and intent fence. One
idempotent request cancels the AgentRun and durable driver, discovers all child
Workflow SDK runs by `caller_kind = agent` and parent AgentRun id, cancels only
active children, and stores the resulting summary. Child submission and canvas
commands lock the same AgentRun authority, so a cancellation committed first
blocks later effects while a child committed first remains enumerable. Late
model output cannot revive a cancelled Run because its checkpoint conflicts
with the cancellation revision. Completed or failed child facts remain
truthful; known use settles once, definite no-use releases, and an interrupted
active provider call or unresolved reservation moves to `review_required`.

Every new AgentRun now freezes a logical sandbox scoped to its exact
Workspace, Project, Session and Run. The snapshot has a unique ephemeral
filesystem namespace, deny-by-default network policy, exact permissions and
tool surface, and pinned Skill/MCP versions, schemas and checksums. A
deterministic integrity fingerprint is validated again on Runtime reads;
persisted extension drift therefore fails closed with
`extension-snapshot-invalid` before model or tool execution. A Skill or MCP
connection cannot add a permission or tool outside the server-authoritative
Run profile.

The authenticated read-only trace uses AgentRun id as its root and joins Agent
events, stable model-call receipts, Operation Gateway commands, Agent child
workflows, Workflow SDK World runs/steps/events/correlation ids, generated
Assets, credit reservations and immutable ledger entries. Workflow World is
queried with `resolveData: none`; the projection omits prompts, model and tool
payloads, object keys, credential references, email addresses and provider
request details. AI SDK telemetry uses the stable `muses-agent-model` function
id, includes only non-sensitive correlation facts, and disables input/output
recording.

The versioned fixed suite drives the framework-neutral headless Runtime with
deterministic model, clock, ids, Store and tools. Its eight hard-gated cases
cover success, recoverable driver retry, policy refusal, budget rejection
before model execution, external-effect approval, cancellation against a late
model result, isolation snapshot drift and an unknown-tool no-side-effect
path. It makes no live provider or network call. The runner exits nonzero for
any failed assertion or any drift from the committed machine report.

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
pnpm --filter ./src/apps/web run verify:agent-cancellation
set -a; source .env.development; set +a
pnpm --filter ./src/apps/web run verify:agent-isolation-tracing
pnpm run eval:agent-a9
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'expired Agent driver claims'
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'MusesAgent generates a real image'
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'Agent cancellation stops linked Workflow SDK children'
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'discovers, inspects, and invokes one exact published workflow'
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts --grep 'Agent trace is Workspace-scoped'
```

- Domain: 39/39 tests passed.
- Agent Core: 35/35 tests passed.
- Agent Harness adapters: 3/3 tests passed.
- Web unit: 18/18 tests passed, including 9 model-receipt adapter cases.
- Recovery state-machine tests: 4/4 passed.
- Workflow validation: 203 files scanned, 2 workflow patterns, no serde issues.
- Production build, repository typecheck, migration application and targeted
  driver lint passed.
- Real Studio recovery probe: 1/1 passed. It covered an expired unbound claim
  and an expired attached claim whose SDK run was terminal; both replacement
  paths preserved zero model, image, workflow-child and credit side effects.
- Database migration `0010_agent_driver_lease.sql` was applied and its three
  columns plus lease constraint were verified through PostgreSQL metadata.
- Database migration `0011_agent_model_call_receipts.sql` was applied; the
  23-column receipt table and credit-reservation owner constraint were verified.
- Database migration `0012_agent_approval_cancellation.sql` was applied; the
  12-column cancellation receipt table and all three indexes were verified.
- Real PostgreSQL context probe passed with summary version 1, 26 source
  messages, 21 retained messages, one compaction event, 15 model calls, zero
  tool calls and zero credit usage.
- PostgreSQL approval/cancellation probe passed: denial executed zero tools;
  cancellation reached `cancelled`; exact replay returned the saved receipt;
  conflicting requester identity returned `idempotency-conflict`; a new child
  after cancellation returned `caller-inactive`; and the receipt completed
  without review-required usage.
- Real linked-child cancellation E2E passed in 0.845 seconds against the final
  build. It cancelled the registered Workflow SDK child and parent AgentRun,
  persisted one receipt and one `run.cancelled` event, replayed an identical
  request, and rejected a conflicting request with 409.
- Real OpenAI image approval E2E passed in 56.6 seconds. It observed a persisted
  `image.generate` approval before provider execution, approved it, produced
  exactly one Asset, then restored the image and moved canvas position after
  refresh.
- Exact published-workflow approval E2E passed in 19.5 seconds. The Agent used
  `workflow.list` and `workflow.inspect`, waited for approval on
  `workflow.invoke`, then invoked one immutable version with parent AgentRun
  lineage.
- The PostgreSQL isolation/tracing probe passed with 23 Agent events, 2 model
  calls, 1 Operation Gateway command, 1 child WorkflowRun, 2 Workflow World
  runs, 13 steps, 45 SDK events, 1 generated Asset, 1 credit reservation and 1
  ledger entry. Cross-Workspace Run and Asset access was denied, a tool input
  could not override verified scope, and a tampered extension snapshot failed
  closed. The sanitized projection contained none of the forbidden sensitive
  fields.
- The Agent trace authorization E2E passed in 0.230 seconds against Studio on
  port 4730: the owning Workspace received 200, a forged Workspace received
  404, and a foreign Run id received 404.
- Fixed Agent evals passed 8/8 hard-gated cases against suite version 1.0.0
  with fixture digest
  `sha256:db63243be92de8a4f2f886ca8b430df0634e471ad9351b435503d40eb9f4dd7c`.
  The committed report matched the runner exactly, with zero live provider and
  network calls.

## Boundaries and residual risk

This slice does not claim the provider offers exactly-once model execution.
When a crash prevents Muses from proving a post-provider outcome, the receipt
intentionally stops in review rather than retrying or silently accepting it;
operator reconciliation UI remains part of tracing/admin work. Live text-model
credit rates were zero in this environment, so the real image E2E created no
text-model ledger entries; nonzero single-settlement behavior is proven by the
isolated PostgreSQL fixture, while versioned text-model prices remain catalog
work. The current logical sandbox and compute-sandbox port do not provision a
physical or provider-backed process sandbox; code execution, browsers,
untrusted files and media-processing tools must remain disabled until that
boundary exists. The deterministic compactor bounds conversational history;
provider-specific tokenization and semantic-summary quality still need
model-profile evals. These are explicit next-stage risks rather than silent A9
claims; none invalidates the fixed single-Agent invariants proven by this Gate.

## Artifacts

- `README.md`: human-readable outcome, commands and limits.
- `results.json`: sanitized machine-readable facts without credentials,
  prompts, user identity or provider payloads.
- `fixed-evals-v1.json`: exact sanitized fixed-suite report checked by the A9
  runner.
