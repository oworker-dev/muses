# Agent Orchestration A10 Scheduler Gate

## Outcome

The current A10 slices implement the framework-neutral Scheduler state machine,
its PostgreSQL durability boundary, production Profiles, fingerprint,
result-validation and Artifact-authorization adapters, an independent Child
Agent Runtime, the Workflow SDK durable driver, whole-tree trace/billing
lineage, fixed recovery evals and an authorized model-driven delegation entry
point. Real provider-driven multi-Agent creative acceptance remains separate.

Implemented in `@muses/agent-core`:

- revision-based Scheduler state and event ports;
- aggregate and per-task logical budget reservations;
- bounded DAG concurrency with claim/lease recovery;
- child submission receipts persisted before external start;
- stable child AgentRun identity on replay;
- Profile grant revalidation;
- structured result-validation adapter boundary;
- `isolate` and `fail-fast` failure modes;
- explicit linked cancellation and terminal aggregation;
- recovery that can reconcile a completed sibling while another child remains
  running.

Implemented in the Web PostgreSQL adapter:

- idempotent delegation creation by Workspace and request key;
- revision CAS with gap-free event sequences;
- exact Workspace, Project, Session, root Run and direct-parent Run foreign-key
  scope;
- parent-Run locking for concurrent delegation envelope allocation;
- envelope locking for concurrent task allocation;
- persisted reservation and finalization idempotency identities;
- task-finalization fencing before an envelope can settle;
- safe integer and BigInt budget arithmetic without a second credit-ledger
  charge.

Implemented in the production composition boundary:

- deterministic SHA-256 fingerprints over strict canonical JSON, including
  stable object-key order and explicit rejection of cyclic or non-JSON input;
- exact Profile id/version resolution with optional Workspace and Project
  scopes and duplicate fencing;
- the platform `muses-agent@0.1.0-alpha` Profile and least-authority
  `muses-image-specialist@0.1.0-alpha` Profile, whose only tool is real image
  generation;
- AJV JSON Schema validation, result byte limits, required evidence checks and
  replaceable evidence authorization;
- fail-closed generated-Asset authorization at exact Workspace and Project
  scope;
- authoritative Project propagation from published Workflow ownership and
  Agent execution context into real image generation;
- migration `0014`, which backfills provable Workflow/Agent Asset ownership,
  preserves unverifiable legacy orphans as `NULL`, and requires all new
  application writes to carry Project scope;
- explicit Child Runtime injection: the composition root cannot substitute a
  placeholder for independent child Agent execution.

Implemented at the authorized product entry:

- approval-gated `agent.delegate` as an `external` Agent tool;
- model input limited to task DAG, explicit context, exact Profile, narrowed
  grants, budget and result contracts;
- Workspace, Project, Session, root/direct-parent Run, depth, Context version,
  policy and remaining budget derived from the current persisted AgentRun;
- pure validation before Scheduler submission, stable tool-call idempotency and
  durable-driver recovery after acceptance;
- no code, CLI, browser or untrusted-file grant while a physical compute
  sandbox is absent.

Implemented in trace and eval evidence:

- one root-scoped trace projection for root/child AgentRuns, DelegationRuns,
  tasks, Profiles, logical sandboxes, events, model/tool/workflow/Asset facts,
  logical budget reservations and the existing real credit ledger;
- no Prompt, context fact values, result bodies, credentials, idempotency keys
  or hidden reasoning in the public projection;
- fixed A10 suite `agent-orchestration-a10-recovery@1.0.0`, with six passing
  deterministic cases and zero provider/network calls.

Implemented in the Child Agent Runtime adapter:

- one distinct `AgentRun` and one distinct logical sandbox per child task;
- exact root/direct-parent and Workspace/Project/Session authority checks;
- least-authority grant application without arbitrary parent metadata
  inheritance;
- immutable child-start fingerprint including the result contract;
- idempotent replay and queued/running child-driver self-healing;
- terminal structured-result projection from the final assistant message;
- Agent usage and ambiguous billing-outcome projection;
- cancellation through the existing authorized Agent tree boundary.

Implemented in the Workflow SDK driver:

- migration `0015` for driver attempt, SDK run, status, heartbeat and lease;
- PostgreSQL-fenced claim, attach, renew, release, reclaim and finish;
- stale attachment inspection before replacement, so a still-active SDK run is
  renewed instead of duplicated;
- a durable `resume Scheduler -> sleep(2s) -> resume` loop whose Node/database
  work remains inside `"use step"` functions;
- inspection and cancellation composition without moving Scheduler authority
  into Workflow World;
- dependency separation that lets pure PostgreSQL/Agent adapter verification
  exit without opening Workflow SDK event listeners.

## Verification

Run from the repository root with the local PostgreSQL service available:

```bash
pnpm --filter @muses/agent-core run check
DATABASE_URL=postgresql://oworker:oworker@127.0.0.1:5432/oworker_saas \
  pnpm --filter ./src/apps/web run verify:agent-delegation-store
DATABASE_URL=postgresql://oworker:oworker@127.0.0.1:5432/oworker_saas \
  pnpm --filter ./src/apps/web run verify:generated-asset-scope
pnpm run check
pnpm --filter ./src/apps/web exec workflow validate
apcc doctor check
git diff --check
```

The isolated PostgreSQL verification applies every product migration through
`0015`, creates temporary Schemas, verifies concurrent Store/budget behavior,
legacy Asset backfill/project isolation, driver ownership/recovery and the full
Scheduler + Child Runtime aggregation path, and removes the Schemas afterward.
It exits naturally after verification. The focused Agent Core suite has 72
passing tests and the Web suite has 39 passing tests in this slice; Workflow
validation scans 220 files with no serde errors.

## Remaining Product Gate

The persistent Scheduler engineering Gate is complete. The next gate is one
authenticated real creative delegation using the production model, the image
specialist and actual image provider. It must prove the user can understand and
approve child work, resume after refresh, receive the validated Asset result,
and inspect whole-tree cost/trace facts. This slice does not prove a
provider-backed physical sandbox, production Skill/MCP resolution, arbitrary
domain Agents, or PPT readiness.
