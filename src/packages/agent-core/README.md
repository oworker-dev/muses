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

Long sessions automatically compact before model calls after a message-count
or character-count high watermark. The default compactor retains a lower
message/character target so one new turn does not immediately compact again.
It creates a versioned structured summary, keeps system/recent/pending-call
messages, bounds rolling conversational history, and preserves current plan,
permission, budget, artifact, pending-action and omitted tool-result facts.
A replaceable synchronous or asynchronous compactor must pass Agent Core
validation before the new ContextSnapshot can commit. Agent Core injects both
its persisted prose and structured facts into later model input; neither is
reconstructed from process memory.

Run the independent Harness verification with:

```bash
pnpm --filter @muses/agent-core run check
```
