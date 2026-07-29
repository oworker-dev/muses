# Agent Orchestration A10 Evidence

This directory contains sanitized, deterministic evidence for the Muses-owned
delegation Scheduler. It contains no customer content, credentials or live
provider responses.

`fixed-evals-v1.json` freezes suite
`agent-orchestration-a10-recovery@1.0.0`. Its six cases drive the real
framework-neutral `DefaultAgentDelegationScheduler` and cover parallel DAG
aggregation, restart after an expired task lease, child-receipt recovery after
a budget-adapter outage, isolate failure mode, fail-fast cancellation and
ambiguous-cost review. Fixed ids, time, Profiles, child snapshots, budgets and
results keep provider and network calls at zero.

Run from the repository root:

```bash
pnpm run eval:agent-a10
```

The command fails when an assertion fails or when the generated report differs
from the committed evidence.

The isolated PostgreSQL Store, Child Runtime, driver and trace-lineage evidence
is produced separately by:

```bash
DATABASE_URL=postgresql://oworker:oworker@127.0.0.1:5432/oworker_saas \
  pnpm --filter ./src/apps/web run verify:agent-delegation-store
```

`real-provider-delegation.md` records the separate authenticated browser Gate
that uses the production model and image provider. It proves the first live
parallel Specialist result without committing provider payloads, credentials,
Run ids or Asset ids. Neither evidence surface claims a provider-backed
physical sandbox, production Skill/MCP resolution or durable aggregate-result
reinjection into the parent Agent.
