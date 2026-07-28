# A7 Single-Agent Image Loop Evidence

Date: 2026-07-29

Environment: local PostgreSQL, Valkey and MinIO with Studio at
`http://127.0.0.1:4730/studio`

## Outcome

An authenticated user described one image in natural language. Muses Agent
Core persisted the run, called `openai/gpt-5.6-sol`, requested
`image.generate`, reused the existing paid image workflow, and placed the
resulting Asset into the authoritative `CreativeCanvas` through the Operation
Gateway. Studio opened in creative mode, rendered the Asset as a movable canvas
object, persisted a drag through `creative.item.put`, and restored the run,
image and position after refresh.

At capture time, the real run used two model calls, one tool call, 2,266 input tokens and 233
output tokens. It produced one `1024 x 1536` PNG. The Agent run reached revision
6 with 16 ordered events and a completed three-step ExecutionPlan. The canvas
reached revision 2 after the matching Asset item was moved.

No provider credential, signed object URL, user email, or private model
response is stored in this evidence package.

`AgentRun` terminal state is intentionally reopenable by follow-up. A later
steering probe reused this Run and changed its current status; the captured
creative result remains valid, while the subsequent state is recorded in
`../a7-steering-loop/` rather than being presented as a still-terminal Run.

## Proven

1. Agent Run and Event state persists in PostgreSQL with continuous event
   sequence and revision compare-and-swap.
2. AI SDK preserves assistant tool calls and tool results across the second
   model turn; dotted Muses tool names use reversible provider-safe aliases.
3. Workflow SDK Postgres World drives durable execution events while Muses
   PostgreSQL remains the authoritative Agent, canvas and Asset state.
4. `image.generate` reuses the model catalog, credit reservation, image
   workflow, object storage and Operation Gateway instead of writing canvas
   state directly.
5. The generated Asset ID in the Agent tool result matches one
   `CreativeCanvas.items[].refId`; its object key, dimensions, media type,
   model, prompt and Workflow/Node/Step provenance are also recorded in the
   Muses-owned generated Asset table.
6. The authenticated Studio API and Agent panel start, inspect, cancel,
   steer/follow-up and restore a run; the real browser gate covers start,
   completion, canvas persistence and refresh restoration.
7. Studio defaults to the creative projection, shows a movable real Asset and
   an expandable persisted ExecutionPlan, and keeps professional mode available
   as a separate projection.
8. Desktop `1440 x 960` and mobile `390 x 844` captures render a nonblank real
   image without page overflow or text/control overlap. Both rendered image
   instances report natural dimensions of `1024 x 1536`.
9. Generated-image authorization reads the Muses Asset record and object store,
   not Workflow SDK `returnValue`, so the product Asset does not inherit the
   Workflow World lifecycle.

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
- Workflow validation scanned 189 files, found two workflow entries and no
  serialization issues.
- The Web production build and APCC doctor passed. Targeted lint for the A7
  files passed; full Web lint still reports the pre-existing
  `muses-studio.tsx` React Hooks baseline (7 errors, 4 repository warnings).
- Real Playwright gate: 1/1 passed in about 38 seconds.
- Visual replay of the latest completed run confirmed the creative canvas,
  Agent panel, ExecutionPlan, real image and responsive viewport bounds.

## Not Proven

- The persisted three-step plan proves plan ownership and projection for the
  image loop; it is not yet a general editable planning interface.
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
