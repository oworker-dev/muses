# Providers

Replaceable provider adapters live here. Muses separates public Provider and
Model Offering metadata from server-only Provider Connections and credential
resolution.

Keep an adapter inside its owning capability while it has only one capability
domain consumer. Promote it here when the same provider boundary is consumed by
multiple capability domains, such as image, video, and Agent execution. This
directory is not a staging area for every vendor-specific implementation.

The current self-hosted Credential Vault adapter is implemented under
`src/apps/web/lib/provider-credential-vault.ts`. It uses AES-256-GCM with a
deployment-owned master key and can later be replaced by KMS/HSM-backed
envelope encryption without changing Workflow or Studio contracts. Runtime
adapters receive plaintext only for the duration of one server call; API keys,
ciphertext, and Base URLs never enter the public model catalog or creative DSL.

OpenAI-compatible LLM and image adapters resolve a connection by declared
capability and model scope. Image Offerings can be bound explicitly to separate
keys, which is required when one account or gateway exposes LLM models while a
different key exposes image models. Environment variables remain bootstrap
fallbacks for deployments that have not configured the database control plane.
