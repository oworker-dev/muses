# i18n Provider

The default web app uses `next-intl` as a minimal internationalization baseline without enabling locale routing by default.

The starter keeps i18n intentionally small:

- `src/apps/web/i18n/config.ts` defines supported locales and the default locale.
- `src/apps/web/i18n/messages.ts` exposes the default message catalogs.
- `src/apps/web/i18n/server.ts` resolves the current request locale from a cookie with a configured fallback.
- `src/apps/web/app/api/locale/route.ts` stores the selected locale.
- `src/apps/web/messages/*.json` stores message catalogs.
- `src/apps/web/components/i18n-provider.tsx` wraps the app with `NextIntlClientProvider`.
- `src/apps/web/components/language-switcher.tsx` provides the small default selector used by the public and auth pages.

Locale routing, translated slugs, and production translation workflows should be added by the created project when the product requires them.
