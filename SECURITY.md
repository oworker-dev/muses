# Security Policy

## Reporting

Do not open public issues for vulnerabilities that could expose users, credentials, private projects, infrastructure, or provider accounts. Send a private report through GitHub's private vulnerability reporting feature when it is enabled for the repository. If that channel is unavailable, contact the repository owner through the private contact listed on the GitHub account.

Include the affected revision, impact, reproduction steps, and any suggested mitigation. Do not access data that is not yours, persist access, degrade service, or publish exploit details before a fix and disclosure plan are agreed.

## Supported State

Muses is currently a pre-release public source preview. Security fixes target the current `main` branch until a formal release support policy is recorded.

## Secrets and Private Data

- Never commit API keys, OAuth secrets, passwords, signing keys, production environment files, customer content, private prompts, or identifiable telemetry.
- Keep local credentials under ignored paths such as `.tmp/` with restrictive file permissions.
- Use placeholders in checked-in environment examples.
- Treat voice identities, unreleased media, customer presentations, and model inputs as private by default.

If a secret is committed or exposed, revoke and rotate it immediately; deleting it from the latest revision is not sufficient.
