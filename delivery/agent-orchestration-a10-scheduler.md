# Agent Orchestration A10 Scheduler Gate

## Outcome

The current A10 slices implement the framework-neutral Scheduler state machine,
its PostgreSQL durability boundary, and the production Profile, fingerprint,
result-validation and Artifact-authorization adapters. They do not yet expose
model-driven delegation or production multi-Agent execution.

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
`0014`, creates temporary Schemas, verifies concurrent Store/budget behavior and
legacy Asset backfill/project isolation, and removes the Schemas afterward. The
focused Agent Core suite has 72 passing tests and the Web suite has 26 passing
tests in this slice.

## Remaining Gate

The persistent Scheduler task remains in progress until all of the following
exist and pass recovery evidence:

- a child Agent Core runtime adapter that creates an independent logical
  sandbox for every child Run;
- a Workflow SDK driver with durable attach, inspect, cancellation and restart
  recovery;
- delegation lineage in trace and billing projections;
- fixed Scheduler recovery evals.

This slice proves durable scheduling mechanics, not a provider-backed physical
sandbox, production multi-Agent execution, a domain Agent, or PPT readiness.
