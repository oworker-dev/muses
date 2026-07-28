# Muses Domain

Framework-independent draft contracts and reducers for the Platform Core Alpha
live here. The current package deliberately contains no React, XYFlow, Konva,
database, queue, or provider types.

The current workflow contract includes protected singleton Start/End nodes,
typed Start inputs, derived output ports, typed executable edges, and a pure
`validateWorkflowForPublication()` gate. Runtime-generated image result nodes
are explicitly excluded from the published definition.

`compileWorkflowDefinition()` turns a valid `0.6.0-draft` editable document into
the separate `0.3.0-draft` definition schema. Image nodes persist a versioned
`modelRef`, one-way variable/fixed input intent, stable reference Asset ids, and
preset/custom output-size intent rather than a provider model enum, temporary
URL, or price. The compiled snapshot contains only execution semantics and
requires explicit workspace, definition, and version identity; it does not
retain layout, labels, renderer state, Job state, or result-gallery state.
`WorkflowRuntimePort` then defines typed, provider-neutral start, query, cancel,
resume, and retry operations without importing Workflow SDK types.

`resolveImageOutputSize()` is the pure Profile-driven legalization boundary for
continuous grids and discrete provider sizes. Migration
`0005_image_input_resolution_contract.sql` publishes the corresponding
`2026-07-28.1` GPT Image Profiles and adds persistent reference-image Asset
records; published earlier Profile rows are retired rather than rewritten.

`workflow-interpreter.ts` adds the framework-independent execution kernel for
compiled definitions. It resolves Start inputs and defaults, follows the frozen
execution order, resolves typed data bindings, validates node inputs and
outputs, commits immutable value state, exposes Selector suspension data,
validates human selections, and collects End outputs. Runtime executor functions
live only in an adapter-side registry and are never serialized into
`WorkflowExecutionState`.

`runWorkflowInterpreter()` and `continueWorkflowInterpreter()` are domain
Harness entry points for deterministic tests. The production Workflow SDK
adapter uses the same preparation, commit, selection, and completion helpers
around static `"use step"` effects and a server-side Hook.

Run `pnpm --filter @muses/domain check` to verify command, revision,
idempotency, typed-edge, publication, compilation, local deterministic
capability, two-document behavior, binding/type failures, unsupported nodes,
deterministic interpreter order, and suspension/resume behavior.
