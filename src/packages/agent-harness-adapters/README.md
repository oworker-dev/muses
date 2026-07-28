# Muses Agent Harness Adapters

This package contains replaceable Agent Harness adapters and the reproducible
A6 selection evidence. It does not own AgentRun state, project state, tools,
permissions, approvals, credits, sandboxes, or workflow definitions.

Current selection:

- `@muses/agent-core` is the primary runtime contract and headless loop.
- Pi Agent Core is an optional embedded loop adapter behind Muses ports.
- Eve remains a deferred durable candidate until Node.js, Workflow protocol,
  message ordering, and per-Run sandbox compatibility are proven in isolation.

Run `pnpm --filter @muses/agent-harness-adapters run check` from the repository
root to verify the matrix and policy boundary.
