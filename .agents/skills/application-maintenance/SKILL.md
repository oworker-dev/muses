---
name: application-maintenance
description: Maintain an OWorker Application Starter project.
---

# Application Maintenance

Use this skill when changing the runnable application layer.

Rules:

1. Keep `src/apps/web` as the default runnable web application.
2. Keep shared contracts, domain logic, config, validation, SDK, and shared helpers under `src/packages/`.
3. Do not hide provider-specific logic inside the web UI layer.
4. Update `interfaces/openapi/`, `interfaces/mcp/`, or `interfaces/skills/` when externally callable behavior changes.
5. Update contract or smoke tests with any public behavior change.
6. Run `npm run check` before handing off.
