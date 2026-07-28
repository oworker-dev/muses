# Workflow Runtime Boundary

Muses owns `WorkflowDocument`, publication validation, `WorkflowDefinition`
compilation, and the framework-independent `WorkflowRuntimePort`. Vercel
Workflow SDK is the first durable runtime adapter; React Flow owns none of these
contracts.

## Compile A Definition

`compileWorkflowDefinition(document, identity)` is a pure domain operation. The
caller must provide a stable `workspaceId`, `definitionId`, and non-negative
`version`; the compiler never invents publication identity from a mutable
document revision.

Compilation either returns structured diagnostics with no partial definition,
or an immutable, JSON-serializable `WorkflowDefinition` containing:

- exact source document id, schema version, and revision;
- protected entry and exit node ids;
- typed workflow inputs and outputs;
- normalized executable node configuration;
- typed data bindings and control dependencies;
- a stable topological execution order.

Coordinates, titles, renderer state, Job status, generated `image-result`
nodes, candidate ids, and prior selections are deliberately excluded. The
definition schema currently has its own version, `0.3.0-draft`, independent of
the editable workspace schema.

## Runtime Port

`WorkflowRuntimePort` exposes `startRun`, `getRun`, `cancelRun`, `resumeRun`,
and `retryRun`. Every mutation carries workspace ownership, actor identity, and
an idempotency key. Runs bind an exact `WorkflowDefinitionRef`, an input
snapshot, and a correlation id.

The Muses run state vocabulary is `queued`, `running`, `waiting`, `succeeded`,
`failed`, and `cancelled`. Adapters translate their provider-specific states and
errors into this vocabulary. They may not return Workflow SDK `Run`, `Hook`,
stream, error, or World objects through the domain port.

`resumeRun` accepts a Muses `suspensionId` and typed values. SDK Hook tokens stay
inside the server adapter so a public client cannot use possession of a raw
token as its only authorization boundary. Manual retry creates a new run linked
through `retryOfRunId`; it does not rewind a completed run in place.

## Start The Supported-Node Runtime

`POST /api/studio/workflow-runs`

```json
{
  "workspaceId": "muses-workspace-alpha",
  "inputs": {},
  "workflow": {
    "id": "workflow-alpha",
    "schemaVersion": "0.6.0-draft",
    "revision": 0,
    "nodes": [],
    "edges": []
  }
}
```

The actual document must contain exactly one protected Start and End and compile
without diagnostics. Invalid documents return `422` and do not create a run.
Valid documents return `202` with the exact definition reference:

```json
{
  "accepted": true,
  "runId": "wrun_...",
  "runtime": "muses-workflow-runtime",
  "durableRuntime": "vercel-workflow-sdk",
  "definition": {
    "workspaceId": "muses-workspace-alpha",
    "definitionId": "workflow-alpha:runtime-v1",
    "version": 0,
    "schemaVersion": "0.3.0-draft"
  },
  "validation": {
    "valid": true,
    "issues": [],
    "topologicalOrder": [
      "start-1",
      "image-generator-1",
      "end-1"
    ]
  }
}
```

The default product definition is:

```text
Start → image-generator → End
```

Start resolves typed supplied values or declared defaults. An
`image-generator` configured with `image.generate.v1` executes through the
`openai-images` adapter in a static `"use step"` boundary. Prompt and reference
image inputs independently use either a typed upstream variable or a fixed
value; a fixed input never mutates Start. Fixed reference images are stable,
workspace-owned Asset ids rather than upload URLs or bytes. The node stores a
versioned `modelRef`; model, aspect-ratio, resolution preset/custom size, count,
quality, and price choices come from the current published Model Offering,
Capability Profile, and PriceBook rather than component enums.

The `2026-07-28.1` GPT Image 2 Profile exposes text/image input modes, up to 16
PNG/JPEG/WebP references, nine aspect ratios, `1K/2K/4K`, custom size, count
`1-4`, and low/medium/high quality. Its resolver legalizes dimensions to the
nearest request satisfying the 16-pixel grid, 3840 maximum edge, 655,360 to
8,294,400 pixels, and 3:1 maximum ratio. GPT Image 1.5 remains a truthful
discrete-size Profile. The run reservation freezes both requested intent and
resolved provider dimensions. The adapter persists the provider bytes as
returned and records their actual metadata; it does not silently crop output to
pretend the requested dimensions were returned. End returns the same image
value as the workflow output.

The paid provider step sets both AI SDK retries and Workflow SDK Step retries
to zero. A provider request therefore runs at most once automatically. A
transient outcome becomes a retryable terminal Muses failure so only an
explicit user action can start a new run. This limits duplicate charges but is
not yet provider-level idempotency: an explicit retry after an ambiguous
network failure can still duplicate provider work.

The named `/studio?template=harness` fixture remains separate:

```text
Start → image-generator → selector → design-document → End
```

It uses `deterministic.image.generate.v1`, three server fixture references, a
private Hook-based human selection, and a DesignDocument reference. It exists
only for durable-runtime regression coverage and never substitutes for the
default real image path.

## Reference Image Assets

Fixed image-to-image inputs use three workspace-authorized routes:

- `POST /api/studio/reference-images/upload` creates an `uploading` Asset row
  and returns a 15-minute S3-compatible presigned PUT contract.
- `POST /api/studio/reference-images/confirm` reads the uploaded object on the
  server, validates actual bytes, MIME type, and dimensions with Sharp, then
  marks the Asset `ready` and returns its stable id.
- `GET /api/studio/reference-images/{assetId}?workspaceId=...` streams only a
  ready Asset owned by that workspace for inline inspection.

Only content validation failures are terminal and change state to `rejected`.
Storage/network/database failures return a retryable `503` and retain
`uploading`; retrying confirmation is idempotent, and confirming an already
ready Asset returns the same Asset projection. Publication and run submission
revalidate readiness, ownership, MIME, byte size, model count, and Profile
limits. Workflow definitions contain Asset ids only.

## Query A Run

`GET /api/studio/workflow-runs?runId=wrun_...&workspaceId=muses-workspace-alpha`

The response contains both `sdkStatus` and the Muses projection `status`.
`status` can be `pending`, `running`, `waiting`, `completed`, `failed`, or
`cancelled`. It also includes the known `muses:runtime` events without blocking
on an open stream. The adapter reads the stream tail, consumes exactly the
known chunk count, then cancels the reader.

While Selector is waiting, the response exposes only a Muses suspension:

```json
{
  "status": "waiting",
  "suspension": {
    "id": "selector:selector-1",
    "nodeId": "selector-1",
    "kind": "human-selection",
    "candidateAssets": [
      {
        "assetId": "muses-server-fixture:step_...:image:1",
        "kind": "image",
        "source": "server-harness-fixture",
        "label": "Server direction 1"
      }
    ]
  }
}
```

Raw Hook tokens and Workflow SDK Hook objects are never returned.

### User-safe observability projection

The same response includes a versioned `observability` projection. It is a
server-side join over existing facts, not a second tracing system:

- Workflow SDK World `Run` and `Step` materialized views provide authoritative
  status, attempts, start/completion timestamps, duration, core version, and
  frozen Step I/O. Step I/O is always read with `resolveData: "all"` and
  hydrated through the SDK's `hydrateResourceIO()` and
  `observabilityRevivers`.
- Muses runtime events provide stable business `nodeId`, node kind, typed
  outputs, Muses failure category, and AI SDK usage.
- The immutable credit reservation supplies the public `modelRef`, Capability
  Profile version, PriceBook version, resolved size, unit price, estimated
  credits, and settled credits.

```json
{
  "observability": {
    "schemaVersion": "0.1.0",
    "source": "workflow-sdk-world",
    "run": {
      "startedAt": "2026-07-28T00:00:00.000Z",
      "completedAt": "2026-07-28T00:00:08.240Z",
      "durationMs": 8240,
      "workflowCoreVersion": "4.6.2"
    },
    "nodes": [
      {
        "nodeId": "image-generator-1",
        "nodeKind": "image-generator",
        "status": "succeeded",
        "attempt": 1,
        "durationMs": 8012,
        "inputSummary": [
          {
            "portId": "prompt",
            "valueType": "text",
            "value": "A launch visual for Muses",
            "truncated": false
          },
          { "portId": "referenceImages", "valueType": "image", "count": 1 }
        ],
        "outputSummary": [
          { "portId": "image", "valueType": "image", "count": 1 }
        ],
        "usage": {
          "imageCount": 1,
          "tokenStatus": "not-reported"
        },
        "billing": {
          "estimatedMicros": "1000000",
          "actualMicros": "1000000",
          "status": "settled"
        }
      }
    ],
    "totals": {
      "imageCount": 1,
      "tokenStatus": "not-reported",
      "estimatedMicros": "1000000",
      "actualMicros": "1000000",
      "billingStatus": "settled"
    }
  }
}
```

`tokenStatus: "not-reported"` means the provider did not return Token usage;
the API must not turn missing usage into zero. Input text is length-bounded,
image values expose counts rather than object bytes or storage keys, and the
projection never returns the complete `WorkflowDefinition`, `creditContext`,
provider execution model id, connection credentials, raw stack, SDK Step, or
OpenTelemetry carrier. Workflow SDK already propagates OpenTelemetry context
through workflow and Step queue messages and emits its own spans; Muses keeps
that context in the runtime/telemetry layer instead of inventing public trace
ids or another event store.

If World observability cannot be read, run lookup still succeeds and the API
falls back to a reduced projection derived from known Muses runtime events with
`source: "muses-runtime-events"`. This degradation cannot turn an owned,
existing run into `404`.

## Completed Image Output

A completed default run returns the End image value as the primary result:

```json
{
  "status": "completed",
  "result": {
    "runtime": "muses-workflow-runtime",
    "completedNodeIds": ["start-1", "image-generator-1", "end-1"],
    "outputs": {
      "image": {
        "valueType": "image",
        "assetIds": ["image_..."],
        "assets": [
          {
            "id": "image_...",
            "mimeType": "image/png",
            "width": 1024,
            "height": 1024,
            "prompt": "...",
            "provider": "openai",
            "modelRef": "openai/gpt-image-2@2026-07-28",
            "createdAt": "2026-07-28T00:00:00.000Z",
            "source": {
              "workspaceId": "muses-workspace-alpha",
              "runId": "wrun_...",
              "nodeId": "image-generator-1"
            }
          }
        ]
      }
    }
  }
}
```

`width`, `height`, and `mimeType` describe the bytes actually returned by the
provider and stored by Muses. Requested intent and resolved provider request
dimensions live in the immutable run/reservation snapshot; a mismatch remains
observable instead of being hidden by an implicit crop or conversion. Signed
read URLs are present in the live response but omitted above; callers must not
treat their expiry-bearing URL as the stable Asset identity.

Studio uses the signed URL for inline inspection. Its download action targets
the same-origin
`GET /api/studio/generated-images/{assetId}?workspaceId=...&runId=...`
endpoint. The endpoint accepts only a generated-image id, verifies that the
completed durable Run belongs to the workspace and actually returned that
Asset, then reads the deterministic object key and responds with
`Content-Disposition: attachment`. A failed identity or ownership check is a
generic `404`; the browser never receives storage credentials or an arbitrary
object key.

## Cancel A Waiting Run

`DELETE /api/studio/workflow-runs`

```json
{
  "workspaceId": "muses-workspace-alpha",
  "runId": "wrun_...",
  "idempotencyKey": "workflow-cancel:wrun_...",
  "reason": "user-requested"
}
```

The server verifies the run's `run.started` workspace projection, serializes
cancel and resume mutations for the run with a PostgreSQL advisory transaction
lock, persists a cancellation receipt, and then calls Workflow SDK
`run.cancel()`. The SDK records one `run_cancelled` event; Postgres World moves
the run to `cancelled` and removes its active Hook materialization. It does not
need to append `hook_disposed` for terminal-state cleanup.

An exact retry returns `202` with `idempotentReplay=true` without adding another
`run_cancelled`. Reusing the key with a different reason or submitting a new
cancel mutation after the run was claimed returns `409`. A mismatched workspace
returns `404`, and a resume attempted after cancellation returns `404` because
the Hook no longer exists. Cancelled run projections retain prior runtime
events but omit the formerly active suspension and candidate actions.

## Failure, Timeout, And Attempts

The deterministic supported-node Harness fixes its executable Step retry budget
at two retries, or three total attempts. A permanent node error throws Workflow
SDK `FatalError` and stops after the first attempt. A transient node error uses
`RetryableError`; the SDK emits `step_retrying` and reruns the same stable Step
until the final allowed attempt. Permanent failures and final exhausted
attempts return a structured Muses failure from the Step, so the workflow does
not infer business failure category from an SDK error serialized across the
Step boundary. Muses emits separate `node.attempt.started`,
`node.attempt.failed`, and `node.attempt.succeeded` runtime events and projects
the latest attempt without leaking a Workflow SDK Step object.

Selector waits race the private Hook against durable `sleep()`. The default
Harness deadline is seven days. If the deadline wins, the run ends as
`failed`, the Hook is disposed, the stale suspension is omitted, and the API
returns a structured failure:

```json
{
  "status": "failed",
  "failure": {
    "code": "human-input-timeout",
    "category": "timeout",
    "message": "Selector node \"selector-1\" timed out while waiting for human input.",
    "retryable": true,
    "nodeId": "selector-1",
    "nodeKind": "selector"
  },
  "attempts": [
    {
      "nodeId": "image-generator-1",
      "attempt": 1,
      "maxAttempts": 3,
      "status": "succeeded"
    }
  ]
}
```

This timeout is a terminal run failure, not a recoverable Selector suspension
and not cancellation. Continuing requires a new run. The local development
stack can enable named, server-controlled failure scenarios through
`MUSES_WORKFLOW_HARNESS_ENABLED`; they are adapter test inputs and never become
node configuration or part of `WorkflowDefinition`.

## Retry A Failed Run

`POST /api/studio/workflow-runs`

```json
{
  "workspaceId": "muses-workspace-alpha",
  "retryOfRunId": "wrun_source",
  "idempotencyKey": "workflow-retry:wrun_source"
}
```

Manual retry is accepted only when the source run is terminal `failed` and its
Muses failure projection is retryable. The adapter uses the documented World
observability API plus `hydrateResourceIO()` to read the source run's frozen
Workflow SDK arguments. It starts a new run with the exact compiled definition,
input snapshot, and Harness options, adding only `retryOfRunId`. It never rolls
back or rewrites the source run.

A PostgreSQL retry receipt persists the source/target relation and caller
idempotency key. An exact replay returns the same target `runId` with
`idempotentReplay=true`; a permanent failure or non-failed source returns
`409`. Studio replaces its last-run pointer with the new run while the old run
remains independently queryable.

## Resume A Human Selection

`PATCH /api/studio/workflow-runs`

```json
{
  "workspaceId": "muses-workspace-alpha",
  "runId": "wrun_...",
  "suspensionId": "selector:selector-1",
  "selectedAssetId": "muses-server-fixture:step_...:image:2",
  "idempotencyKey": "selector-resume:wrun_...:selector:selector-1:muses-server-fixture:step_...:image:2"
}
```

The server reconstructs the private Hook token, calls `getHookByToken()`, and
validates run ownership, workspace, suspension metadata, and the candidate
asset allow-list before `resumeHook()`. A PostgreSQL receipt serializes retries
for the same suspension and persists the successful idempotency key across Web
process restarts and Hook disposal. An exact replay returns `202` with
`idempotentReplay=true` without appending another `hook_received`; reusing the
same key for a different selection returns `409`. Unknown assets return `422`;
mismatched ownership returns `403`; missing, already-disposed, or differently
claimed suspensions return `404`.

After a Harness resume, successful completion returns a typed output:

```json
{
  "status": "completed",
  "result": {
    "runtime": "muses-workflow-runtime",
    "outputs": {
      "document": {
        "valueType": "design-document",
        "documentId": "design-1-document",
        "revision": 0
      }
    }
  }
}
```

The resumed five-node path is still an interpreter Harness, not the default
product workflow. The default three-node path now has a real provider adapter
and stored Asset metadata, but a complete provider-neutral Capability/Job
registry, request idempotency, cost accounting, tenant authorization, crash
recovery across the SDK-start/receipt commit gap, and arbitrary node kinds
remain separate gates.
