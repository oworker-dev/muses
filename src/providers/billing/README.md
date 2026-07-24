# Stripe-Compatible Billing Provider

The default billing provider is Stripe-compatible.

Without `STRIPE_SECRET_KEY` and `STRIPE_PRICE_PRO`, checkout and portal routes fail closed with a not-configured state. With Stripe credentials, the same routes call Stripe Checkout and Billing Portal. `/api/billing/webhook` verifies signatures when `STRIPE_WEBHOOK_SECRET` is present, records provider events idempotently, persists the account subscription state, and records successful provider payments for account and site-admin visibility.

Keep subscription state explicit through the billing package and API contract. Product-specific entitlements should be derived by the created project instead of being hidden in provider adapter logic.
