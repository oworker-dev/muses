# SaaS MCP Surface

> Generated from `src/apps/api/src/capabilities.mjs`. Do not hand-edit tool mappings here; update the Hono capability contract instead.

The starter exposes a remote MCP endpoint at `/mcp` using Streamable HTTP and keeps tool definitions contract-first. The local `src/apps/mcp` executable remains a development helper, but consumer Agents should discover and install the remote endpoint from `/anss/install/mcp.json`.

Adapter install state:

- Local MCP: `development-local`
- Remote MCP: `available`
- Remote endpoint: `/mcp`
- Remote transport: `streamable-http`
- Install manifest: `/anss/install/mcp.json`

Initial tool contracts:

- `saas.health.read`: Read service health.
- `saas.integrations.read`: Read configured integration defaults.
- `saas.auth.status.read`: Read CLI/API authentication status.
- `saas.account.summary.read`: Read neutral account and subscription summary.
- `saas.billing.plans.read`: Read billing plan metadata.
- `saas.billing.state.read`: Read current account billing state.
- `saas.billing.checkout.create`: Create a billing checkout redirect contract.
- `saas.storage.presignedUpload.create`: Create an S3-compatible presigned upload contract.
- `saas.anss.capabilities.read`: Read the Agent-readable service capability list.

The local development helper can list tools or call a service-map-backed tool from the command line:

```bash
pnpm --filter ./src/apps/mcp run start
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/mcp run start -- call saas.health.read
```

Remote MCP calls forward authorization to the Hono capability boundary. Production projects should replace the local service-token example with the product's real auth, authorization, confirmation, and audit model.

Remote MCP tools expose generated input and output schemas from the service map. ANSS does not implement authorization or confirmation flows; it only exposes safety metadata so a consumer Agent can decide when user approval or credentials are required by the product service.
