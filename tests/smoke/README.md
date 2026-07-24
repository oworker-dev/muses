# Smoke Tests

Place minimal end-to-end startup and health checks here.

The default smoke script verifies API health, integration health, account summary, billing state, billing plans, idempotent billing webhook handling, and a real S3-compatible presigned upload PUT against the local storage runtime.

Browser E2E additionally verifies the Account Console avatar upload flow, which uses the same S3-compatible storage boundary from a user-facing screen.
