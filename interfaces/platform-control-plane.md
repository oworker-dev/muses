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
