# API App

This app is the canonical HTTP API surface for SaaS domain capabilities.

The Web app may expose framework-adjacent routes, but durable product APIs should live here and be mirrored in `interfaces/openapi`.

Default neutral contracts include health, ANSS capability listing, integration health, CLI/API auth status, account summary, billing plans, billing state, checkout, and S3-compatible presigned upload creation.

The ANSS capability list is loaded from `interfaces/service-map/saas.service-map.json`, so runtime capabilities, public service-map YAML, CLI commands, and MCP skeleton tools stay aligned around the same service capability source.

```bash
pnpm --filter ./src/apps/api run dev
```
