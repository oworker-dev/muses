# Provider Connection And Credential Vault Evidence

This slice accepts the operational fact that one API key may expose only LLM
models while another key from the same Provider exposes image, video, audio,
or music models.

## Delivered

- `0017_provider_connection_credential_vault.sql` persists capability-scoped
  connections, versioned credentials, Offering bindings, and per-capability
  health facts.
- Credential versions use AES-256-GCM with connection/credential/key identity
  as authenticated additional data. The database stores ciphertext, nonce,
  authentication tag, key id, and a four-character hint, never plaintext.
- `/admin/providers` reuses Site Admin authorization and supports creation,
  disable/enable, Offering binding, atomic credential rotation, and a
  non-generating model-metadata health check.
- Admin projections omit ciphertext and plaintext. Audit events include only
  stable ids, capability/binding facts, key id, and the four-character hint.
- New image submissions freeze `providerConnectionId` before starting the
  Workflow SDK run. A Step opens that exact route and fails closed when it is
  unavailable; no post-request automatic failover can duplicate media charges.
- Agent LLM calls use the same capability-aware resolver. Environment variables
  remain bootstrap fallback only when no database connection was selected.

## Verification

Run against local PostgreSQL after migrations:

```bash
DATABASE_URL=postgresql://oworker:oworker@127.0.0.1:5432/oworker_saas \
  pnpm --filter ./src/apps/web run verify:provider-connections
```

The verifier uses known fake credentials, proves that raw storage does not
contain plaintext, resolves an explicitly bound image Offering, opens the
frozen connection, rotates to exactly one active credential, confirms the
Admin projection contains only the last-four hint, and deletes its exact test
records afterward.

Also required:

```bash
pnpm --filter ./src/apps/web run test:unit
pnpm --filter ./src/apps/web run typecheck
pnpm run doctor:production
pnpm exec workflow validate
```

## Remaining Production Boundary

The current self-hosted adapter requires one stable deployment master key. KMS
or HSM envelope encryption, online master-key re-encryption, Workspace BYOK,
regional/data-policy routing, and idempotency-safe cross-provider failover are
later gates. This evidence does not claim those capabilities or claim that the
open A11 real two-image continuation Gate has passed.
