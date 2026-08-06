# Open Agent SDK 108 integration evidence

Date: 2026-08-06

## Frozen dependency

Muses consumes `@oworker/open-agent-client`, `@oworker/open-agent-contracts`,
and `@oworker/open-agent-host` from the same immutable Open Agent commit:

```text
442420dae167d8ee72b55133d2ba961433fb0633
```

The Open Agent repository was clean at that pushed commit. Muses installed all
three packages from the audited package paths without rebuilding their SDK
artifacts.

## Agent to Muses

The production-topology bridge test started a real headless AgentRun and gave
it only the versioned Muses Host capabilities. The Agent inspected the canvas,
invoked and durably waited for a workflow, then placed the result on the
authoritative canvas.

```text
AgentRun: arun_ab9782bf-94bc-458c-b79f-2d9b0fa187d9
WorkflowRun: wrun_01KZBC6ANEYV1CN8HNYKSH4PP9
Result: BRIDGE_READY
Final canvas revision: 15
Tools: canvas.inspect, workflow.invoke, workflow.run.wait, canvas.item.put
Idempotent replay: passed
```

## Muses workflow to Agent

The professional workflow interpreter executed `Start -> agent.run -> End`
through the public Open Agent client. Usage was projected into the Muses run
record. Cancellation propagated in both directions and a repeated cancellation
remained idempotent.

```text
WorkflowRun: wrun_01KZBCJD6K3AY18XJ16HAS02JF
AgentRun: arun_f333cb75-0299-488d-84fc-e72fe10e8c07
Result: BRIDGE_READY
Usage projection: passed
Cancellation: workflow=cancelled, agentRun=cancelled
Repeated cancellation: passed
```

## Verification commands

```bash
pnpm install --frozen-lockfile --offline
pnpm run verify:agent-sdk-distribution
pnpm --filter ./src/apps/web run test:unit
pnpm --filter @muses/domain run check
pnpm run typecheck
pnpm run build
pnpm run test:workflow-world-doctor
pnpm run verify:agent-first-image
pnpm run verify:workflow-agent-bridge
MUSES_AGENT_PUBLIC_URL="<browser-reachable Open Agent origin>" \
  OWORKER_WEB_URL=http://127.0.0.1:4730 \
  pnpm exec playwright test tests/e2e/muses-studio.spec.ts \
  --grep "Studio uses one full-height right rail"
apcc doctor check
git diff --check
```

The browser check confirms that the Muses right rail embeds `/embed` without a
credential in its URL and renders the composer, model selector, reasoning
selector, context meter, and task navigation from the pinned Open Agent build.
