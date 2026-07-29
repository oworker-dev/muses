# Agent Core A9 Reliability Gate

This document freezes the acceptance matrix for the A9 single-Agent
reliability gate. A7 proves the user-facing image loop and A8 proves exact
callable workflow invocation; neither is evidence that the Agent runtime is
safe under process failure, long context, cancellation races, or duplicate
delivery.

The gate is result-oriented: each row needs a deterministic failure fixture,
an authoritative persisted outcome, and repeatable evidence. A passing happy
path alone is insufficient.

## Acceptance matrix

| Area | Product authority | Required failure fixture and invariant | Passing evidence | Status |
| --- | --- | --- | --- | --- |
| Driver recovery | Muses `AgentRun` driver attempt/lease plus Workflow SDK run status | Crash before SDK start; crash after SDK start before DB attachment; stale attached run; concurrent reclaim. At most one attempt may own side effects, and an old durable run must fail closed after ownership changes. | State-machine tests, PostgreSQL migration/constraint check, Workflow SDK restart probe, no duplicate model/tool/credit/canvas facts | Passed |
| Context compaction | Versioned `AgentContextSnapshot` summary plus retained messages/facts | Force compaction across follow-up and restart. Plan, permissions, tool outputs, provenance, budget usage and unresolved approvals must not drift. | Fixed long-context eval comparing pre/post-compaction facts and resulting commands | Passed |
| Budget and billing | Agent budget snapshot, model-call receipt, model/tool usage, credit reservation and immutable ledger | Duplicate delivery, provider failure before/after an ambiguous response, retry and child workflow completion. Every known charge/reservation settles once, ambiguous calls retain review funds, and limits stop new work before the side effect. | Unit state machine, isolated PostgreSQL ledger probe and real Agent image chain correlated to AgentRun/model/WorkflowRun/Asset | Passed |
| Approval and cancellation | Agent Core approval state, Muses cancellation command and child-run links | External tool waits for server-authorized approval; deny, cancel while model runs, cancel while child workflow runs, and late success. Cancellation prevents new effects but preserves facts that actually completed. | Approval UI/API probe, Workflow World cancellation record, child-run terminal projection and race tests | Passed |
| Isolation and tracing | Workspace authorization, Run-scoped logical sandbox, policy snapshots and correlation identifiers | Cross-Workspace Run/Asset/tool access, stale Skill/MCP snapshot, sandbox escape attempt and trace discontinuity. No caller receives another Workspace's data or credentials. | Negative authorization suite and one trace joining AgentRun, model, tool, WorkflowRun, Asset, usage and credit | Pending |
| Fixed evals | Versioned eval fixtures and sanitized evidence bundle | Success, recovery, refusal, budget, approval, cancellation, isolation and no-side-effect cases run against fixed inputs. Failures must be reproducible without private customer content. | Machine-readable results, commands, versions and residual-risk record under `delivery/evidence/agent-core-alpha/a9-reliability/` | Pending |

## Driver recovery contract

Workflow SDK is the durable execution adapter, while Muses remains the product
state authority. Installed `workflow@4.6.2` does not expose a caller-provided
WorkflowRun id or start idempotency key. Consequently:

- every driver claim receives a Muses-owned opaque attempt id and expiring
  lease;
- the attempt id is passed into the durable workflow, which must attach its own
  SDK run id before any model or tool work;
- every attach, renewal, release and finish is conditional on the attempt id,
  so a delayed workflow from an obsolete claim cannot execute;
- an expired unbound claim may be replaced because the old workflow will fail
  the attempt check if it later starts;
- an expired bound claim is never replaced until its Workflow SDK status is
  reconciled as terminal; `pending` or `running` only renews the Muses lease;
- browser polling may perform this server-authorized read repair after
  Workspace authorization, allowing refresh and Web-process restart to recover
  without trusting client state.

The driver lease alone does not make model-provider calls exactly once. Model
calls are now fenced by the separate receipt contract below; Workflow retries
must never infer permission to repeat a provider call from driver ownership.

## Context compaction contract

Agent Core automatically compacts before a model call when a long session
crosses either the 24-message or 48K-character high watermark, targets 16
messages and 32K characters, and also exposes an explicit `compact()` runtime
operation. Separate high and retained watermarks prevent every new turn from
causing another compaction. A compaction commits a new ContextSnapshot version and a
`context.compacted` event. It must retain system messages, recent turns and the
assistant source of every pending tool call; structured facts preserve current
plan, permissions, budget, artifact references, pending actions and omitted
tool results. Ordinary omitted conversation rolls into one bounded history fact
instead of growing one fact per old message. A replaceable synchronous or
asynchronous compactor is rejected before commit if source identity, version,
retention or authoritative fact values drift.

The persisted prose and Agent Core-rendered structured facts are injected into
later model input as a synthetic system message. A custom compactor cannot hide
validated authority merely by omitting it from its prose. The PostgreSQL
fixture performs 14 deterministic turns, compacts once from 26 source messages,
constructs a new Runtime over the same Store and completes turn 15 with 21
retained messages and unchanged plan, permissions, tool count and credit usage.
The fixture calls no external model or tool and is deleted after verification.

## Budget and model-call receipt contract

Every turn derives a stable model-call identity from AgentRun id, next turn and
ContextSnapshot version. Before provider execution, the Web adapter persists a
request fingerprint, conservative input/output estimate, attempt lease and
credit reservation. Agent Core rejects estimated run-budget overflow before
this adapter can call the provider; the adapter independently rejects an
insufficient Workspace balance before creating a provider-side effect.

The installed provider API has no proven idempotency key for model generation,
while Workflow steps can execute again after an invocation crash. Muses therefore
does not send a fictional idempotency header. It applies these receipt outcomes:

- a completed receipt replays its validated structured result and settles only
  once;
- an expired `claimed` receipt may receive a new attempt because provider work
  has not begun;
- an expired `calling` receipt becomes `ambiguous`, retains its reservation as
  `review_required`, and is never called automatically again;
- a definite non-timeout 4xx rejection becomes `failed` and releases its
  reservation exactly once;
- network, timeout, 5xx and unknown failures become `ambiguous`;
- actual cost above the reservation retains the received result and actual
  usage but becomes `ambiguous/review_required` instead of silently charging or
  completing.

`AgentModelError.runtimeAction` separates a safe Workflow driver retry from a
terminal Agent failure. A receipt still active before provider execution parks
the driver until its lease can be reconciled; a result-unknown receipt fails the
AgentRun closed for review. UTF-8 byte size plus structural overhead provides a
provider-neutral conservative input estimate, and the AI SDK output cap is the
remaining run output budget.

Agent-created image workflows are ad-hoc child runs: they carry `caller_kind =
agent` and the parent AgentRun id, but no published definition id/version. This
keeps billing and tracing lineage without representing an ephemeral definition
as a callable published contract.

## Approval and cancellation contract

Approval is a durable execution gate, not a replacement for authorization or
idempotency. `image.generate`, `workflow.invoke` and future tools classified as
`external` pause before execution. Studio renders the server-persisted tool
name, reason and bounded input projection, then submits an exact approval id.
The API revalidates the authenticated Workspace membership, rejects viewer
mutations, records the deciding user, allows an identical decision to replay,
and rejects a conflicting second decision. A denial becomes a tool result for
the next model turn and executes no tool side effect.

Cancellation first persists one Muses-owned receipt and marks the AgentRun
terminal. The receipt itself fences new Agent child submissions and canvas
writes during the narrow interval before the terminal snapshot commits. Both
boundaries lock the same AgentRun row: a child committed first is visible to
the coordinator; a cancellation committed first blocks the child. The
coordinator then cancels the durable Agent driver and every still-active child
Workflow SDK run linked by `caller_kind = agent` and `caller_id = AgentRun`.

Completed or failed child runs keep their actual terminal state. A child that
finishes while cancellation races is therefore not rewritten as cancelled.
Known image usage is settled once; no-usage cancellation releases the
reservation; an interrupted provider attempt or missing charged SDK run moves
the reservation to `review_required`. A late model result cannot revive a
cancelled AgentRun because its checkpoint loses the persisted revision race.
Exact cancellation retries replay the stored summary; a different key, reason
or requester conflicts.

## Gate rule

A9 passes only when every matrix row has committed evidence and no unresolved
failure can duplicate a user-visible side effect or charge, cross a Workspace
boundary, bypass approval, or silently lose an accepted result. Multi-Agent
orchestration and scenario MVP work remain blocked until then.
