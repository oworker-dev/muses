# AI Design Platform Architecture Baseline

## Outcome

The project is now governed as an open, composable AI creation operating system rather than a neutral SaaS starter. APCC holds the durable goal, plans, tasks, decisions, owners, and version records; authored docs hold product and architecture explanation.

## Accepted Scope At Baseline Time

- Product overview and long-lived end goal.
- Kernel-first, contract-first, composition-validated architecture.
- Authoritative domain objects and ownership boundaries.
- Creative document, command/version, canvas, asset/provenance, job, capability, Agent, workflow, media, realtime, and policy kernels.
- Schema, event, error, observability, security, deployment, compatibility, and service-split rules.
- The original Wave 0–5 roadmap and three-gate reusable-module acceptance model. APCC decision `mvp` later replaced its serial delivery order with vertical slices while preserving the kernel boundaries.

## Evidence

- `apcc doctor check` passes.
- At baseline time, `apcc status` resolved the end goal and Wave 0 next actions; current execution state is derived from the Platform Core Alpha plan.
- APCC goal and architecture decisions are approved.
- APCC docs site builds and runs in Chinese at the persisted preferred port.
- Canonical architecture and acceptance documents are linked from project entrypoints.

## Risks Carried Forward

- Schema and package boundaries remain provisional until a user outcome actually exercises them and the relevant independent/contract evidence is available.
- Canvas rendering technology and realtime merge strategy require measured prototypes.
- Model providers for the first image capability remain a reversible adapter decision.
- Current SaaS data model is not yet tenant-complete for the creative platform and must not be assumed to satisfy future isolation requirements.
- Production TLS, managed secrets, external storage, billing webhooks, backups, scaling, and rollout remain deployment work.

## Next Handoff

Follow `docs/internal/Agent优先创作与工作流模型.md` and APCC decision `agent-first`. The real-image path is now the first reusable Agent tool foundation. Separate the creative canvas, Agent plan, and callable workflow identities; deliver the Operation Gateway and independent Agent Core; pass single-Agent safety and recovery before orchestration, then enter PPT. Record any change to architecture ownership or protocol semantics as an APCC decision first.
