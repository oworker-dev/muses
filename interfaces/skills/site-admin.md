# Site Admin Skill

This consumer-agent skill describes the default neutral SaaS site-admin capability.

- Capability id: `saas.site_admin.review`
- Human surface: `src/apps/web/app/(admin)/admin`
- Health endpoint: `GET /api/health`
- Product boundary: site ownership, not end-user workspace or product-specific back office
- Analytics boundary: aggregate page, visitor, device, country, and neutral event visibility; no raw IP storage and no default per-user browsing trail
- Users boundary: account lifecycle, verification, auth-provider shape, subscription state, and recent activity summary
- Audit boundary: security-sensitive account, billing, and admin mutations
- Diagnostics boundary: provider and webhook troubleshooting, not a primary operating dashboard
- Verification: `pnpm run check`; after Docker starts, run `pnpm run smoke` and `pnpm run e2e`
