---
name: project-maintenance
description: Maintain an OWorker Core standard project.
---

# Project Maintenance

Use this skill when changing an OWorker standard project.

Workflow:

1. Read `README.md`, `DESIGN.md`, `AGENTS.md`, and `delivery/README.md`.
2. Read APCC records when `.apcc/` exists.
3. Identify whether the change affects delivery scope, developer-agent workflows, consumer-agent interfaces, implementation, tests, integration, or operations.
4. Keep externally callable behavior described under `interfaces/`.
5. Keep implementation under `src/`.
6. Add or update verification under `tests/` for behavior changes.
7. Run the project-defined verification command before handing off.
