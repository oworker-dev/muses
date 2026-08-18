# Delivery

The current product direction and architecture baseline are recorded in
`delivery/architecture-baseline.md`. This document continues to describe the
accepted SaaS foundation on which the AI design platform is being built.

The first fixture-driven `image.to-editable.v1` evidence is under
`delivery/evidence/image-to-editable/corporate-report/`. It reconstructs the
provided 1672×941 corporate report into a layered SVG with native text and
charts, three bounded raster layers, a host-neutral scene manifest, and
render-back QA. This evidence proves the deterministic export boundary only;
it does not claim that the general VLM/Image Edit pipeline or public Media API
is complete.

The first real Provider Spike v2 evidence is under
`delivery/evidence/image-to-editable/provider-spike-v2/`. It records one
`gpt-5.6-sol` scene analysis, one hierarchy-batched `gpt-image-2` foreground
Edit, one Edit-only background Repair, 99 native text layers, 24 replaceable
raster layers, one editable background, automatic crop/placement data, and a
`0.9073` render-back similarity. It is a retained **failed visual-quality
regression sample**: the old structural QA marked it as passed despite
background swallowing, geometry drift, chroma leakage, and redraw noise. It
does not constitute a Provider quality gate, standalone Media API, or broad
production validation.

The revised Provider Spike v3 analysis and replay evidence is under
`delivery/evidence/image-to-editable/provider-spike-v3/`. The analysis uses
`gpt-5.6-sol` and classifies bounded artwork, containers, leaves, and native
text. The first Image Edit replay still failed the transparent redraw gate, so
the pipeline now excludes failed model assets from publication and records an
explicit source-preserving fallback. The checked replay is under
`provider-spike-v3-source-fallback/`: it reaches `0.9956` render-back
similarity with 75 raster layers, but remains `partial` because all 75 layers use
source-preserving fallback rather than successful transparent redraws. This is a visual-protection
regression artifact, not a production-quality pass. All 128 SVG text nodes are
retained but hidden under source-preserved text, so `editableTextVisible` also
fails explicitly.

The current value, open-development, and real-work validation boundary is
recorded in `delivery/value-foundation.md`.

The current engineering critical path is recorded in
`docs/internal/Agent优先创作与工作流模型.md`. The completed and remaining
Platform Core foundation is recorded in `delivery/platform-core-alpha.md` and
`docs/internal/平台核心Alpha路线.md`.
The product reasons, priorities, target contracts, and mandatory maintenance
rules for professional-mode nodes are recorded in
`docs/internal/专业模式节点产品目录.md`.
The current outcome-first sequence, parallel first-image evidence, Agent gate,
and later PPT expansion rules are recorded in
`docs/internal/用户成果驱动交付计划.md`.
The frozen A9 failure fixtures, product authorities, passing evidence and
residual-risk rules are recorded in
`delivery/agent-core-a9-reliability-gate.md`.
The A10 delegation identity, explicit-context, authority, DAG, budget and
scheduler boundary is recorded in
`delivery/agent-orchestration-a10-contract.md`; its canonical long-term design
is `docs/internal/Agent委托与调度协议.md`. The framework-neutral Scheduler,
PostgreSQL Store, concurrent logical-budget reservation, independent Child
Agent Runtime, Workflow SDK durable driver, whole-tree trace/billing lineage,
fixed recovery eval and authorized production entry are recorded in
`delivery/agent-orchestration-a10-scheduler.md`.
The A11 trusted parent-result projection, PostgreSQL continuation receipt,
bounded parent follow-up, completed-parent DelegationRun cancellation and SDK
driver reconciliation Gate is recorded in
`delivery/agent-orchestration-a11-continuation.md`; its consumer-facing
contract is `interfaces/agent-runtime.md`. Current deterministic and browser
cancellation evidence, together with the open image-Provider prerequisite for
the real Artifact continuation case, is under
`delivery/evidence/agent-core-alpha/a11-continuation/`.
The capability-scoped Provider Connection, encrypted credential rotation,
Offering binding, runtime route freezing, health projection, and verification
evidence is under
`delivery/evidence/platform-core-alpha/provider-connection-vault/`.
The earlier PPT-first slice remains historical scenario-planning context in
`delivery/mvp-delivery.md` and `docs/internal/MVP交付路线.md`.
The corrected durable execution boundary, supported-node interpreter, and its
remaining limitations are in
`delivery/evidence/platform-core-alpha/gate-0/workflow-sdk-boundary/`.
The first authenticated single-Agent real-image loop, PostgreSQL Agent state,
Workflow SDK driver, Operation Gateway canvas placement, browser restoration,
and explicit A7 limitations are in
`delivery/evidence/agent-core-alpha/a7-single-agent-loop/`; the completed real
follow-up, single-charge placement and refresh evidence is in
`delivery/evidence/agent-core-alpha/a7-steering-loop/`.

This SaaS starter is acceptable when a newly created project can be run, verified, and extended without hidden OWorker platform dependencies.

## Scope

- Local-first neutral SaaS runtime with Web, API, worker, PostgreSQL, Valkey, and MinIO.
- Docker workflow split for daily infrastructure, image build, full rebuild acceptance, stop, and reset.
- Email/password authentication with email verification, password reset, change password, verified email change, optional GitHub/Google OAuth, protected account center, and server-side protected routes.
- Database-backed auth rate limiting and conservative default security headers.
- Neutral landing page, account console with avatar upload, account billing, site-admin visibility, account subscription state, and subscription controls.
- System-aware light/dark theme support and mobile-safe public/auth surfaces.
- Stripe-compatible checkout, portal, persisted subscription state, payment records, and idempotent webhook boundaries that fail closed until provider credentials are configured.
- Explicit billing state contract for the current account subscription.
- First-party analytics event ingestion, account activity summaries, and rollup-based admin visibility without raw IP storage.
- Audit logs for security-sensitive account, billing, and admin actions.
- S3-compatible presigned upload contract with MinIO-backed local acceptance.
- Account avatar upload backed by the same S3-compatible object storage boundary.
- Resend-compatible account lifecycle email workflows with React Email templates and local-test fallback.
- Production configuration doctor for unsafe defaults and missing production env.
- Open provider boundaries for database, cache, queue, storage, email, billing, and observability.
- Contract surfaces under `interfaces/` and verification under `tests/` and `scripts/`.

## Acceptance

1. `pnpm install` completes from the project root.
2. `pnpm run docker:up` starts the local stack without forcing an image rebuild.
3. `http://localhost:3000/register` creates the first account and sends a verification email.
4. Anonymous users cannot enter protected account routes such as `http://localhost:3000/account`.
5. Unverified email/password users land on `http://localhost:3000/verify-email` and can resend verification from that screen.
6. Verified users can review `http://localhost:3000/account`.
7. Verified users can change password from `http://localhost:3000/account` and sign in with the new password.
8. Verified users can upload an account avatar from `http://localhost:3000/account`, and the image persists through S3-compatible object storage.
9. `http://localhost:3000/forgot-password` sends a password reset email through the configured email boundary.
10. Better Auth creates the database-backed `rateLimit` table and returns 429 when auth mutation limits are exceeded.
11. Web responses include baseline security headers such as `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
12. Verified users can review `http://localhost:3000/account/billing`.
13. The first verified local user, or a configured `SITE_ADMIN_EMAILS` user, can review `http://localhost:3000/admin`, including account activity, aggregate analytics, service health, audit logs, and diagnostics.
14. `http://localhost:3001/health` reports `ok`.
15. `http://localhost:3001/integrations/health` reports `ok` for database, cache, queue, and storage in Docker.
16. `http://localhost:3001/account/summary` returns account and subscription data.
17. `http://localhost:3001/billing/state` returns the active billing provider mode, subscription state, and persisted Stripe identifiers when configured.
18. `http://localhost:3001/storage/presigned-upload` returns a PUT upload contract when storage is configured.
19. `pnpm run smoke` passes after Docker is healthy, proves analytics ingestion, billing webhook idempotency, payment record creation, subscription updates, and uploads through the presigned URL.
20. `pnpm run doctor:production` reports local development warnings without crashing.
21. `pnpm run doctor:production:strict` fails until production secrets and provider credentials are configured.
22. `pnpm run e2e` passes after Docker is healthy and the Playwright Chromium browser is installed.
23. The browser gate proves no horizontal overflow on a mobile landing viewport and verifies the default theme toggle.

The maturity freeze is documented in `delivery/maturity-freeze.md`.
The full V1 release gate is documented in `delivery/v1-release-gate.md`.

## Boundaries

- Cloud email, live billing, managed database, managed storage, and SSO are not required default assumptions.
- The included Compose stack is local production-like acceptance, not a complete production deployment platform.
- Production TLS, ingress or load balancing, secret management, backups, scaling, observability, and rollout strategy belong to the created project and target platform.
- Add provider-specific services only through explicit adapters or extensions.
- The neutral demo surfaces are replaceable. When building a real product, define product-specific workflows, data models, and business modules directly in the created project and keep their contracts and verification evidence aligned.
- Keep APCC records aligned with this directory when `.apcc/` is present.
