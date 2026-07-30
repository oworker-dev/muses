# Muses Platform Control Plane

Muses exposes two server-owned control-plane projections:

- an authenticated Site Admin surface for model offerings, capability profiles,
  price books, availability, routing policy, and usage;
- an authenticated Studio catalog containing only published offerings available
  to the current workspace.

Studio workflow documents store a stable `modelRef`, generic input sources,
output intent, and declared parameters. They never contain provider credentials,
provider connection details, mutable prices, or SDK objects.

Every Studio request is bound to the current verified account and an authorized
workspace. A paid run must create an idempotent credit reservation before the
provider call and settle or release it from the recorded usage and price
snapshot. Stripe payment records may grant credits later but are not the model
usage ledger.

Workflow SDK remains the durable execution source for Run, Step, Event, retry,
timing, and serialized I/O. AI SDK/provider usage, OpenTelemetry trace context,
Muses UsageRecord, and the immutable credit ledger are correlated projections,
not replacement workflow runtimes.

The first projection is available at
`GET /api/studio/model-catalog?workspaceId=...`. It requires a verified Studio
session and Workspace membership, returns only enabled published image
offerings, and omits provider execution ids and credentials. Site administrators
inspect versions and audit enable/disable changes at `/admin/models`. Published
Profile and PriceBook content is immutable in PostgreSQL; a changed
specification or price requires a new version.

Site administrators manage capability-scoped connections at
`/admin/providers`. A connection declares its Provider, Base URL, capability
families, optional model allowlist, explicit Offering bindings, status, and
priority. One API key is not assumed to support every capability. LLM, image,
video, audio, and music keys can therefore be isolated as separate
connections, including multiple connections for one Provider.

Credential submission and rotation are server-only mutations. The local
Credential Vault adapter encrypts each version with AES-256-GCM and
`MUSES_CREDENTIAL_MASTER_KEY`; PostgreSQL stores ciphertext, authenticated
metadata, key id, and a four-character hint. Admin projections, Studio APIs,
workflow definitions, run events, pricing snapshots, and audit metadata never
contain plaintext credentials or ciphertext. Production deployments must keep
the master key stable across restarts and treat master-key rotation as an
explicit re-encryption operation.

New paid image submissions resolve an enabled Offering binding before the
Workflow SDK run starts and freeze only `providerConnectionId` into the
server-owned execution snapshot. The Step opens that exact connection at call
time. A missing, disabled, unhealthy, or undecryptable frozen connection fails
closed; it does not switch providers after a possibly billable request. Agent
LLM calls use the same capability-aware resolver. Existing
`OPENAI_API_KEY`/`OPENAI_IMAGE_API_KEY` variables remain deployment bootstrap
fallbacks only when no database route was selected.

Health checks use a non-generating model metadata request and persist a
capability-specific status (`unknown`, `healthy`, `degraded`, or
`unavailable`), sanitized result code, HTTP status, latency, and last success.
They do not prove output quality or spend credits. Rate limits and provider
5xx responses degrade a route; deterministic credential or model rejection
marks it unavailable. All connection creation, rotation, binding, status, and
health-check mutations are site-admin authorized and audited.
Admin-managed custom Base URLs accept only HTTP(S), reject embedded credentials
and URL parameters, require HTTPS outside explicit local development, and in
production must match an exact hostname in `MUSES_PROVIDER_ALLOWED_HOSTS`.
