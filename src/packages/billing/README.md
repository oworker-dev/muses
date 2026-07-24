# Billing Package

Billing is a standard SaaS capability boundary. The default implementation is Stripe-compatible and supports two states:

- not-configured checkout and portal responses when Stripe credentials are absent;
- real Stripe Checkout, Portal, persisted customer / subscription state, and webhook verification when test or live credentials are configured.

Keep pricing, entitlement, and webhook behavior explicit in this package instead of hiding it in CLI creation logic.

The billing state contract should expose provider mode, account identity, subscription status, payment records, and provider identifiers without assuming a product-specific entitlement model. Webhook events should be stored idempotently so retries are safe.
