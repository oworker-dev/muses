# Agent Orchestration A10 Scheduler Gate

## Outcome

The current A10 slices implement the framework-neutral Scheduler state machine,
its PostgreSQL durability boundary, the production Profile, fingerprint,
result-validation and Artifact-authorization adapters, an independent Child
Agent Runtime, and the Workflow SDK durable driver. They do not yet expose an
authorized model-driven delegation entry point or production multi-Agent
execution.

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
  scopes, duplicate fencing, and only the current MusesAgent Profile registered
  by default;
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
passing tests and the Web suite has 35 passing tests in this slice; Workflow
validation scans 216 files with no serde errors.

## Remaining Gate

The persistent Scheduler task remains in progress until all of the following
exist and pass recovery evidence:

- delegation lineage in trace and billing projections;
- fixed Scheduler recovery evals;
- an authorized delegation entry point/tool that can submit a validated plan
  and ensure its durable driver without granting the model Scheduler authority.

This slice proves durable scheduling and Child Agent composition mechanics. It
does not prove a provider-backed physical sandbox, production Skill/MCP
resolution, production multi-Agent execution, a domain Agent, or PPT readiness.
