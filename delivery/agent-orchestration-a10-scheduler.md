# Agent Orchestration A10 Scheduler Gate

## Outcome

The second A10 slice implements the framework-neutral Scheduler state machine
and its first PostgreSQL durability boundary. It does not yet expose
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

## Verification

Run from the repository root with the local PostgreSQL service available:

```bash
pnpm --filter @muses/agent-core run check
DATABASE_URL=postgresql://oworker:oworker@127.0.0.1:5432/oworker_saas \
  pnpm --filter ./src/apps/web run verify:agent-delegation-store
pnpm run typecheck
git diff --check
```

The isolated PostgreSQL verification applies every product migration through
`0013`, creates a temporary Schema, verifies concurrent Store and budget
behavior, and removes the Schema afterward. The focused Agent Core suite has 72
passing tests in this slice.

## Remaining Gate

The persistent Scheduler task remains in progress until all of the following
exist and pass recovery evidence:

- a SHA-256 canonical fingerprint adapter;
- an exact-version Agent Profile Registry;
- JSON Schema, byte-size, evidence and Workspace Artifact result validation;
- a child Agent Core runtime adapter that creates an independent logical
  sandbox for every child Run;
- a Workflow SDK driver with durable attach, inspect, cancellation and restart
  recovery;
- delegation lineage in trace and billing projections;
- fixed Scheduler recovery evals.

This slice proves durable scheduling mechanics, not a provider-backed physical
sandbox, production multi-Agent execution, a domain Agent, or PPT readiness.
