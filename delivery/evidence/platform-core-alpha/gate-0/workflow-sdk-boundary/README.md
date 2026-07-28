# Workflow SDK Supported-Node Interpreter Evidence

Collected on 2026-07-27 against:

- `workflow@4.6.2`
- `@workflow/world-postgres@4.3.1`
- Next.js `16.2.6`
- PostgreSQL 17 through the project Docker stack

## Proven

1. `withWorkflow()` compiles one workflow and six step entries and exposes the
   internal `/.well-known/workflow/v1/*` routes.
2. Muses validates the framework-independent `WorkflowDocument` and compiles a
   separate `WorkflowDefinition 0.1.0-draft` before calling SDK `start()`.
3. The compiler strips editor and run-result state, requires explicit
   publication identity, and returns no partial definition on diagnostics.
4. A valid definition returns a real `wrun_...` identifier.
5. The framework-independent interpreter resolves Start defaults, typed data
   bindings, deterministic order, missing/type-invalid outputs, unsupported
   nodes, Selector suspension, candidate validation, and typed End outputs.
6. One generic `"use workflow"` loop executes Start, server Harness image
   generation, Selector, server Harness DesignDocument creation, and End.
7. Selector registers a non-webhook Hook with a server-only token and metadata,
   emits `node.waiting`, rejects an untrusted asset, and resumes only with an
   allowed candidate.
8. The API returns known `muses:runtime` chunks without blocking on the open
   waiting stream and never returns the raw Hook token.
9. The run is queryable through the Web route, persists in Postgres World, and
   transitions from `running` with one active Hook to `completed` with zero
   active Hooks and 13 runtime stream chunks.
10. Browser tests distinguish server interpreter candidate references from the
    separate local browser image fixture.
11. Studio persists the last durable `{workspaceId, runId}` separately from the
    editable workspace. A browser reload restores a waiting run projection
    instead of losing the Selector panel.
12. Restarting only `saas-web-1` while Selector is waiting changes the
    container `StartedAt`; Postgres World logs `Re-enqueued 1 active run(s) on
    startup`, preserves the Hook and seven pre-resume runtime chunks, and lets
    the same browser reload and finish the run.
13. Workflow SDK 4.6.2 appends one `hook_received` for every `resumeHook()`
    call; it does not expose a resume idempotency key. Muses therefore persists
    a PostgreSQL resume receipt keyed by workspace, run, suspension, and caller
    idempotency key before calling the SDK.
14. Exact retries return `202` with `idempotentReplay=true` even after Hook
    disposal or Web restart, while a different mutation against the claimed
    suspension returns `404` and a reused key with different values returns
    `409`. The accepted run records one `hook_received` and one downstream
    execution.
15. Studio exposes cancellation only while a durable run is pending, running,
    or waiting. Cancel and resume share a run-scoped PostgreSQL advisory lock,
    so the two mutations cannot race through the adapter concurrently.
16. Cancelling a waiting Selector persists one cancellation receipt and one SDK
    `run_cancelled`, removes the active Hook, retains the seven pre-cancel
    runtime chunks, suppresses stale candidates in the terminal projection, and
    restores the cancelled panel after browser reload.
17. Exact cancellation retries return `202`; the same key with a different
    reason and new cancellation mutations return `409`; resuming the disposed
    Selector returns `404`.
18. The supported-node Step sets `maxRetries=2`. A controlled `FatalError`
    records one failed attempt and no `step_retrying`; a controlled transient
    `RetryableError` records exactly two `step_retrying` events and succeeds on
    attempt three with the same stable Step identity. A continuously failing
    transient Step also stops at attempt three and never starts attempt four.
19. Selector races its private Hook with durable `sleep()`. When the test
    deadline wins, Muses projects terminal `human-input-timeout`, removes the
    stale suspension, Workflow SDK records one `hook_disposed`, and Postgres
    World retains no active Hook.
20. Manual retry accepts only a terminal retryable failure, hydrates the old
    run's frozen Workflow SDK arguments through the documented World API,
    starts a distinct run with `retryOfRunId`, and never modifies the source
    failure.
21. A PostgreSQL retry receipt makes an exact retry request return the same
    target run. Studio exposes the failure code, current/max attempt, and a
    localized “Retry as new run” action only when the failure is retryable.

## Commands

```bash
pnpm --filter @muses/domain run check
pnpm --filter ./src/apps/web run typecheck
pnpm --filter ./src/apps/web run build
pnpm --filter ./src/apps/web exec workflow validate
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test tests/e2e/muses-studio.spec.ts
apcc doctor check
apcc site build
```

## Result

- Domain: 25/25 tests passed.
- Studio: 6/6 tests passed.
- Workflow SDK compiler: no serde issues.
- Production E2E run `wrun_01KYJ575GGDQ6V298ZF57ZNX86` completed through port
  `4730` with one resume receipt and one `hook_received` despite exact retries.
- Explicit waiting/resume evidence run
  `wrun_01KYJ1Y59Y4TFPFXD3XR39ZYRZ` persisted an active non-webhook Selector
  Hook while `status=waiting`, then completed with the stable order
  `start-1 → image-generator-1 → selector-1 → design-1 → end-1`, typed output
  `design-1-document@0`, zero active Hooks, and 13 runtime event chunks.
- Restart evidence run `wrun_01KYJ563TCQWKSA4MM7JN8T1XW` was waiting when the
  Web/Workflow container restarted. The browser retained the durable run
  pointer, restored the waiting projection after reload, resumed once, and
  completed with 15 steps at attempt 1, 13 runtime chunks, one
  `hook_received`, one persisted receipt, and `design-1-document@0`.
- Pre-fix observation run `wrun_01KYJ44RVBA3NE7ERX4MG3WKTD` proved why a Muses
  receipt is necessary: two racing `resumeHook()` calls produced two
  `hook_received` events even though downstream Workflow effects executed once.
- Cancellation evidence run `wrun_01KYJ5Z426X9BCS4KST91EFWAY` stopped while
  Selector was waiting. It persisted one cancel receipt and one
  `run_cancelled`, retained seven runtime chunks and eight attempt-1 steps,
  removed the active Hook, wrote no `hook_received`, rejected later resume, and
  restored the cancelled UI after reload.
- Permanent-failure evidence run `wrun_01KYJAAGFSV4Z5CX4CKH208C7C` failed its
  executable Step at attempt 1 with one `step_failed`, no `step_retrying`, and
  a non-retryable Muses failure projection.
- Transient-recovery evidence run `wrun_01KYJAAGWAGBPY8AF3GVEMVJ9A` recorded
  two `step_retrying` events and completed the executable Step at attempt 3;
  the test then cancelled the waiting Selector as cleanup.
- Transient-exhaustion evidence run `wrun_01KYJASFQJ1PZ3ZYB80PK6PD21` recorded
  two `step_retrying` events, failed the executable Step at attempt 3, projected
  `transient-exhausted`, and wrote no fourth attempt.
- Timeout evidence run `wrun_01KYJAAKQG9VJNB976XTGD7RE6` ended with
  `human-input-timeout`, one `hook_disposed`, zero active Hooks, no stale
  suspension, and ten runtime chunks.
- Manual-retry evidence run `wrun_01KYJAAQ44YXBN9J1JET89C72J` was created from
  the frozen arguments of `wrun_01KYJAAKQG9VJNB976XTGD7RE6`. The persisted
  receipt links source and target; exact replay returned the same target while
  the source remained failed and independently queryable.

## Not Proven

- Arbitrary/plugin-defined `WorkflowDefinition` interpretation.
- Durable execution of image provider jobs.
- Crash recovery inside the narrow interval after SDK `start()` accepts a new
  retry run but before the Muses receipt transaction commits.
- General Capability/Job retry policy, provider idempotency, compensation, and
  retry after user-edited inputs or definitions.
- Multi-tenant persistence and authorization of published definitions/runs.
