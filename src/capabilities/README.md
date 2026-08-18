# Capabilities

Product-facing capability domains live here. A capability is a versioned,
callable unit that can be reused by UI, Agent, Workflow, and HTTP API entry
points without importing a provider SDK or a host-specific document model.

Capability code should stay vertically cohesive until real cross-domain reuse
justifies promotion. Queue, storage, configuration, and observability belong in
`src/packages/`; replaceable adapters shared by multiple capability domains
belong in `src/providers/`.

Current proposals:

- `ai-image/`: host-neutral AI image processing, beginning with
  `image-to-editable`.
