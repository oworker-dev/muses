# A7 Agent Steering Loop Evidence

Date: 2026-07-29

## Outcome

A real follow-up was submitted to the completed AgentRun used by the creative
canvas evidence. The first attempt failed before any model call because the
Run's duration budget incorrectly counted the idle interval since initial
creation. Muses credit, image workflows and CreativeCanvas revision did not
change.

Agent Core now starts a fresh continuous-execution duration window whenever a
terminal Run accepts follow-up, while preserving cumulative model, tool, token
and credit usage. A regression test crosses an idle interval longer than
`maxDurationMs` and completes the follow-up under the same cumulative budget.

The real retry passed that guard and reached the language-model adapter. The
external provider then rejected preauthorization because its account balance
was insufficient. No model usage was committed, `image.generate` was not
called, Muses credit remained unchanged and the canvas stayed at the same
revision. Provider request ids, balances, credentials, email and prompt content
are not stored here.

The static canvas issue exposed during review was also corrected: generated
follow-up Assets now use a collision-aware placement policy that prefers the
right side of the latest result, preserving a comparison row instead of
reusing `(120, 120)`. This policy has unit evidence but not yet real-image
evidence.

## Verification

```bash
pnpm --filter @muses/agent-core run check
pnpm --filter ./src/apps/web run test:unit
pnpm --filter ./src/apps/web run typecheck
```

- Agent Core: 10/10 tests passed.
- Creative placement: 3/3 tests passed.
- Web typecheck and targeted lint passed.

## Remaining Gate

After upstream model credit is available, rerun the same user path and require
all of the following before completing this task:

1. the follow-up revises and completes the persisted ExecutionPlan;
2. one real revised image is generated and charged once;
3. the new Asset appears beside the previous result without overlap;
4. refresh restores both Assets, their positions and the completed Run;
5. the evidence records model/image usage and Muses credit continuity without
   provider secrets.
