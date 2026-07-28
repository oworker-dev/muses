# Design

> Product architecture has moved beyond the neutral SaaS starter. The canonical
> long-lived architecture is `docs/internal/长期架构.md`; the canonical product
> overview and end goal are `docs/shared/概览.md` and `docs/shared/目标.md`.
> This file retains the starter baseline and repository conventions. When it
> conflicts with an approved APCC decision or the canonical architecture, the
> approved decision and canonical architecture take precedence.

Use this file as the SaaS project's durable design notes. Keep it focused on the product being built, the chosen architecture, and the maintenance rules that help future developers and development Agents make coherent changes.

## Project Intent

This project uses the production-minded SaaS foundation as the platform base for an open, composable AI creation operating system. Authentication, account lifecycle, billing, storage, queues, administration, audit, API, worker structure, and provider boundaries remain foundations; creative-document, canvas, Agent, workflow, job, provenance, and media capabilities define the product architecture.

## Durable Decisions

- Treat `docs/internal/长期架构.md` as the canonical architecture and require an APCC architecture decision before changing its core boundaries.
- Let observable user outcomes pull the smallest required kernel work; require independent, protocol, composition, and scenario evidence before calling a module reusable.
- Keep scenarios above kernel contracts; never add ecommerce, PPT, social, or other scenario types to a kernel solely for one delivery.
- Use an Agent-first `CreativeCanvas` as the default creation space and an independent `ProfessionalWorkspace` for callable `WorkflowDefinition` editing; treat Design, Presentation, Video, and Audio documents as professional states with their own authority.
- Distinguish exploratory/context/provenance relationships from executable typed workflow edges; a canvas graph is not automatically a published workflow.
- Expose every Agent operation through the same server-authoritative Query, Command, and Capability boundary as UI/API callers; complete the single-Agent safety loop before adding MusesAgent, domain-agent profiles, or multi-Agent scheduling.
- Use AI Elements + XYFlow only as the first outer-canvas projection candidate, Workflow SDK only as a durable execution candidate, and Eve/Pi only behind a replaceable Agent Harness port; Muses documents, commands, assets, provenance, jobs, and policies remain authoritative.
- Route human, Agent, workflow, and API mutations through shared Command, Capability, Job, policy, and provenance boundaries.
- Start as a modular monolith with isolated workers; split services only from measured scaling, fault-domain, security, data-sovereignty, deployment, or ownership evidence.
- Treat audio, music, voice, and sound as first-class media capabilities with professional time, track, licensing, and provenance semantics.
- Use `docs/shared/价值宪法.md` as the value gate: architecture elegance alone never justifies implementation or continued investment.
- Use `docs/internal/Agent优先创作与工作流模型.md` as the current delivery order: complete Agent Core and its reliability/orchestration gates before entering PPT.
- Keep the core product, protocols, formats, and migration paths open and self-hostable; protect private user data and security material from Build in Public disclosure.

- Keep `src/` as the implementation root.
- Keep app entry points under `src/apps/`: web, API, MCP, and worker.
- Keep shared application, domain, contract, database, billing, email, cache, queue, storage, and observability code under `src/packages/`.
- Keep provider-specific adapters under `src/providers/`.
- Keep user-facing and Agent-facing service descriptions under `interfaces/`.
- Keep ANSS service capability mapping under `interfaces/service-map/`; do not confuse it with Starter capability tags or infrastructure modules. Treat `interfaces/service-map/saas.service-map.json` as the machine-readable service capability source of truth.
- Keep delivery goals, acceptance evidence, risks, and handoff context under `delivery/`.
- Keep runtime, deployment, and operations notes under `ops/`.
- Keep PostgreSQL with pgvector as the default data infrastructure for SaaS and future semantic features.
- Keep shadcn/ui as the default UI primitive baseline.
- Keep next-themes as the default light/dark theme boundary.
- Keep next-intl as the minimal internationalization baseline.
- Keep React Email as the default transactional email template boundary.
- Keep Account Console as an explicit account/settings surface; do not use it as the default post-auth landing page and do not assume the product is a dashboard/workbench SaaS.
- Reuse the Site Admin Console shell, site-admin authorization, and audit boundary for two visibly separated groups: website operations and the Muses platform control plane. Product control-plane pages may manage versioned model offerings, capability profiles, prices, routing, budgets, and usage, but must not grow into a generic CRM or unbounded product back office.
- Require an authenticated, verified account and authorized workspace for Studio and every Studio API. Keep model charges in an immutable workspace credit ledger with idempotent reservation, settlement, release, and audit semantics; Stripe payment records and model-usage credits remain separate ledgers.
- Keep first-party analytics aggregate and privacy-minded by default; associate signed-in page views through hashed user ids, use rollups for admin reads, and do not store raw IP addresses in the starter baseline.
- Keep provider choices replaceable by documenting environment variables, fallbacks, and verification commands.
- Update contract tests and interface descriptions when public behavior changes.

## Default SaaS Capabilities

The default foundation includes:

- email/password registration and sign in;
- account email verification;
- password reset, change password, and verified email change;
- auth mutation rate limiting and baseline security headers;
- optional GitHub and Google OAuth;
- protected account center for identity, avatar upload, lifecycle, subscription, and payment records;
- callback-aware auth flows that return to the requested path and otherwise fall back to the public homepage;
- site-admin console for account lifecycle, revenue, subscriptions, aggregate analytics, health, audit logs, and diagnostics;
- first-party analytics event ingestion, account activity summaries, and rollup-based reporting;
- system-aware light/dark theme support;
- account subscription state;
- Stripe-compatible checkout, portal, and webhook boundaries;
- S3-compatible avatar upload through the account center;
- idempotent payment record persistence for successful provider payment events;
- React Email transactional templates with Resend-compatible delivery and local-test fallback;
- Hono API for health, integration status, auth status, account summary, billing state, checkout contracts, storage upload contracts, and ANSS capabilities;
- ANSS discovery signals, service guide, generated service map, ACLIP-ready CLI, Agent discovery probe, and conformance smoke for a minimal Agent calling loop;
- MCP executable skeleton and worker service surfaces;
- PostgreSQL with pgvector, Valkey, MinIO, and BullMQ through Docker Compose.

## UI System

The default UI baseline is restrained and replaceable:

- Use shadcn/ui primitives for reusable components.
- Use semantic theme tokens for canvas, foreground, cards, muted surfaces, borders, and status states.
- Keep typography simple: system sans or Geist-like sans, weights 400/500/600, `letter-spacing: 0`.
- Use an 8px spacing rhythm, 6px button radius, and 8px card radius.
- Prefer lucide icons for modules and actions.
- Keep accent color functional: focus rings, links, success/error states, and provider status.
- Keep light and dark mode coherent before adding new product surfaces.
- Keep starter UI functional and easy to replace; defer specialized visual systems, sidebars, and product dashboards until product workflow needs them.

## Product Module Notes

When adding product modules, define:

- the user workflow;
- the data model and migrations;
- the web route or API surface;
- any provider or environment requirements;
- production configuration doctor expectations when the module needs secrets or external services;
- the contract, integration, and smoke tests that prove the module works.
