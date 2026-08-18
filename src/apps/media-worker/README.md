# Media Worker App

Status: composition-root placeholder; not runnable.

This app is reserved for model calls, deterministic media processing, stage
checkpoints, and output publication for host-neutral media conversions.

Queue payloads will contain conversion identifiers and versioned small data,
not image bytes. Provider credentials remain server-side. No worker code should
be added before architecture decision `ai-3` is approved.
