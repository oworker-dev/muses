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

That retry also exposed raw provider diagnostics in the persisted failure
message. Agent Core now maps model-adapter exceptions to a stable public
`model-failed` message before committing the Run or event, and the Web API
redacts matching historical failures. A second controlled provider retry moved
the Run from revision 13 to 17 and failed at the same external boundary. The
public snapshot and all 36 projected events contained no provider balance or
request id; model calls, image calls, Muses credit and canvas state again stayed
unchanged.

The static canvas issue exposed during review was also corrected: generated
follow-up Assets now use a collision-aware placement policy that prefers the
right side of the latest result, preserving a comparison row instead of
reusing `(120, 120)`.

After provider credit was restored, the same Run resumed from revision 17 and
completed at revision 31 with ExecutionPlan revision 5. The Agent first
inspected the canvas, then made one `image.generate` attempt with an invalid
reference Asset id. That attempt failed before a WorkflowRun, reservation,
provider image call or canvas mutation existed. The Agent corrected its own
input and made one successful image request. Exactly one image WorkflowRun,
one generated Asset, one canvas item and one 1,000,000-microcredit charge were
created.

The new `1024 x 1536` Asset was placed at `(577.67, 156.84)`, immediately to
the right of the existing Asset at `(193.67, 156.84)`. A real Chinese-locale
browser session decoded both images, found no overlap, refreshed Studio and
restored the completed Run, both Assets, CreativeCanvas revision 3 and the
same positions. Prompt content and the ignored local screenshot are not stored
in this evidence package.

## Verification

```bash
pnpm --filter @muses/agent-core run check
pnpm --filter ./src/apps/web run test:unit
pnpm --filter ./src/apps/web run typecheck
```

- Agent Core: 11/11 tests passed.
- Web projection and creative placement: 5/5 tests passed.
- Web typecheck, targeted lint, Workflow validation and production build
  passed.
- Real browser follow-up and refresh acceptance passed against
  `http://127.0.0.1:4730/studio`.

## Gate Result

A7 steering is complete. The evidence proves:

1. the follow-up revised and completed the persisted ExecutionPlan;
2. one real revised image was generated and charged once;
3. the new Asset appeared beside the previous result without overlap;
4. refresh restored both Assets, their positions and the completed Run;
5. model/image usage, Muses credit, authorization and error-sanitization
   continuity remained intact.

A8 callable workflow publication and the A9 reliability Gate remain separate
tasks. This evidence does not claim context compression, process-failure
recovery, approval UI, cancellation propagation, full tracing or fixed evals.
