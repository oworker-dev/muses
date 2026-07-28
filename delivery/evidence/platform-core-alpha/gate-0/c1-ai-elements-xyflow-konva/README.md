# C1: AI Elements + XYFlow + Konva

Date: 2026-07-26

This evidence package records the first runnable Platform Core Alpha loop. It
is a technical Spike, not a production release or a final renderer decision.

## Implemented loop

1. Open `/studio` and inspect the seeded `WorkflowDocument`.
2. Edit the creative brief through a `WorkflowCommand`.
3. Run the deterministic image capability and record one succeeded `Job`.
4. Materialize three image assets and provenance/dataflow branches.
5. Select one result through a human decision node.
6. Publish the selected asset into an independent `DesignDocument`.
7. Enter the Konva editor, edit text or move layers through
   `DocumentCommand`s, and return to the workflow projection.
8. Autosave locally, export structured Muses JSON, reload, and restore.

## Candidate versions

- Next.js `16.2.6`
- React `19.2.x`
- `@xyflow/react` `12.11.2`
- Konva `10.3.0`
- React-Konva `19.2.5`
- Vercel AI Elements Canvas behavior adapted as a repository-local projection
  primitive; AI Elements does not own Muses state.

## Evidence

- `@muses/domain`: seven passing tests for serialization, typed edge rejection,
  deterministic capability branches, separate workflow/design revisions,
  idempotency, structured variable references, compatible-variable filtering,
  and executable-cycle rejection.
- Browser: three passing Playwright paths for run, select, enter design, edit,
  export, reload, restore, light-theme inheritance, and the initial
  structured variable binding; output-port continuation with compatible-node
  filtering and an atomic node/edge Command sequence; plus pointer-time node
  movement before the persistent move Command is emitted.
- Production build: `/studio` compiles and is emitted by Next.js.

## Professional-mode revision

The first shell failed its human usability check because it exposed internal
schema concepts, expanded generated assets into graph noise, and lacked a live
controlled-node drag adapter. APCC `decision-4` records the correction.

- Professional mode directly uses Coze Studio commit `22275b1` as the UX
  baseline: an on-demand searchable node panel, 360px task nodes, click-to-open
  right-side configuration, bottom canvas tools, and a separate test-run
  action.
- Muses implements the interaction with React, AI Elements, XYFlow, shadcn,
  `next-intl`, and theme tokens. Flowgram, Coze forms, and Coze runtime state
  were not adopted.
- Generated image assets stay in the run-result gallery and do not
  automatically become visible graph nodes. Human review remains an explicit
  workflow step.
- Structured variables remain authoritative dataflow-edge projections, but the
  default UI shows source node and field labels rather than raw reference code.
- XYFlow owns ephemeral pointer-time positions through `onNodesChange`; release
  emits one `workflow.node.move` Command. Pointer frames do not execute the
  domain reducer or persistence path.
- The initial viewport keeps the first active slice readable, then remains
  user-controlled. Mouse and trackpad interaction modes are explicit.
- Revision, ids, positions, and command-level evidence are folded into
  developer details instead of dominating the normal configuration surface.
- Output-port `+` controls open a contextual continuation panel containing only
  nodes with compatible typed inputs. Adding one creates both the node and its
  dataflow edge through the standard Muses Command sequence.
- Image-node run details expose the resolved prompt, Job status, output count,
  timestamps, duration, Credits, and result gallery; raw Job and Asset ids stay
  in the developer-details disclosure.

## Current verdict

The combination is viable for continuing the functional Spike. It has not yet
passed the full Gate 0 performance, fault, accessibility, migration, undo/redo,
or real infrastructure requirements.

Current persistence is browser-local and the image capability is deterministic.
PostgreSQL/S3/Queue adapters and a real image provider are intentionally the
next slices rather than hidden behind this evidence.
