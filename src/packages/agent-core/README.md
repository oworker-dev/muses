# Muses Agent Core

`@muses/agent-core` owns the framework-neutral Agent runtime contract and a
headless reference state machine. It has no dependency on React, Next.js,
Vercel Workflow, Eve, Pi, a model provider, or a storage provider.

The package defines stable Session, Run, Turn, Plan, Event, ToolCall,
Approval, ContextSnapshot, Checkpoint, and Budget semantics. Model, tool,
policy, clock, identity, and state storage behavior enter through ports.

The headless runtime intentionally executes tool calls serially in the first
slice. Every tool receives a stable `runId:toolCallId` idempotency key. Tools
that mutate Muses must call the Operation Gateway; a tool implementation may
not write canvas state directly.

Run the independent Harness verification with:

```bash
pnpm --filter @muses/agent-core run check
```
