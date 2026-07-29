# A8 Callable Workflow Evidence

Date: 2026-07-29

Environment: local PostgreSQL and Workflow SDK Postgres World with Studio at
`http://127.0.0.1:4730/studio`

## Outcome

A8 passed. Professional Studio no longer sends a mutable browser graph to the
runtime. It waits for pending Operation Gateway writes, publishes the
server-owned draft into an immutable `WorkflowDefinition` version, and invokes
the active `production` Deployment. Repeated publication of unchanged
executable content reuses the version; changed definitions receive the next
integer version.

The authenticated HTTP boundary rejects mutable graphs, missing versions,
disabled Deployments, and cross-Workspace targets before execution or credit
reservation. UI, Agent, and HTTP callers share the same catalog resolver,
invocation service, authorization, idempotency, billing, Workflow SDK, and run
audit path.

A real MusesAgent used exactly `workflow.list`, `workflow.inspect`, and
`workflow.invoke` to discover and call the server-owned durable Harness
Deployment. The Agent completed without calling `image.generate`. Its one
child WorkflowRun recorded the exact definition id/version, Deployment id,
`caller_kind=agent`, and the matching AgentRun id. Cleanup cancelled the
waiting run; both Workflow SDK Postgres World and `muses_workflow_run` persisted
`cancelled`. No generated Asset, credit reservation, or ledger entry was
created by this probe.

## Verification

```bash
pnpm run check:platform-core
pnpm run typecheck
pnpm --filter ./src/apps/web exec workflow validate
pnpm run build
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts \
  --grep 'the default professional workflow|Muses waits and resumes|Workflow Catalog rejects'
OWORKER_WEB_URL=http://127.0.0.1:4730 pnpm exec playwright test \
  tests/e2e/muses-studio.spec.ts \
  --grep 'MusesAgent discovers, inspects, and invokes one exact published workflow'
```

- Domain: 39/39 tests passed.
- Agent Core: 11/11 tests passed.
- Agent Harness adapters: 3/3 tests passed.
- Web unit: 5/5 tests passed.
- Repository type checks, Workflow validation, A8 backend targeted lint, and
  production build passed.
- Catalog/default publication/durable Harness browser gates: 3/3 passed.
- Real Agent discovery and exact invocation gate: 1/1 passed twice after the
  cancellation persistence fix; the final evidence run took about 8 seconds.
- Full Web lint remains outside this Gate and still reports the known large
  Studio React Hooks baseline; A8 does not claim that baseline is cleared.

## Boundaries

A8 proves one callable-workflow vertical slice, not a generic AI application
platform. Creative mode remains Agent-first; professional workflows are
optional reusable automation. External service-account authentication,
Workspace deletion policy for immutable versions, child-run cancellation,
approval UX, full tracing, isolation, compaction, restart recovery, and fixed
evals remain explicit A9 or later work.

## Artifacts

- `results.json`: structured identities, verification facts, and remaining
  boundaries without credentials, prompts, user identity, or provider payloads.
