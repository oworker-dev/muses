# Agent Orchestration A10 Contract Gate

## Outcome

The first A10 slice freezes the framework-neutral delegation boundary before a
production scheduler or multi-Agent product is introduced. The canonical
architecture is `docs/internal/Agent委托与调度协议.md`.

The implemented `@muses/agent-core` contract now provides:

- immutable direct-parent and root-Run lineage, exact plan revision and task id
  on every delegated AgentRun;
- independent Run-scoped logical sandbox validation for child Runs;
- a versioned delegation Plan, Task, server AuthoritySnapshot, ContextPackage,
  Grant, budget, result and scheduler-port contract;
- pure validation for scope, limits, deterministic acyclic task order, explicit
  context, delegated capabilities and aggregate budget;
- submission and child-submission receipt types for future idempotent scheduler
  persistence;
- sanitized parent lineage in the authenticated Agent trace projection.

This slice does not claim a persistent Runtime Scheduler, concurrent child
execution, a Profile Registry, a production MusesAgent, a domain Agent, a
provider-backed compute sandbox or cancellation propagation across an actual
multi-Agent tree. Those remain subsequent A10 tasks.

## Acceptance matrix

| Contract area | Required invariant | Evidence | Status |
| --- | --- | --- | --- |
| Identity | root Run, direct parent Run, plan id/revision and task id are immutable child start identity | Headless runtime replay/conflict tests | Passed |
| Run isolation | child gets its own `agent-run/<childRunId>` namespace and parent-scoped logical sandbox; restore revalidates the same scope | Headless runtime child inspect test | Passed |
| DAG | non-empty bounded tasks, unique ids, valid dependencies, no self edge/cycle, deterministic order | Delegation validator tests | Passed |
| Authority | all grants are explicit subsets of server permissions, tools, Skills, MCP connections and compute capabilities | Delegation escalation table tests | Passed |
| Context | exact parent Run/Context version, bounded explicit facts, allowed classifications and authorized Artifact refs only | Context invalid/not-granted tests | Passed |
| Result | JSON object Schema, result byte ceiling and non-empty unique evidence kinds | Result-contract test | Passed |
| Budget | valid child limits and conservative aggregate envelope fit parent remaining authority; malformed server values fail as data | Budget invalid/exceeded/BigInt regression tests | Passed |
| Runtime scheduler | durable plan submission, budget reservation, task claim/lease, child receipts, result aggregation and linked cancellation | Core state machine and PostgreSQL durability are recorded in `delivery/agent-orchestration-a10-scheduler.md`; production adapters remain | In progress |

## Framework boundary evidence

The architecture was checked against the installed package documentation, not
generic framework assumptions:

- `eve@0.27.8`: child sessions do not inherit parent history, task mode can
  return structured output, cancellation propagates to active descendants, and
  declared specialists own separate authored surfaces. Muses intentionally does
  not reuse Eve's shared root-copy sandbox behavior.
- `workflow@4.6.2`: direct child workflow calls flatten into a parent run, while
  background children are started from a Step and receive independent SDK run
  ids. Step retry and SDK run identity do not replace Muses idempotency, budget,
  authorization, cancellation or sandbox contracts.

## Repeatable verification

Run from the repository root:

```bash
pnpm --filter @muses/agent-core run check
pnpm run check:platform-core
pnpm run typecheck
git diff --check
apcc doctor check
```

The contract-slice Agent Core suite contained 62 passing tests, including the
new delegation protocol and child lineage cases. Platform-wide counts belong to
the final verification output for the commit and should not be frozen here.

## Next gate

Implement the Muses-owned persistent Scheduler before enabling model-driven
multi-Agent execution: exact Profile resolution, transactional aggregate and
per-child budget reservations, submission/child receipts, task rows with
claim/lease, Workflow SDK adapter, failure modes, linked cancellation, result
and evidence validation, trace/billing lineage, and fixed recovery evals. The
platform-level MusesAgent may propose plans only through this boundary.
