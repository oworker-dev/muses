# OWorker SaaS Starter Agent Service Guide

This public guide is discovered from the canonical service root. It is not part of the primary human UI, but it is intentionally readable and auditable by humans.

## Service Identity

- Service: OWorker SaaS Starter
- Canonical service root: `/`
- Discovery manifest: `/.well-known/anss.json`
- Service map: `/anss/saas.service-map.yaml`
- Adapter install index: `/anss/install/index.json`
- LLM document index: `/llms.txt`

## Architecture

The human Web experience is served by the Next.js app. Durable programmable service calls are exposed through the Hono API app.

```text
Human UI -> Next.js
Agent / CLI / MCP / API clients -> Hono API
```

The Hono API is the default programmable service boundary for this starter. Capability metadata is declared once in `src/apps/api/src/capabilities.mjs`; service-map, OpenAPI, ACLIP, MCP, Skills, and this guide are generated from that contract.

## Available Service Capabilities

The starter exposes a small set of neutral, real SaaS capabilities:

- `saas.health.read`: Read service health.
- `saas.integrations.read`: Read configured integration defaults.
- `saas.auth.status.read`: Read CLI/API authentication status.
- `saas.account.summary.read`: Read neutral account and subscription summary.
- `saas.billing.plans.read`: Read billing plan metadata.
- `saas.billing.state.read`: Read current account billing state.
- `saas.billing.checkout.create`: Create a billing checkout redirect contract.
- `saas.storage.presigned-upload.create`: Create an S3-compatible presigned upload contract.
- `saas.anss.capabilities.read`: Read the Agent-readable service capability list.

Read the full mapping at `/anss/saas.service-map.yaml`.

## Invocation Adapters

- OpenAPI contract: `/anss/openapi/saas.openapi.yaml`
- ACLIP-ready CLI contract: `interfaces/aclip/saas.md`
- MCP tool contract: `interfaces/mcp/saas.md`
- Remote MCP endpoint: `/mcp`
- Skill-facing guides: `interfaces/skills/`

Adapter install state:

- OpenAPI: `available`
- CLI: `development-local`
- MCP local: `development-local`
- MCP remote: `available`
- Skills: `guide-only`

Local API examples:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/integrations/health
curl http://localhost:3001/auth/status
curl http://localhost:3001/billing/plans
curl http://localhost:3001/anss/capabilities
```

Local CLI examples:

```bash
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas health read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas integrations read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas auth status --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas account summary read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas billing plans read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas billing state read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas billing checkout create --body <json> --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas storage presigned-upload create --body <json> --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas anss capabilities read --json
```

## Auth And Safety

ANSS only declares safety metadata. It does not implement authentication, authorization, confirmation UI, audit storage, an Agent runtime, or a third-party registry.

Read-only public capabilities may be called without a user session. Account, billing, storage, admin, and write actions must use the same service-defined authentication, authorization, confirmation, and audit boundaries as the human Web UI.

Do not infer permission from User-Agent. User-Agent and Agent headers are discovery or negotiation hints, not authorization.

For local CLI/API validation, the starter supports an optional service-token check:

- set `SAAS_SERVICE_TOKEN` on the API process;
- set `SAAS_API_TOKEN` on the CLI or MCP caller;
- call `saas auth status --json` to confirm whether the token is accepted.

This is not a replacement for product authentication. Production projects should use the same auth model as their human product.

## Current Limits

- `llms.txt` is the starter-maintained minimal Agent index. Projects that need a full documentation site can add the optional `docs-site` extension.
- The CLI is implemented with `@oworker/aclip` and remains a development-local distribution by default. Projects can publish binaries or packages later without changing the capability contract.
- MCP is exposed at `/mcp` using Streamable HTTP and is suitable for consumer Agent installation from the service canonical root. Production projects should replace the local service-token example with their real product auth before exposing sensitive tools.
- Skills are guide-only by default. Projects can package client-specific Skills later without changing the service capability contract.
- The ANSS v0.1 boundary and return-to-Starter-mainline gate are documented in `docs/anss-v0.1.md`.
