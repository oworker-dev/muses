# SaaS Starter V1 Release Gate

This document defines the release gate for the first official OWorker SaaS Starter baseline.

The release gate validates the project that users receive from `oworker starter create saas`. It is not a feature-expansion phase.

## Required checks

Run the checks from a newly generated project, not only from the starter source directory.

1. Create a clean project:
   ```bash
   oworker starter create saas --dir .tmp/saas-v1-release-gate
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Run static and contract checks:
   ```bash
   pnpm run check
   ```
4. Build the web app and check the API package:
   ```bash
   pnpm run build
   ```
5. Start the local production-like Docker stack:
   ```bash
   pnpm run docker:up
   ```
6. Run API smoke checks:
   ```bash
   pnpm run smoke
   ```
   The smoke check covers API health, integration health, account summary, billing state, billing plans, analytics event ingestion, idempotent billing webhook handling, payment record creation, and a real PUT through the S3-compatible presigned upload URL.
7. Run the production configuration doctor:
   ```bash
   pnpm run doctor:production
   ```
8. Install the Playwright browser once on the machine if needed:
   ```bash
   pnpm run e2e:install
   ```
9. Run browser-level E2E checks:
   ```bash
   pnpm run e2e
   ```
   If Playwright browser installation is unavailable on a development machine, use an installed Chrome or Edge channel:
   ```bash
   PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm run e2e
   ```
10. Verify with the CLI:
   ```bash
   oworker starter verify --dir .tmp/saas-v1-release-gate
   ```

## Browser path

The V1 browser gate covers:

- public landing page renders;
- public header controls work without layout shift;
- unauthenticated account center access redirects to login;
- callback-aware auth flows return to the requested path and otherwise fall back to the public homepage;
- email/password registration creates an account;
- registration redirects to the email verification screen;
- unverified users can resend verification from the email verification screen;
- email verification unlocks account center;
- account avatar upload persists through S3-compatible storage;
- account console renders identity, security, connections, subscription, settings, and billing paths without horizontal overflow;
- account billing renders for verified users;
- a configured site admin, or the first verified local user when no admin list is configured, can enter the site admin overview, users, revenue, subscriptions, analytics, health, audit logs, and diagnostics paths;
- verified users can request a password reset and change their password;
- web responses include the default security headers;
- API health and integration health report `ok`;
- integration health reports only the stopped dependency and does not mark unrelated dependencies as failed;
- mobile public, auth, account, and admin viewports do not horizontally overflow;
- default theme controls support system, light, and dark modes.

## V1 non-blockers

These are valuable follow-up candidates, but they do not block the V1 baseline:

- docs site, `llms-full.txt`, or `fumadocs`;
- React Email template preview workflow;
- external analytics provider integration;
- provider matrices for database, auth, billing, storage, deployment, or China-specific ecosystems.

## Production boundary

The included Docker Compose runtime is a local production-like acceptance stack. It is not a complete production platform. Real deployments must add TLS, ingress or load balancing, secret management, backups, observability, scaling, and rollout strategy for the selected target platform.
