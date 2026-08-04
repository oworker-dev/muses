# Agent Runtime Interface

This document describes the current Muses integration with the independently
deployable `open-agent` product. It is a product contract, not a promise that
every surface is already a stable public API.

## Authority layers

| Layer | Current authority |
| --- | --- |
| Standalone Agent service | AgentRun, Eve session, messages/events, context compaction, tools, Skills/MCP grants, cancellation, sandbox and usage |
| Agent product PostgreSQL schema | AgentRun idempotency, tenant/principal ownership, thread collections and Agent product indexes |
| Eve Workflow World | Durable Agent session state, queues, hooks, streams and execution evidence |
| Muses Host | Better Auth identity, Workspace/Project authorization, Host capability policy, credits, model/provider control plane and audit |
| Operation Gateway | Server-authoritative canvas, workflow-draft and Asset mutations |
| Muses Workflow World | Published WorkflowDefinition execution, Step retry, hooks and Workflow run evidence |

The Agent and Muses Workflow runtimes are independent products and use separate
Workflow Worlds. Neither owns the other's state machine. Both can be replaced
behind their versioned contracts without moving canvas, Asset, identity or
billing authority out of Muses.

## Model Provider broker

Muses-hosted Agent model calls use the OpenAI Responses-compatible private
endpoint `POST /api/internal/agent-provider/v1/responses`. The Agent runtime
sets its `OPENAI_BASE_URL` to the route prefix and authenticates with the shared
service secret `MUSES_AGENT_PROVIDER_BROKER_SECRET`. This secret is distinct
from Host JWT, Host capability HMAC, and every upstream Provider credential.

For each request Muses validates a bounded JSON body and model id, resolves an
active `llm` Provider Connection by model allowlist, decrypts its credential in
server memory, calls the fixed `{baseURL}/responses` endpoint, and passes
through the response stream and safe diagnostic headers. It does not accept an
arbitrary destination, forward caller authorization, log Provider payloads, or
return credentials. Missing Vault, invalid service auth, absent model route,
timeout and upstream transport failure all fail closed with structured errors.

This is a credential-routing boundary, not yet the final billing boundary. A
real Provider E2E, per-Workspace entitlement, AgentRun-correlated usage/credit
settlement, service-secret rotation and target-deployment abuse controls remain
release gates.

## Headless AgentRun service

Muses and durable Workflow steps call the standalone service through its
host-neutral AgentRun API:

- `POST /api/agent/runs` starts an idempotent AgentRun;
- `GET /api/agent/runs/:runId` returns the authorized run snapshot;
- `GET /api/agent/runs/:runId/events?after=...` returns cursor-based events and
  accumulated Input, Output, Cache Read, Cache Write and cost usage;
- `DELETE /api/agent/runs/:runId` requests idempotent cancellation.

Every production call carries a short-lived Host JWT. The Agent service verifies
issuer, audience, signature, expiry, tenant and principal, persists immutable
session ownership, and hides cross-tenant or cross-principal runs as not found.
The current caller contract requires `runtime: "standalone"`; there is no
implicit `muses-local` fallback.

The service owns AgentRun request fingerprints and idempotency. A response lost
after Eve accepted a session becomes `submission-ambiguous` and is not
automatically resubmitted. Cancellation uses Eve's cooperative boundary and
resets only an exclusive session that cannot settle within the grace period.

## Web and embedded projection

The standalone `/` workspace and Muses `/embed` iframe consume the same Agent
workspace components and Eve session protocol. Muses mints a short-lived embed
token after checking the signed-in Workspace member; the token is delivered by
the versioned `postMessage` bootstrap protocol rather than in the iframe URL.

One Web thread maps to one durable Eve session. `sessionId` addresses its event
stream and `continuationToken` submits the next turn after `session.waiting`.
Refresh recovery replays durable events; a failed or cancelled turn returns the
session to an actionable state instead of leaving a permanent running marker.

## Context, sandbox and extensions

Context selection, durable history and compaction belong exclusively to the
standalone Agent. Eve compaction is enabled at an 82% threshold, with explicit
session input/output limits. Muses neither copies nor independently summarizes
Agent history. A deterministic Eve multi-turn Eval now proves two real
`compaction.requested` / `compaction.completed` cycles in one durable session:
the second checkpoint updates the first, exact task facts and active todo state
remain available, sandbox files persist, and Eve resets read-before-write
evidence so a post-compaction write cannot rely on summarized-away reads. This
evidence validates the Harness boundary without restoring Muses' deleted local
context summarizer; quality under a live long-context Provider and target-load
deployment remains part of the broader production SLO Gate.

Eve supplies one persistent `/workspace` sandbox per durable session. An
AgentRun receives an exclusive session, so AgentRun and sandbox isolation align;
subagents receive independent sandboxes. The authored policy applies bounded
CPU/memory where supported and deny-all network egress. Local Docker persistence
and cross-turn workspace recovery are verified. Production backend selection,
adversarial cross-tenant isolation, retention/reclamation SLOs and credential
brokering remain release gates.

Versioned Agent Profiles resolve exact Skill, MCP and Host capability grants.
A run may narrow but never expand its Profile grant; revoked or unknown
extensions fail before Eve starts a session. The standalone Agent now owns a
deployment catalog plus tenant-scoped enable/revoke state. A Host token carrying
`agent.extensions.manage` can use the versioned extension API; mutations append
an audit event. Credentials remain in the Host/Vercel vault and the Agent stores
only opaque `vault://` or `vercel-connect://` references. Audit state records
only whether credentials exist, never a reference or secret.

The published `software-task@1.0.0` Skill has passed Eve-native Docker evals.
The lifecycle schema supports MCP, but no MCP is published until a real endpoint,
tool allowlist, principal-scoped auth, approval rule and adversarial eval are
compiled. Revocation blocks the next AgentRun and is rechecked on session start
and continuation; it cannot undo a side effect already committed.

## Host capabilities

The standalone Agent discovers and invokes Muses functionality only through the
versioned Host Capability protocol. Muses currently supplies canvas inspection
and placement, workflow list/inspect/invoke plus bounded server-side run waiting, workflow draft authoring,
validation/publication and optional media capabilities. Requests are HMAC-signed
with timestamp, method, path and body, and carry the exact tenant, principal,
Project and Canvas scope. Muses revalidates membership, role and authoritative
scope before entering the Operation Gateway.

Without Host configuration these tools do not exist and the Agent remains a
general-purpose product. Image generation is therefore one optional host tool,
not an Agent execution stage.

## Workflow composition

Muses `agent-run` nodes store a published Profile ref, schemas, narrowed policy,
budget and output mode. A durable step starts the standalone AgentRun with
`workflow run id + node id` idempotency, polls its public snapshot, records usage
and returns its result. Cancellation propagates to active AgentRun ids.

The reverse direction uses Host capabilities: a Muses platform Agent can inspect,
author, validate, publish and invoke WorkflowDefinitions. `workflow.run.wait`
parks the Host request for a bounded interval so durable work does not consume a
new LLM call for every status check. This proves bidirectional
composition without importing Eve into the Muses process or importing Workflow
SDK into the Agent's public contracts.

## Legacy compatibility

Migrations `0007` through `0016`, their evidence, and the historical
`muses_agent_*` rows remain immutable for audit and upgrade compatibility. They
are not exported by the current Drizzle runtime schema and no production source
reads or writes them. Migration `0014` still reconstructs the old schema in an
isolated test to verify its historical Asset project-scope backfill.

Muses no longer exposes `/api/studio/agent-runs`, local model-loop, delegation,
context, trace or driver implementations. New Agent behavior must be implemented
in `open-agent` and consumed through the public Agent/Host contracts.

## Current release gates

- Real-provider Web and headless recovery evidence beyond the deterministic
  provider fixture.
- Real credentialed MCP allowlist, OAuth/revocation and execution evidence; the
  shared Skill/MCP catalog, tenant enable/revoke and audit control plane exists.
- OpenTelemetry traces joining Agent, Eve World, Host capabilities, Muses
  Workflow, model usage and credit reconciliation. The two Web services now
  register one OTLP-compatible export path and propagate W3C trace context to
  configured origins; deployed-collector and billing-reconciliation evidence
  remain open.
- Production sandbox backend isolation, cleanup, egress and SLO evidence.
- Real administrator model credential routing plus AgentRun-correlated non-zero
  price reconciliation E2E; the private streaming broker is implemented.
- Versioned package extraction, conformance suite, self-hosting, upgrade and
  rollback documentation.

Canonical architecture is in
`docs/internal/独立WebAgent项目与Muses宿主集成.md`.
