# A11 Continuation And Cancellation Evidence

Evidence date: 2026-07-30

## Passing gates

- `@muses/agent-core` typecheck and tests: 5 files, 75 tests passed.
- Web unit tests: 14 files, 65 tests passed.
- A11 focused Web tests: 5 files, 22 tests passed.
- Agent Harness adapter check: 1 file, 3 tests passed.
- Web typecheck passed.
- Workflow SDK validation scanned 231 files and reported no serde issues.
- PostgreSQL delegation verification passed continuation commit/recovery/replay,
  exact-scope cancellation, Scheduler cancellation, budget finalization and SDK
  driver cancellation state.
- The authenticated browser cancellation case passed in 34.5 seconds. It
  cancelled pending specialist work after the parent AgentRun completed and did
  not invoke a parent continuation turn.

## Real-result gate status

The authenticated two-Specialist browser Gate passed in 1.7 minutes after an
independent image-capable Provider route was configured. The run proved:

- two independent Child AgentRuns executed with concurrency two and both tasks
  reached `completed`;
- two distinct authorized `image_` Asset refs were produced and placed through
  the Operation Gateway;
- the direct parent received exactly one trusted delegation-result message,
  advanced exactly one bounded turn, and its final answer contained both exact
  Asset ids;
- one continuation receipt reached `completed` with its message-commit
  milestone, while the trace joined one DelegationRun, three AgentRuns and both
  Assets;
- two image reservations were recorded; and
- browser refresh did not change the continuation receipt, model-call count,
  result message count or billing facts.

The earlier failed attempts established that the shared LLM-only endpoint did
not expose enabled image models. The passing attempt confirms the product
requirement that LLM and image capabilities can use different keys and
endpoints. The runtime supports the independent environment bootstrap route,
and the Provider Connection/Credential Vault control plane now provides the
long-term capability-scoped database route. An explicit image endpoint cannot
inherit a shared LLM key.

No provider response body, endpoint, credential, prompt, user identity or
Playwright trace is committed in this evidence.

No Playwright trace is committed because traces contain private test input and
identity data.
