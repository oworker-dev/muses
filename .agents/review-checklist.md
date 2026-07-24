# Review Checklist

- Agent entrypoints remain clear: `AGENTS.md`, `DESIGN.md`, `.agents/skills/`.
- Consumer-agent interfaces are updated when externally callable behavior changes.
- Implementation stays under `src/`.
- Provider-specific code stays replaceable.
- Contract and smoke tests cover public behavior.
- Runtime changes are reflected in `ops/`.
