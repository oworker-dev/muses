# Docker Runtime

Run the full local stack with:

```bash
pnpm run docker:up
```

Docker helpers load `.env.development` by default. When the ignored local file
`.tmp/external.runtime.env` exists, it is loaded afterward as an external-provider
override. Passing an explicit `--env-file` disables these defaults, so pass every
required env file explicitly in that mode.

`docker:up` does not force a rebuild. Use `pnpm run docker:rebuild` when source or dependency changes should be validated in freshly built images.

For daily application development, start only the backing services and run the web app outside Docker:

```bash
pnpm run docker:infra
pnpm run dev
```

The stack uses:

- `pgvector/pgvector:pg17` for PostgreSQL with pgvector.
- `valkey/valkey:8-alpine` for cache and BullMQ queue backing.
- `minio/minio` for S3-compatible local object storage.
- `src/apps/api` for the canonical Hono HTTP API.
- `src/apps/worker` for BullMQ background execution.
- `src/apps/web` for the Next.js web app, auth UI, account console, and admin console.

Run `pnpm run smoke` after the stack is healthy to verify the API and default integrations from the host.

Maintenance commands:

```bash
pnpm run docker:build
pnpm run docker:rebuild
pnpm run docker:down
pnpm run docker:reset
```

This Compose file is intended for local production-like acceptance. It is not a full production deployment recipe and intentionally leaves TLS, ingress or load balancing, secret management, backups, scaling, and platform rollout strategy to the project owner.

Default ports:

- Web: `3000`
- API: `3001`
- PostgreSQL: `5432`
- Valkey: `6379`
- MinIO API: `9000`
- MinIO Console: `9001`
