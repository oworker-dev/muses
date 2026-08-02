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
- `postgres:17-alpine` for the physically separate Muses Workflow World.
- `valkey/valkey:8-alpine` for cache and BullMQ queue backing.
- `minio/minio` for S3-compatible local object storage.
- `src/apps/api` for the canonical Hono HTTP API.
- `src/apps/worker` for BullMQ background execution.
- `src/apps/web` for the Next.js web app, auth UI, account console, and admin console.

The Web container also hosts the Muses durable Workflow SDK boundary. It uses
`@workflow/world-postgres` against the dedicated `workflow-db` service and keeps
the `muses_` job prefix as a second isolation boundary. `instrumentation.ts`
starts the long-lived World worker, and `docker:start` runs the idempotent
Workflow schema bootstrap before starting Next.js. Never point
`WORKFLOW_POSTGRES_URL` at the business `DATABASE_URL`: Workflow generations
may use incompatible event and queue specifications even when table names do
not collide.

Required self-hosted settings:

```bash
WORKFLOW_TARGET_WORLD=@workflow/world-postgres
WORKFLOW_POSTGRES_URL=postgresql://oworker:oworker@workflow-db:5432/muses_workflow_world
WORKFLOW_POSTGRES_JOB_PREFIX=muses_
```

Postgres World requires a long-running process and must not be used in a
serverless deployment. Vercel deployments use Vercel World instead.

Before promoting a self-hosted deployment, run
`pnpm run doctor:workflow-world:strict`. The doctor rejects persisted Workflow
specs or Graphile task owners from another runtime generation. Follow
[`../workflow-world-recovery.md`](../workflow-world-recovery.md) to recover by
moving new work to an isolated World; never delete Workflow or queue rows
blindly.

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
- Workflow PostgreSQL: `5433`
- Valkey: `6379`
- MinIO API: `9000`
- MinIO Console: `9001`
