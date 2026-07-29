# Platform Core Alpha Delivery

## Outcome

Platform Core Alpha has delivered the first reusable image, identity/credit, durable-runtime, model-catalog, and observability foundation. APCC decision `agent-first` moves the engineering critical path to Agent Core before any PPT scenario MVP; product-owner first-image acceptance remains parallel evidence.

The measurable product contract is `docs/internal/平台核心Alpha需求与体验预算.md`. Candidate stacks and implementations must use its shared fixture, scale profiles, reference environment, and failure cases.
The authoritative professional-node product catalog is `docs/internal/专业模式节点产品目录.md`; it separates user-facing definition nodes from result projections and Workflow SDK primitives, and it must be updated with every node semantic change.
APCC decision `agent-first` supersedes the earlier post-image sequencing in
`decision-5`. The current critical path is documented in
`docs/internal/Agent优先创作与工作流模型.md`: freeze the product/call contracts,
deliver the Operation Gateway and independent Agent Core, then pass the
single-Agent reliability gate before orchestration and scenario MVP work.
The candidate matrix is `docs/internal/画布Alpha最小技术栈基线.md`; the executable comparison plan is `docs/internal/两层画布技术Spike计划.md`.
The cross-layer SDK and future Agent Harness boundaries are recorded in `docs/internal/平台技术栈与AgentHarness路线.md`.

## Critical Path

1. Preserve the verified real-image, identity/credit, model-catalog, and Workflow SDK paths as reusable Agent tools.
2. Separate `CreativeCanvas`, `ExecutionPlan`, `ProfessionalWorkspace`, and `WorkflowDefinition` identities.
3. Replace browser authority with a revisioned server-side Query/Command/Capability gateway.
4. Deliver a framework-neutral, independently runnable Agent Core with Skill, MCP, sandbox, budget, approval, and recovery ports.
5. Pass the single-Agent canvas and reliability gates, then add minimum orchestration.
6. Enter PPT only after those gates; keep product-owner first-image acceptance as a parallel evidence task.

## Alpha Gate

- Outer workflow state and inner professional-document state have separate authoritative documents and revisions.
- Context, provenance, association, dataflow, and control edges cannot be confused.
- A professional document exposes typed ports and previews without leaking internal layers into the outer graph.
- Users can create an input, run image capabilities, observe/cancel/retry jobs, compare branches, select a result, edit it in `DesignDocument`, and recover after refresh.
- Query, Command, and Capability ports can reproduce all persistent UI actions without DOM or pointer simulation.
- Each claimed kernel has an independent Harness, versioned contracts, failure tests, migration evidence, and a real adapter where applicable.

## Deferred

PPTX, image-to-editable-SVG, video/audio timelines, realtime collaboration, arbitrary code plugins, plugin markets, and service splitting remain deferred. Agent Harness selection is no longer deferred from the overall roadmap, but it remains outside Platform Core and behind Muses-owned Agent contracts. The narrow Workflow SDK interpreter remains reusable evidence rather than the default creative-canvas model.

## Current implementation evidence

The first runnable C1 loop is recorded at
`delivery/evidence/platform-core-alpha/gate-0/c1-ai-elements-xyflow-konva/`.
It proves the draft Command/revision boundary and the browser path from a
typed Start input through local deterministic image branches into an enterable Konva
`DesignDocument`, local restore, and structured export. Performance, fault,
accessibility, real provider, and real infrastructure gates remain open.

The first interaction shell failed its human usability check: nodes exposed too
much internal structure, result assets expanded into graph noise, and controlled
XYFlow nodes did not maintain a dedicated live drag state. APCC `decision-4`
therefore requires two projections over one `WorkflowDocument`, with the
lossless professional mode delivered first and the simplified creative mode
deferred.

The revised professional shell directly uses the Apache-2.0 Coze Studio editor
at commit `22275b1` as its UX baseline while retaining the Muses stack. It now
uses an on-demand searchable node panel, 360px task-oriented nodes, a selected
node configuration side sheet, a bottom interaction/zoom/add toolbar, and a
separate test-run action. Generated assets are consumed through the run-result
gallery instead of automatically becoming visible graph nodes. XYFlow owns
ephemeral pointer-time positions and emits one Muses move Command on release;
the authoritative workflow remains library-independent. No Flowgram, Coze form
runtime, or Coze domain model was adopted. Workflow SDK is now integrated only
as a backend durable execution adapter; it does not own canvas or interaction
state.

The second professional-mode slice added Coze-style continuation from output
ports without adopting Coze runtime state. Clicking a port `+` opens a compact
contextual node library filtered by the source value type. Adding a compatible
node places it beside the source and atomically applies `workflow.node.add`
followed by `workflow.edge.add`; the resulting binding is immediately rendered
as `source node · field`. The image-node Side Sheet now separates configuration
from run evidence and shows the resolved prompt, Job status, output count,
timestamps, duration, Credits, and the Asset result gallery while folding raw
Job/Asset ids into developer details. Gate 1.1 supersedes that last UI choice:
raw developer identifiers leave the default inspector, input sources move to
the top, and bound inputs become read-only downstream projections.

The execution-boundary correction replaces the visual `brief`/`export` aliases
with protected singleton `start`/`end` domain nodes. Start owns editable typed
`text`, `number`, and `boolean` inputs whose output ports are derived from the
input schema. Publication validation now requires one Start and End, valid typed
ports, bound required inputs, an acyclic executable graph, an End reachable from
Start, and a stable topological order. Generated `image-result` nodes remain run
artifacts and are excluded from the published definition.

`POST /api/studio/workflow-publications` locks a server-owned draft and compiles
the independent `WorkflowDefinition 0.3.0-draft` into an immutable sequential
version. Unchanged executable content reuses its version; a stable Deployment
alias moves atomically when content changes. `POST /api/studio/workflow-runs`
rejects serialized browser graphs and accepts only an exact published version
or Deployment target. UI and MusesAgent use the same invocation service,
Workspace authorization, idempotency, credit, audit and Workflow SDK 4.6.2
boundary. The self-hosted runtime uses Postgres World 4.3.1 and starts its
long-lived worker through Next.js instrumentation.

The first supported-node interpreter now executes the Gate 0 chain
`Start → image-generator → selector → design-document → End`. A pure domain
kernel resolves defaults, typed bindings, execution order, outputs and human
selection without SDK objects. One generic `"use workflow"` loop orchestrates
static `"use step"` server Harness adapters. Selector registers a private Hook,
emits a `node.waiting` event, exposes only a Muses suspension id, rejects assets
outside Hook metadata, and resumes to a typed `DesignDocument` reference. The
Studio polls the namespaced event projection and keeps this server Harness
visibly separate from its browser deterministic image fixture. The
provider-neutral `WorkflowRuntimePort` remains frozen so later adapters cannot
expose Workflow SDK types or raw Hook tokens to product clients.

This five-node chain is a combination Harness for collection, human waiting,
and two-level-canvas semantics, not the default image-generation product
template. The first real-image product path is `Start → image.generate → End`
with an explicit count defaulting to one. `human.review` and `document.design`
are added only when the user's task requires review or deep editing.

The durable recovery gate now covers both browser and process failure. Studio
stores the last durable run pointer separately from the editable workspace, so
a reload restores a waiting Selector. Restarting the Web/Workflow container
while the Hook is active causes Postgres World to re-enqueue the run; the same
browser can reload, inspect all three candidates, resume, and complete without
duplicating downstream steps. Because Workflow SDK appends a `hook_received`
event for every `resumeHook()` call, Muses adds a PostgreSQL resume receipt that
serializes a suspension mutation and replays the accepted response for the same
idempotency key after Hook disposal or process restart.

The same adapter now exposes an authorized, idempotent cancellation mutation
for pending, running, and waiting runs. Cancel and resume acquire the same
run-scoped PostgreSQL advisory lock. Cancelling a waiting Selector records one
SDK `run_cancelled`, automatically removes the active Hook, retains the known
runtime history, suppresses stale candidate actions, and restores the cancelled
projection after browser reload. Exact cancellation retries replay the receipt;
conflicting or new cancellation mutations fail with an explicit state error.

The failure gate now fixes the supported-node Step budget at two retries. A
permanent error stops after attempt one; a transient error exposes each attempt
and can recover on attempt three. Selector races its private Hook against a
durable deadline and projects timeout as a structured terminal failure while
disposing the Hook. Studio shows the attempt and failure reason. A retryable
failure can create a distinct run from the source run's frozen SDK arguments;
`retryOfRunId` plus a PostgreSQL receipt preserves lineage and idempotent replay
without rewriting the old run.

The first real-image adapter now calls AI SDK `generateImage()` from a static
Workflow SDK Step and stores generated bytes behind an authorized Muses asset
route. Studio itself is protected by Better Auth and verified-email gates. A
Muses personal Workspace is provisioned idempotently, all Studio run and asset
operations re-check Workspace membership, and browser persistence is scoped by
the real Workspace id rather than a shared local key.

Paid runs now claim a Muses-owned submission and reserve credit atomically
before Workflow SDK start or provider execution. The append-only ledger records
initial grants, reservations, settlements and releases; successful image runs
settle by actual output count, explicit failures release reservations,
cancellation settles known usage, and ambiguous provider outcomes remain
`review_required`. The Studio header and Account Billing page project available
and reserved credit without exposing ledger internals. Browser acceptance covers
idempotent Workspace/grant creation, cross-Workspace denial, and a `402` balance
failure before provider execution.

The first versioned model catalog now seeds two GPT Image offerings with
immutable Capability Profile and PriceBook versions. Studio reads an authorized
published catalog, stores `modelRef`, and renders model/configuration/estimate
choices from it. The run claim revalidates those choices and freezes provider,
profile, price and adapter ids before reserving credit. `/admin/models` projects
the same facts and audits Offering enable/disable changes. The current flat
one-credit image prices remain Alpha validation prices, but they are now
versioned records rather than environment or component constants.

Durable publication storage, provider-level idempotency, crash
recovery inside the SDK-start/receipt-commit interval, mature traces and the
product-owner's unguided first-image acceptance remain open.

## Handoff

Continue with APCC decision `agent-first`: freeze Agent-first product/call contracts, deliver the server-authoritative Operation Gateway and independent Agent Core, then pass the single-Agent canvas and reliability gates. Add MusesAgent, domain profiles, and SubAgent scheduling only after that; do not enter PPT first.
