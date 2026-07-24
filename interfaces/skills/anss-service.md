# ANSS Service Skill

> Generated from `src/apps/api/src/capabilities.mjs`. This is a skill-facing guide, not a packaged client-specific Skill bundle.

Use this guide when an Agent needs to discover and call this generated SaaS service.

Start from the canonical root, then read:

- `/agent-guide.md`
- `/.well-known/anss.json`
- `/anss/saas.service-map.yaml`
- `/anss/install/index.json`
- `/llms.txt`

Current adapter install states:

- OpenAPI: `available`
- CLI: `development-local`
- MCP local: `development-local`
- MCP remote: `available`
- Skills: `guide-only`

For local validation:

```bash
pnpm run anss:conformance
pnpm run anss:agent-probe
```

For CLI/API authentication status:

```bash
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas auth status --json
```
