# SaaS ACLIP-Ready CLI Surface

> Generated from `src/apps/api/src/capabilities.mjs`. Do not hand-edit capability mappings here; update the Hono capability contract instead.

The SaaS Starter includes a local CLI at `src/apps/cli`. It is implemented with `@oworker/aclip` for Agent-native command disclosure, manifest semantics, structured output, and credential metadata. Business behavior remains a thin forwarder to the Hono API.

Set the API base URL with:

```bash
SAAS_API_BASE_URL=http://localhost:3001
```

Adapter install state:

- Status: `development-local`
- Install manifest: `/anss/install/cli.json`
- Protocol runtime: `@oworker/aclip`
- External distribution: `not-configured`

Each command uses the capability `inputSchema`, `outputSchema`, `errorSchema`, and `safety` facts declared in `/anss/saas.service-map.yaml`. The CLI does not define a separate business contract.

Supported commands:

```bash
pnpm --filter ./src/apps/cli run saas -- saas health read --json
pnpm --filter ./src/apps/cli run saas -- saas integrations read --json
pnpm --filter ./src/apps/cli run saas -- saas auth status --json
pnpm --filter ./src/apps/cli run saas -- saas account summary read --json
pnpm --filter ./src/apps/cli run saas -- saas billing plans read --json
pnpm --filter ./src/apps/cli run saas -- saas billing state read --json
pnpm --filter ./src/apps/cli run saas -- saas billing checkout create --body <json> --json
pnpm --filter ./src/apps/cli run saas -- saas storage presigned-upload create --body <json> --json
pnpm --filter ./src/apps/cli run saas -- saas anss capabilities read --json
```

Command mapping:

| Service capability | CLI command | Hono API |
|---|---|---|
| `saas.health.read` | `saas health read --json` | `GET /health` |
| `saas.integrations.read` | `saas integrations read --json` | `GET /integrations/health` |
| `saas.auth.status.read` | `saas auth status --json` | `GET /auth/status` |
| `saas.account.summary.read` | `saas account summary read --json` | `GET /account/summary` |
| `saas.billing.plans.read` | `saas billing plans read --json` | `GET /billing/plans` |
| `saas.billing.state.read` | `saas billing state read --json` | `GET /billing/state` |
| `saas.billing.checkout.create` | `saas billing checkout create --body <json> --json` | `POST /billing/checkout` |
| `saas.storage.presigned-upload.create` | `saas storage presigned-upload create --body <json> --json` | `POST /storage/presigned-upload` |
| `saas.anss.capabilities.read` | `saas anss capabilities read --json` | `GET /anss/capabilities` |

The ACLIP runtime declares `SAAS_API_TOKEN` as the service-token credential and forwards it as a bearer token when it is present. Product write actions should require explicit authentication, authorization, confirmation, and audit behavior before being added to this surface.
