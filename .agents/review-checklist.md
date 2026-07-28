# Review Checklist

- Agent entrypoints remain clear: `AGENTS.md`, `DESIGN.md`, `.agents/skills/`.
- Consumer-agent interfaces are updated when externally callable behavior changes.
- Implementation stays under `src/`.
- Provider-specific code stays replaceable.
- Contract and smoke tests cover public behavior.
- Runtime changes are reflected in `ops/`.
- Workflow node changes update `docs/internal/专业模式节点产品目录.md`, versioned DSL and migration notes, runtime adapters, both locale catalogs, UI projections, templates, and task-level verification in the same change.
