# A7 Single-Agent Image Loop Evidence

Date: 2026-07-29

Environment: local PostgreSQL, Valkey and MinIO with Studio at
`http://127.0.0.1:4730/studio`

## Outcome

An authenticated user described one image in natural language. Muses Agent
Core persisted the run, called `openai/gpt-5.6-sol`, requested
`image.generate`, reused the existing paid image workflow, and placed the
resulting Asset into the authoritative `CreativeCanvas` through the Operation
Gateway. The Studio restored the completed run and image after refresh.

The real run used two model calls, one tool call, 2,271 input tokens and 289
output tokens. It produced one `1024 x 1536` PNG. The Agent run reached revision
6 with 14 ordered events and the canvas reached revision 1 with one matching
Asset item.

No provider credential, signed object URL, user email, or private model
response is stored in this evidence package.

## Proven

1. Agent Run and Event state persists in PostgreSQL with continuous event
   sequence and revision compare-and-swap.
2. AI SDK preserves assistant tool calls and tool results across the second
   model turn; dotted Muses tool names use reversible provider-safe aliases.
3. Workflow SDK drives a Node step while Muses PostgreSQL remains the
   authoritative Agent state.
4. `image.generate` reuses the model catalog, credit reservation, image
   workflow, object storage and Operation Gateway instead of writing canvas
   state directly.
5. The generated Asset ID in the Agent tool result matches one
   `CreativeCanvas.items[].refId`.
6. The authenticated Studio API and Agent panel start, inspect, cancel,
   steer/follow-up and restore a run; the real browser gate covers start,
   completion, canvas persistence and refresh restoration.
7. Desktop and mobile captures render a nonblank real image without text
   overlap inside the Agent panel.

## Verification

```bash
pnpm run check:platform-core
pnpm run typecheck
pnpm --filter ./src/apps/web exec workflow validate
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts -g "MusesAgent generates a real image"
```

- Domain: 39/39 tests passed.
- Agent Core: 9/9 tests passed.
- Agent Harness adapters: 3/3 tests passed.
- Repository type checks passed.
- Workflow validation scanned 185 files, found two workflow entries and no
  serialization issues.
- Real Playwright gate: 1/1 passed in 43.9 seconds.

## Not Proven

- The generated Asset is persisted in `CreativeCanvas`, but the current Studio
  still shows the professional workflow canvas; a movable creative-canvas
  projection is not yet delivered.
- The three visible stages are a run projection, not a complete editable
  `ExecutionPlan`.
- Steering/follow-up and approval have API/Core support, but the real browser
  gate does not yet cover them and Studio has no approval decision UI.
- Cancelling an Agent Run does not yet cancel an already-running child image
  workflow.
- Text-model credit rates default to zero until Agent model pricing is sourced
  from the versioned model catalog.
- A9 restart, compaction, isolation, trace and fixed-eval gates remain pending.

## Artifacts

- `results.json`: structured verification facts and explicit limitations.
- `studio-agent-result-desktop.png`: restored desktop result.
- `studio-agent-result-mobile.png`: restored mobile result.
