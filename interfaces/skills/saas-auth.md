# SaaS Auth Skill

This starter exposes an email/password authentication flow backed by Better Auth and PostgreSQL. New email/password accounts must verify their email address before sensitive SaaS routes such as billing and site admin unlock. Password reset, change password, verified email change, and auth mutation rate limiting are included by default. GitHub and Google OAuth are available when their environment variables are configured.

Human and agent consumers should use the web forms for registration and login unless the project defines explicit service-to-service auth contracts.

Runtime surfaces:

- Web auth routes live under `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/api/email-verification/send`, and `/api/auth/*`.
- Billing routes live under `/api/billing/checkout`, `/api/billing/portal`, and `/api/billing/webhook`.
- Account routes live under `/account`, `/account/billing`, and `/api/account/*`.
- Site admin routes live under `/admin/*`; set `SITE_ADMIN_EMAILS`, or the first verified user bootstraps local admin access.
- First-party analytics events live under `/api/analytics/event`.
- Canonical API health lives under `src/apps/api` and `/health`.
- Neutral SaaS APIs live under `/account/summary`, `/integrations/health`, `/billing/plans`, `/billing/state`, and `/storage/presigned-upload`.
- Agent tool contracts live under `interfaces/mcp/saas.md`.
