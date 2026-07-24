# Service Map

This directory describes ANSS service capabilities and how they map to human UI, Hono API routes, ACLIP-ready CLI commands, MCP tools, and skill-facing guides.

This is not the same thing as Starter capabilities in `.oworker/manifest.json` or infrastructure modules under `src/packages/`.

The SaaS Starter keeps the first service map small and verifiable. The JSON file is the machine-readable source of truth; YAML files are generated from it:

```bash
pnpm run anss:sync
pnpm run anss:check
```

- `saas.health.read`
- `saas.integrations.read`
- `saas.auth.status.read`
- `saas.account.summary.read`
- `saas.billing.plans.read`
- `saas.billing.state.read`
- `saas.billing.checkout.create`
- `saas.storage.presigned-upload.create`
- `saas.anss.capabilities.read`

Future projects can expand this map as product-specific service capabilities become real.
