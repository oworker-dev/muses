# AI Design Platform Architecture Baseline

## Outcome

The project is now governed as an open, composable AI creation operating system rather than a neutral SaaS starter. APCC holds the durable goal, plans, tasks, decisions, owners, and version records; authored docs hold product and architecture explanation.

## Accepted Scope

- Product overview and long-lived end goal.
- Kernel-first, contract-first, composition-validated architecture.
- Authoritative domain objects and ownership boundaries.
- Creative document, command/version, canvas, asset/provenance, job, capability, Agent, workflow, media, realtime, and policy kernels.
- Schema, event, error, observability, security, deployment, compatibility, and service-split rules.
- Wave 0–5 roadmap and three-gate reusable-module acceptance model.

## Evidence

- `apcc doctor check` passes.
- `apcc status` resolves the real end goal and Wave 0 next actions.
- APCC goal and architecture decisions are approved.
- APCC docs site builds and runs in Chinese at the persisted preferred port.
- Canonical architecture and acceptance documents are linked from project entrypoints.

## Risks Carried Forward

- Wave 0 concrete Schemas and package boundaries are intentionally not frozen in this baseline.
- Canvas rendering technology and realtime merge strategy require measured prototypes.
- Model providers for the first image capability remain a reversible adapter decision.
- Current SaaS data model is not yet tenant-complete for the creative platform and must not be assumed to satisfy future isolation requirements.
- Production TLS, managed secrets, external storage, billing webhooks, backups, scaling, and rollout remain deployment work.

## Next Handoff

Start `specify-wave-0-contracts` before implementation. Produce versioned Schemas, state machines, ports, migration fixtures, failure cases, security rules, a contract-test matrix, and a proposed `src/packages` boundary. Record any change to architecture ownership or protocol semantics as an APCC decision first.
