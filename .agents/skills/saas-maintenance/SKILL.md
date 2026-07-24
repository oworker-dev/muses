---
name: saas-maintenance
description: Maintain SaaS features in an OWorker standard starter project.
---

# SaaS Maintenance

Use this skill when changing auth, tenancy, organization, billing, admin, settings, database, or Docker runtime files.

Keep provider-specific integrations under `src/providers/`. Keep reusable contracts under `src/packages/contracts/`. Update `interfaces/*`, `tests/contracts/`, and `ops/docker/` whenever externally visible SaaS behavior changes.
