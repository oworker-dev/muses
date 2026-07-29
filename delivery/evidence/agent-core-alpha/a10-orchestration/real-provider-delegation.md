# Real Provider Delegation Evidence

## Scope

On 2026-07-30 an authenticated Muses Studio browser run asked the platform
MusesAgent to create two independent product-poster concepts in parallel. The
run used the configured production text model, the real image provider and two
`muses-image-specialist@0.1.0-alpha` Child AgentRuns.

No credential, provider response body, Prompt transcript, Run id, Asset id or
customer content is committed in this evidence.

## Gate

```bash
OWORKER_WEB_URL=http://127.0.0.1:4730 \
  pnpm exec playwright test tests/e2e/muses-studio.spec.ts \
  --grep 'delegates parallel image work'
```

Final result: `1 passed (1.5m)`.

The gate verified:

- the root Agent requested the approval-gated `agent.delegate` tool;
- the Scheduler accepted two dependency-free tasks with concurrency two;
- two independent Child AgentRuns each requested `image.generate` approval;
- approving each exact Child Run resumed its own external operation;
- both tasks completed with one authorized Asset reference each;
- the Operation Gateway canvas contained both generated Assets;
- the root trace contained three AgentRuns, one DelegationRun and both Assets;
- Specialist task state and aggregate result count restored after refresh.

## Budget Finding

The first post-migration attempt was correctly rejected because the model gave
both tasks four turns, consuming an aggregate eight-turn envelope after the
parent had already used one of its eight turns. The product fix did not weaken
validation or hard-code the E2E Prompt. `agent.delegate` now projects a
deterministic parent-budget snapshot, explains per-field aggregation, provides
a conservative standard one-image budget and reserves its own parent tool call.
Focused regression tests cover that projection and reservation.

## Boundaries

This proves the first real provider-driven multi-Agent image outcome. The root
Agent currently finishes after delegation acceptance while Studio observes the
Scheduler independently. Validated aggregate results are not yet durably
injected into the parent context for a final synthesis turn. Provider-backed
physical compute isolation, production Skill/MCP resolution, arbitrary domain
Agents, DelegationRun cancellation after root completion and user-facing
whole-tree cost detail also remain outside this Gate.
