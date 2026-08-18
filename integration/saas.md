# SaaS Integration Notes

SaaS Starter uses:

- Next.js App Router for the web surface
- Hono for the canonical HTTP API, including health, integration status, account summary, and billing plans
- MCP and worker app skeletons for Agent and background execution surfaces
- Better Auth for email/password authentication
- PostgreSQL with pgvector for auth persistence and future Agent-era semantic data needs
- Drizzle-compatible business schema boundaries under `src/packages/db`
- Valkey for cache and BullMQ queue backing
- MinIO for local S3-compatible object storage
- next-intl for minimal application internationalization
- Resend-compatible transactional email with a local-test fallback and Stripe-compatible billing that fails closed until provider credentials are configured
- Structured JSON logs boundary
- Docker Compose for local production-like runtime and acceptance, with production deployment left to the chosen platform

## Open Agent host integration

Muses remains the identity, model/credential, canvas capability, workflow, and
credit authority. The standalone Open Agent service receives short-lived Host
JWTs minted by `src/apps/web/lib/muses-agent-host.ts` and uses the private
Provider broker at `/api/internal/agent-provider/v1/responses`; upstream model
credentials never leave the Muses server.

For user attachments, the Open Agent deployment uses the same S3-compatible
provider family as Muses but keeps its own `open_agent` metadata schema and
asset key prefix. Configure the Agent service with
`AGENT_ASSET_STORAGE_BACKEND=s3`, `AGENT_ASSET_S3_ENDPOINT`,
`AGENT_ASSET_S3_BUCKET`, `AGENT_ASSET_S3_ACCESS_KEY_ID`,
`AGENT_ASSET_S3_SECRET_ACCESS_KEY`, and `AGENT_ASSET_S3_PREFIX=open-agent`.
Do not point the Agent at Muses' workflow database or reuse Muses' metadata
tables. Sharing a bucket is acceptable only when the key prefix and IAM policy
keep Agent objects separate; a dedicated bucket is preferred in production.

The Agent service owns multipart upload state, checksums, tenant/principal
authorization, range reads, and sandbox materialization. Muses owns the Host
identity and quota/credit policy. A real deployment must run
`npm run doctor:production` and `npm run verify:asset-load` in the Agent
environment, then run the Muses Host E2E with real Workspace/Project/Canvas
credentials. Local filesystem assets are development-only.

Muses owns two production-topology gates. `pnpm run
verify:workflow-agent-bridge` proves `Start -> agent.run -> End`, usage
projection, idempotency, and cancellation. `pnpm run
verify:agent-host-canvas` proves the reverse direction by issuing a scoped Host
token, starting a real platform Agent, and checking its idempotent mutation of
the authoritative CreativeCanvas. The canvas gate requires
`MUSES_BASE_URL`, `MUSES_SESSION_COOKIE`, `MUSES_WORKSPACE_ID`,
`MUSES_PROJECT_ID`, `MUSES_CANVAS_ID`, and a dedicated
`MUSES_CANVAS_E2E_REF_ID`; run it only against a disposable E2E Project because
the marker item is intentionally retained as evidence.

With the same marker configured, the Playwright case `embedded platform Agent
drives the authoritative creative canvas` sends the task through the embedded
Agent UI and requires the resulting item to appear on Studio's CreativeCanvas.
This case skips when the marker is absent so the neutral SaaS browser suite does
not mutate a canvas accidentally.

Do not add provider-specific services without recording them under `src/providers/`, `interfaces/*`, and `tests/contracts/`.
