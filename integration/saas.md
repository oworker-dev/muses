# SaaS Integration Notes

SaaS Starter uses:

- Next.js App Router for the web surface
- Hono for the canonical HTTP API, including health, integration status, account summary, and billing plans
- MCP and worker app skeletons for Agent and background execution surfaces
- Better Auth for email/password authentication
- PostgreSQL with pgvector for auth persistence and future Agent-era semantic data needs
- Drizzle-compatible business schema boundaries under `src/packages/db`
- Valkey for cache and BullMQ queue backing
- MinIO for local S3-compatible object storage
- next-intl for minimal application internationalization
- Resend-compatible transactional email with a local-test fallback and Stripe-compatible billing that fails closed until provider credentials are configured
- Structured JSON logs boundary
- Docker Compose for local production-like runtime and acceptance, with production deployment left to the chosen platform

Do not add provider-specific services without recording them under `src/providers/`, `interfaces/*`, and `tests/contracts/`.
