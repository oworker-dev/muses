# Contributing to Muses

Muses is being built in public, but it is still in the Value Foundation stage. Contributions should start from a verified user problem, not from a desire to add technology or features.

## Before Contributing

1. Read `AGENTS.md` and run `apcc guide workflow`.
2. Read `docs/shared/价值宪法.md`, `docs/shared/开放原则.md`, and `docs/internal/长期架构.md`.
3. Check the current phase and tasks with `apcc status`.
4. Open an issue before high-impact product, scope, architecture, policy, or compatibility work.
5. Never include customer material, user projects, credentials, private telemetry, or unlicensed media.

## Development

```bash
pnpm install
pnpm run docker:infra
pnpm run dev
```

Run the focused checks for your change, then the repository gate:

```bash
pnpm run check
apcc doctor check
```

When Docker is running on the configured ports, use the smoke and browser gates described in `README.md`.

## Change Expectations

- Keep scenarios above kernel contracts; do not add one-off AI short-drama, PPT, ecommerce, or social concepts to shared kernels.
- Keep provider SDK types out of product contracts.
- Associate significant work with a user task, a value hypothesis, and a measurable success or stopping condition.
- Update public interfaces, migrations, tests, operations, APCC state, and authored docs when their behavior changes.
- Preserve user ownership, structured export, self-hosting boundaries, provenance, tenant isolation, and safe Agent control.

## Current License Status

The source is visible for review, but Muses has not selected or published its final open-source license yet. Until a `LICENSE` file is added, do not assume permission to redistribute or create derivative works. Discussion, issues, and narrowly scoped pull requests are welcome while the policy decision is completed.
