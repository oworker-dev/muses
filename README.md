# Muses

> **Muses** is the project codename for an open, composable AI creation
> operating system. Start with
> `docs/shared/概览.md`, `docs/shared/目标.md`,
> `docs/shared/价值宪法.md`, `docs/shared/开放原则.md`, and
> `docs/internal/Agent优先创作与工作流模型.md`. Use `apcc status` for the current goal, phase,
> tasks, decisions, and handoff state. The starter documentation below remains
> the operational baseline for the existing SaaS foundation.

Muses is being built in public around real AI short-drama and PPT delivery
workflows. It combines a structured creative document, immersive canvas,
controllable Agents, reusable workflows, and image, video, audio/music, brand,
presentation, and social-media capabilities without locking users into one
model provider, deployment, or proprietary project format.

## Source Availability Notice

The source is publicly visible for early review and collaboration. The project
has approved a fully open-source direction, but the final license decision is
still tracked in APCC and no `LICENSE` file has been issued yet. Until that
decision is recorded and a license file is added, copyright law reserves reuse,
modification, and redistribution rights. Do not describe this snapshot as an
open-source release yet.

The repository must never contain user projects, customer materials, API keys,
OAuth secrets, production credentials, or private telemetry. See
`docs/shared/开放原则.md` for the Build in Public boundary.

## Current Stage

The current APCC engineering phase is **Agent Core Alpha**. The professional
image path has delivered reusable image, identity/credit, model-catalog,
durable-runtime, and observability foundations. The platform now separates
`CreativeCanvas`, `ExecutionPlan`, and callable `WorkflowDefinition`, has a
server-authoritative Operation Gateway and independently runnable Agent Core,
and has verified the first authenticated natural-language-to-real-image Agent
loop with PostgreSQL Run/Event persistence and Gateway-controlled canvas
placement. Studio now defaults to a creative-mode projection where the real
Asset is visible and movable, its position survives refresh, and the persisted
three-step ExecutionPlan can be expanded from the Agent panel. A real
follow-up now revises that plan, generates one charged image, places it beside
the previous Asset and survives refresh. Callable workflow publication now
resolves immutable server-owned versions through one UI, Agent, and HTTP API
invocation boundary. The A9 reliability Gate remains ahead of orchestration or
PPT scenario work. See
`docs/internal/Agent优先创作与工作流模型.md`,
`docs/internal/用户成果驱动交付计划.md`,
`docs/internal/平台核心Alpha路线.md`, and run `apcc status` for current state.

The A7 engineering evidence is under
`delivery/evidence/agent-core-alpha/a7-single-agent-loop/` and
`delivery/evidence/agent-core-alpha/a7-steering-loop/`; A8 publication evidence
is under `delivery/evidence/agent-core-alpha/a8-callable-workflows/`. The images
are visible in both the restored Agent panel and the default creative canvas;
its Asset and position are authoritative through the Operation Gateway. Muses
also records generated-image identity and storage provenance independently
from Workflow SDK `returnValue`. A7 and A8 do not claim the A9 reliability or
multi-media experience.

The professional Studio now has protected Start/End nodes, typed Start inputs,
a framework-independent publication validator, a pure
`WorkflowDocument → WorkflowDefinition` compiler, and a supported-node domain
interpreter. The compiled definition has its own versioned schema and strips
canvas and run-result state. Publication now compiles a server-owned draft into
an immutable sequential version and moves a stable Deployment alias; the run
endpoint rejects mutable browser graphs and resolves only an exact version or
Deployment before starting a real Vercel Workflow SDK run persisted through
Postgres World. MusesAgent reaches the same boundary through `workflow.list`,
`workflow.inspect`, and `workflow.invoke`. The Gate 0 Harness executes
Start, server fixture image references, a real Hook-based human Selector,
DesignDocument reference creation, and End while streaming a queryable run
projection. It is not yet an arbitrary-node or real Capability/Job runtime; the
browser deterministic image action remains explicitly labeled and separate.
The waiting Selector projection now survives browser refresh and Web/Workflow
container restart through Postgres World recovery. A Muses-owned PostgreSQL
resume receipt supplies the request idempotency that Workflow SDK Hook resume
calls do not provide themselves.
Waiting runs can also be cancelled through a Muses-owned mutation receipt and a
run-scoped lock shared with resume, preventing duplicate cancellation events and
stale Selector actions after the Hook is disposed.

Studio now requires a verified Better Auth session and provisions one stable
personal Muses Workspace with an owner membership and idempotent development
credit grant. Studio APIs authorize every run and generated asset against that
Workspace. Real image runs reserve credit before Workflow SDK or provider
execution, settle known usage, release explicit failures, and retain ambiguous
provider outcomes for review. The Studio header and Account Billing page expose
the resulting available/reserved credit projection. A versioned model catalog
now supplies Studio configuration and freezes Offering, Capability Profile and
PriceBook facts into paid-run reservations; `/admin/models` provides the first
audited enable/disable control. The current flat image price and initial grant
remain Alpha policies rather than production commercial commitments.

This project is generated from OWorker SaaS Starter.

It is a native, ready-to-run SaaS project package: OWorker Core structure plus a neutral SaaS seed with a single-file starter landing page, Better Auth email/password registration, email verification, password reset, change password, verified email change, optional OAuth, protected account center, avatar uploads, user billing and payment records, site-admin visibility, first-party analytics, audit logs, auth rate limiting, security headers, account subscription state, Stripe-compatible billing, S3-compatible presigned uploads, Resend-compatible transactional email with React Email templates, Hono API, ANSS discovery guide, service map, ACLIP-ready local CLI, MCP skeleton, worker skeleton, PostgreSQL with pgvector, Valkey, MinIO, BullMQ, next-intl, shadcn/ui primitives, next-themes dark mode, and structured logs.

The default stack is open and replaceable. It uses local Postgres, Valkey, and MinIO so a new project can run without cloud credentials. Provider-specific stacks should be implemented directly in the created project or published as independent native starters after the product requirements are known.

`.oworker/starter.lock.json` records the resolved starter identity, copied starter package, declared capabilities, and verify contract. It records direct starter-package output only.

## Official starter intent

OWorker SaaS Starter is a standard starting point, not a maximal SaaS generator. Its job is to give developers and development Agents a clean, mainstream, production-minded foundation that is easy to run, inspect, replace, and extend.

Use this foundation as a starting point for your product:

- define product-specific modules in the created project when the product workflow is clear
- keep public API, MCP, skill, README, delivery, and test surfaces aligned with real code
- document provider changes through environment examples, provider README files, and verification commands
- publish complex ecosystem variants as independent native starters after they are implemented and verified as coherent projects

Default stack boundaries:

- PostgreSQL with pgvector is the default Agent-era data infrastructure. It is available for future semantic search, knowledge, and Agent memory features without adding a separate vector database.
- pgvector does not mean the starter ships a default knowledge-base product, RAG workflow, or AI business feature.
- shadcn/ui is the official UI primitive baseline. Keep only primitives and project UI that are actually used by the starter; add new shadcn components when the product needs them.
- next-themes provides the default system-aware light/dark theme boundary. Keep pages token-based so future product surfaces do not fork their own color system.
- next-intl is the minimal i18n baseline. The default uses static message catalogs, a cookie-based locale selector, and no locale routing. Translated slugs and production translation workflows should be added by the created project when requirements justify them.
- React Email is the default transactional email template baseline. Keep templates provider-neutral and send them through the email provider boundary.
- S3-compatible storage is the default object storage boundary. The starter exposes presigned upload contracts, uses the same boundary for account avatar uploads, and keeps broader file-management products out of the default baseline.
- Account lifecycle is complete enough for real SaaS onboarding. The starter includes verification, password reset, password change, OAuth-only local password setup, connected-account linking and unlinking, verified email change, session revocation, and database-backed auth rate limiting.
- Account Console is an explicit account/settings surface. It shows identity, avatar upload, verification state, connected auth-provider status, password/email controls, subscription state, and payment records without assuming the product is a dashboard-style SaaS or making account management the default post-auth product landing.
- Site Admin Console is the website-owner surface for operations, security, revenue, and service health. It shows account lifecycle state, recent account activity, revenue, subscriptions, first-party aggregate analytics, service health, audit logs, and provider diagnostics without becoming a product-specific back office or user workspace.
- Billing state is explicit and queryable. The starter persists Stripe customer / subscription identifiers, records webhook events idempotently, records payment rows for successful provider payments, exposes subscription state, and keeps product-specific entitlement rules in the created project.
- First-party analytics are intentionally aggregate and privacy-minded. Page views are counted as page loads, signed-in visitors are associated through hashed user ids for aggregate reporting and last-seen summaries, raw IP addresses are not stored, and admin pages read summary/rollup tables instead of scanning raw events.
- ANSS discovery is present as a minimal, public, Agent-readable loop. The canonical root exposes machine-readable discovery signals; `/agent-guide.md`, `/.well-known/anss.json`, `/llms.txt`, and `/anss/saas.service-map.yaml` describe how Agents can find the Hono API, service map, ACLIP-ready CLI, MCP surface, and Skills without changing the human UI. `interfaces/service-map/saas.service-map.json` is the service capability source of truth; generated YAML and runtime capabilities must stay in sync. ANSS validation uses neutral starter capabilities only; product-specific examples belong in separate products or starter variants.

## Standard layout

```text
src/apps/web      # Next.js landing page, auth UI, account console, admin console, and billing routes
src/apps/api      # Canonical Hono HTTP API and neutral SaaS contract
src/apps/cli      # Minimal Agent CLI that calls the Hono API boundary
src/apps/mcp      # Agent API skeleton
src/apps/worker   # Background job skeleton
src/packages/*    # Domain, contract, DB, cache, queue, storage, email, billing, and observability ports
src/providers/*   # Replaceable provider adapters
interfaces/*      # Service map, OpenAPI, ACLIP, MCP, and skill-facing contracts
ops/docker        # Local production-like runtime for acceptance
```

## Local development

Use Docker for local backing services and run the web app with the framework dev server:

```bash
pnpm install
pnpm run docker:infra
pnpm run dev
```

This starts PostgreSQL, Valkey, and MinIO without rebuilding the web/API/worker images on every source edit.

## Docker run

```bash
pnpm install
pnpm run docker:up
```

`docker:up` starts the local production-like stack in detached mode without forcing a rebuild. If images are missing, Docker Compose builds them. If source files or dependencies changed and you want a clean container acceptance run, use:

```bash
pnpm run docker:rebuild
```

Docker scripts use the generated package name as the Compose project name, so multiple generated starters do not accidentally reuse the same `docker-web` image or container set. Set `OWORKER_DOCKER_PROJECT` when you need a custom Compose project name.

Open `http://localhost:3000/register`, create an account, verify the email address, then review `http://localhost:3000/account` and `http://localhost:3000/account/billing`.
Use the language selector on the public and auth pages to switch between the bundled English and Chinese catalogs.
Use `http://localhost:3000/forgot-password` to request a reset link, and use the account center to upload an avatar, change password, set a local password for OAuth-only accounts, connect or disconnect OAuth accounts, or request a verified email change.
Use `http://localhost:3000/admin` for site-admin visibility after `SITE_ADMIN_EMAILS` is configured or after the first verified local user bootstraps admin access.

The canonical API health endpoint is available at `http://localhost:3001/health`.
Integration defaults are available at `http://localhost:3001/integrations/health`.
The account summary endpoint is available at `http://localhost:3001/account/summary`.
The billing state endpoint is available at `http://localhost:3001/billing/state`.
The storage presigned upload endpoint is available at `http://localhost:3001/storage/presigned-upload`.
The account avatar upload flow uses the Web routes under `/api/account/avatar/*` and the same S3-compatible storage configuration.
The ANSS capability endpoint is available at `http://localhost:3001/anss/capabilities`.
The Agent Service Guide is available at `http://localhost:3000/agent-guide.md`, with discovery metadata at `http://localhost:3000/.well-known/anss.json` and `http://localhost:3000/anss/saas.service-map.yaml`.

The minimal Agent CLI calls the Hono API and returns JSON:

```bash
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas health read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas auth status --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas account summary read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas billing plans read --json
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas billing state read --json
```

For local token validation, set `SAAS_SERVICE_TOKEN` on the API process and `SAAS_API_TOKEN` on the CLI or MCP caller. This is a minimal service-token path for local Agent validation, not a replacement for production user auth.

## Optional docs site

Add the official documentation site only when the project needs a runnable docs app:

```bash
oworker starter add docs-site --dir .
```

The extension installs an independent Fumadocs app under `src/apps/docs` and does not change the SaaS web, API, auth, billing, admin, or ANSS runtime surfaces.

ANSS service-map consistency and runtime discovery can be checked with:

```bash
pnpm run anss:check
ANSS_WEB_BASE_URL=http://localhost:3000 ANSS_API_BASE_URL=http://localhost:3001 pnpm run anss:conformance
ANSS_ROOT_URL=http://localhost:3000 pnpm run anss:agent-probe
```

Stripe credentials are optional for local development. Without them, checkout and portal routes fail closed with a not-configured state. With `STRIPE_SECRET_KEY` and `STRIPE_PRICE_PRO`, `/api/billing/checkout` creates a real Checkout Session; `STRIPE_PRICE_STARTER` can map the free plan id when needed. `STRIPE_WEBHOOK_SECRET` enables live webhook signature verification; webhook events are recorded idempotently, update the persisted account subscription state, and create payment records for successful provider payments.

Resend credentials are optional. Without them, account lifecycle emails run in local-test mode and are printed by the web process. With `RESEND_API_KEY` and `RESEND_FROM`, verification, password reset, and email-change confirmations send through Resend. Resend's `onboarding@resend.dev` sender is suitable for local testing but can only deliver to addresses allowed by the Resend account until a sending domain is verified.

GitHub and Google OAuth buttons are only shown when both the provider credentials and the matching enable flag are configured. This avoids rendering social login buttons that would fail in a clean local run. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_AUTH_ENABLED=true` for GitHub; set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_AUTH_ENABLED=true` for Google.

After Docker is healthy, run:

```bash
pnpm run smoke
```

The smoke check verifies API health, integration health, account and billing state, first-party analytics event ingestion, idempotent billing webhook handling, payment record creation, and a real PUT through the S3-compatible presigned upload URL. The E2E gate also verifies avatar upload through the Account Console.

Before deploying with production environment variables, run:

```bash
pnpm run doctor:production
pnpm run doctor:production:strict
```

The non-strict run reports production-readiness warnings for local development. The strict run fails on unsafe defaults or missing required production configuration.

For browser-level release checks, install the Playwright browser once and run the E2E gate:

```bash
pnpm run e2e:install
pnpm run e2e
```

The E2E gate covers the public landing page, language selector, auth redirects, account center protection, avatar upload, connected account status, OAuth-only set-password, connected account unlinking, account billing, first-user site admin bootstrap, email verification, verified email change, password reset entry, change password, API health, integration health, mobile viewport rendering, security headers, and the default light/dark theme toggle.

If the Playwright browser download is unavailable on your machine, use an installed Chrome or Edge channel:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm run e2e
```

Docker helpers:

```bash
pnpm run docker:build    # Build service images without starting the stack.
pnpm run docker:rebuild  # Rebuild images and start the full local stack.
pnpm run docker:down     # Stop the stack and keep volumes.
pnpm run docker:reset    # Stop the stack and remove local volumes.
```

Docker helpers load the checked-in `.env.development` by default. Pass `--env-file` through the helper when you need a different local environment.

To use another host port:

```bash
$env:OWORKER_WEB_PORT="4350"
$env:OWORKER_API_PORT="4351"
$env:OWORKER_DB_PORT="5433"
$env:OWORKER_CACHE_PORT="6380"
$env:OWORKER_STORAGE_PORT="9010"
$env:OWORKER_STORAGE_CONSOLE_PORT="9011"
$env:S3_PUBLIC_ENDPOINT="http://localhost:9010"
$env:APP_URL="http://localhost:4350"
$env:BETTER_AUTH_URL="http://localhost:4350"
$env:BETTER_AUTH_TRUSTED_ORIGINS="http://localhost:4350,http://127.0.0.1:4350"
$env:API_PUBLIC_URL="http://localhost:4351"
pnpm run docker:up
```

To validate external integrations locally, pass an env file to Docker Compose:

```bash
docker compose --env-file .env.external -f ops/docker/compose.yaml up
```

Use `up --build` only when you explicitly want to rebuild the application images.

## Production deployment

The included Compose stack is a local production-like runtime, not a complete production deployment platform. It verifies production builds, migrations, service wiring, and health checks. Real production deployment should be implemented by the project owner for the chosen target platform, including TLS, ingress or load balancing, secret management, database backups, scaling, observability, and rollout strategy.
