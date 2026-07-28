# AGENTS.md

Use this repository as an OWorker Core standard SaaS project.

Read first:

- `README.md`
- `DESIGN.md`
- `delivery/README.md`
- `.agents/glossary.md`
- `.agents/review-checklist.md`
- `.agents/skills/project-maintenance/SKILL.md`

Keep these boundaries stable:

- developer-agent workflows live under `.agents/skills/`
- delivery goals, scope, acceptance, evidence, risks, and handoff notes live under `delivery/`
- consumer-agent descriptions live under `interfaces/`
- implementation lives under `src/`
- integration guidance lives under `integration/`
- runtime and delivery guidance lives under `ops/`
- product-specific modules should define their workflow, data model, routes, contracts, and verification path
- provider or ecosystem changes should be documented through provider README files, environment examples, and tests
- any workflow node addition, rename, split, merge, deprecation, or input/output semantic change must update `docs/internal/专业模式节点产品目录.md` in the same change, together with the versioned DSL, runtime adapter, both locale catalogs, UI projection, templates, and verification required by that catalog

<!-- APCC:BEGIN -->
## APCC

Use APCC in this repository.

This section is the bootstrap rule set. The full operating protocol lives in the APCC Workflow Guide.

Mandatory:

1. Verify `apcc` is available. If it is not, install it first with `npm install -g apcc`, then confirm with `apcc --help`.
2. Read the APCC Workflow Guide through `apcc guide workflow`. This is the preferred path because it does not depend on IDE skill discovery behavior. If the same workflow guide is already in context through your IDE skill system, do not reread the duplicate copy.
3. If this is a cold round or the workspace may be desynced, run `apcc site start`, then `apcc status`.
4. If `status` is not enough to explain the current goal, constraints, background, next actions, or handoff context, read the smallest relevant authored docs under `docs/`; `apcc status` is a structured control-plane summary, not a substitute for authored docs.
5. If context is still warm and no external change is suspected, continue without rerunning the full round-start sequence.
6. When plans change, refresh the workspace before resuming code work.
7. If the project identity or long-lived end goal is unclear, clarify them before substantial implementation.
8. Treat `docs/` as authored context and `.apcc/` as the structured control plane.
9. When initializing or reinitializing APCC, prefer setting the primary docs language to match the current human conversation unless the repository already has an established docs language.
10. When a new task, plan change, or execution boundary is confirmed, update `.apcc` first and only then start implementation work.
11. For targeted task or plan mutations, prefer CLI commands such as `apcc task update --parent/--plan` or `apcc plan update --parent` instead of hand-editing a single node in YAML.
12. For large plan or task trees, use `apcc plan list` and `apcc task list` filters such as `--owner`, `--status`, `--limit`, `--cursor`, and `--all`; treat pinned items as context that must stay visible, not as priority markers.
13. Before assigning work, use `apcc owner list` to avoid owner-id collisions; add missing owners explicitly instead of inventing near-duplicate ids.
14. For bulk plan or task restructuring, edit `.apcc/` directly against `apcc guide control-plane-contract`, replace fields structurally instead of appending duplicate keys, then run `apcc doctor check` and an explicit inspection command.
15. Use `apcc guide` to discover public APCC docs topics when command behavior or workspace semantics are unclear.
16. After `apcc site start`, tell the human the returned docs-site URL. Prefer a stable unique port on first start with `apcc site start --port <port>` or `.apcc/config/workspace.yaml`.
17. Do not run `apcc site stop` as an end-of-task ritual. Leave the docs site running unless the human explicitly asks to stop or clean it.
<!-- APCC:END -->
