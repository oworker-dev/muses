# Site Admin Console

The Site Admin Console is the website-owner surface for a neutral SaaS starter. It should help an operator answer whether the site is healthy, whether accounts and billing are moving, whether users need attention, and whether sensitive actions or provider integrations require investigation.

It is not the default user dashboard, a product-specific back office, a CRM, a workspace manager, or a full behavioral analytics suite.

## Standard Questions

The default console should answer these questions:

- How much traffic did the site receive today and in the recent period?
- How many visitors were anonymous versus signed in?
- Which pages and neutral events are most active?
- How many users registered, verified email, subscribed, or need attention?
- Which accounts were recently active?
- What revenue and subscription state is visible from billing events?
- Are database, cache, queue, storage, email, billing, and worker boundaries healthy?
- Which security-sensitive account, billing, or admin actions happened recently?
- Which provider integration events failed and need debugging?

## Analytics Boundary

First-party analytics are aggregate site visibility, not user surveillance.

- Page views count page loads. Refreshing a page counts as another page view.
- Anonymous visitors are tracked through an anonymous cookie.
- Signed-in users may be associated through a hashed user id for aggregate metrics and account activity summaries.
- Raw email, raw user ids, and raw IP addresses are not stored in analytics events.
- Country or region should come from trusted edge or proxy headers such as `x-vercel-ip-country` or `cf-ipcountry`; local Docker normally reports `unknown`.
- Admin pages should read rollup and summary tables, not scan raw page-view events for every request.
- High-volume products should replace or extend this baseline with a dedicated analytics service when they need funnels, heatmaps, cohorts, or product-specific event warehouses.

## Users Boundary

The Users page is an account operations view. It should show account status, verification state, auth-provider shape, subscription state, registration time, recent activity, and the latest sensitive account action.

It should not expose a full browsing trail by default.

## Audit Boundary

Audit logs record security-sensitive mutations:

- account verification and email changes
- password changes and local password setup
- OAuth connection changes
- billing and subscription state changes
- admin-sensitive actions

They should not record ordinary page views.

## Diagnostics Boundary

Diagnostics are for provider and runtime debugging. They should sit behind the operational console and focus on recent webhook, email, storage, billing, and integration failures. They are useful for developers and operators, but they are not the primary business view.

## Muses Provider Boundary

The Muses Platform group extends Site Admin with `/admin/models` and
`/admin/providers`. Models owns published Offering, Profile, PriceBook, and
availability metadata. Providers owns capability-scoped connections, encrypted
credential rotation, explicit Offering bindings, and non-generating health
checks.

Provider secrets are write-only browser inputs. Admin lists expose only a
four-character hint and rotation time. Every connection mutation is audited
without plaintext or ciphertext, and creator-facing Studio routes never expose
connection metadata. A deployment must provide a stable
`MUSES_CREDENTIAL_MASTER_KEY`; database backups without that server secret do
not contain usable provider credentials.
