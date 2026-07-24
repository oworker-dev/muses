# Account Console Skill

This consumer-agent skill describes the default neutral SaaS account capability.

- Capability id: `saas.account.manage`
- Human surface: `src/apps/web/app/(account)/account/page.tsx`
- Health endpoint: `GET /api/health`
- Product surfaces: identity, avatar upload, email verification, account security, connected accounts, subscription state, and payment records
- Auth behavior: respect `callbackURL`; when no callback is provided, return to `/` rather than assuming a product dashboard
- Verification: `pnpm run check`; after Docker starts, run `pnpm run smoke`
