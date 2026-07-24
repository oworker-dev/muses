# CLI App

This app provides a minimal Agent CLI entry for the SaaS Starter.

It calls the Hono API programmable service boundary and returns JSON. It does not call the human Web UI.

```bash
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas health read --json
```
