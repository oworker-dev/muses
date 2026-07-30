# A11 Continuation And Cancellation Evidence

Evidence date: 2026-07-30

## Passing gates

- `@muses/agent-core` typecheck and tests: 5 files, 75 tests passed.
- Web unit tests: 12 files, 59 tests passed.
- A11 focused Web tests: 5 files, 22 tests passed.
- Agent Harness adapter check: 1 file, 3 tests passed.
- Web typecheck passed.
- Workflow SDK validation scanned 225 files and reported no serde issues.
- PostgreSQL delegation verification passed continuation commit/recovery/replay,
  exact-scope cancellation, Scheduler cancellation, budget finalization and SDK
  driver cancellation state.
- The authenticated browser cancellation case passed in 34.5 seconds. It
  cancelled pending specialist work after the parent AgentRun completed and did
  not invoke a parent continuation turn.

## Real-result gate status

The authenticated two-Specialist browser case was attempted twice in this
round. In both attempts:

- the root Agent, two Child Agents and the bounded parent continuation all
  completed their model turns;
- the parent advanced exactly one continuation turn; and
- both image tools failed before producing an Asset, so the Scheduler correctly
  recorded `completed-with-failures` and the browser assertion did not pass.

A non-billing capability probe showed that the currently configured shared
OpenAI-compatible endpoint exposes no image-like models and returns the
sanitized classification `503 / new_api_error / model_not_found` for
`gpt-image-2`, `gpt-image-1.5` and `gpt-image-1`. The current credential is not
an OpenAI first-party credential. No provider response body, message, endpoint,
credential, user content or private identity is retained in this evidence.

The runtime now supports `OPENAI_IMAGE_API_KEY` and
`OPENAI_IMAGE_BASE_URL` as an independent image route while retaining the
shared-provider fallback. An explicit image endpoint cannot inherit the shared
key. Whitelisted `model_not_found` responses are now treated as definitive
request rejection even when a compatible gateway reports HTTP 503, allowing
the reservation to release instead of entering unnecessary billing review.

## Remaining acceptance item

A provider credential and endpoint that actually expose one enabled catalog
image model are still required. After configuration, rerun the authenticated
two-Specialist case and require two real Asset refs, one trusted continuation
message, parent turn `+1`, one completed continuation receipt, a completed SDK
driver and no duplicate charge after refresh.

No Playwright trace is committed because traces contain private test input and
identity data.
