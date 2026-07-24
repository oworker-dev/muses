# ANSS v0.1 Draft

ANSS is the Agent Native Service Standard used by this starter to make a service discoverable, understandable, and callable by consumer Agents.

## One-Sentence Definition

ANSS service discovery starts at the service canonical root, then uses deterministic progressive disclosure to expose service identity, capability metadata, adapter install metadata, and callable service boundaries.

## Core Scope

ANSS core includes:

- canonical root discovery through HTTP `Link` headers and `/.well-known/anss.json`;
- an Agent Service Guide for human-auditable Agent instructions;
- a service map that declares real service capabilities;
- adapter install manifests for OpenAPI, ACLIP CLI, MCP, and Skills;
- capability safety metadata, including access class, writes, and confirmation hints;
- capability input, output, and error schemas;
- conformance checks that prove an Agent can discover, understand, and call the service.

## Optional Scope

The following are valid extensions, but are not required by ANSS core:

- published CLI binaries or package-manager distribution;
- client-specific packaged Skills;
- third-party registry mirrors;
- richer product-specific capability taxonomies;
- product-specific signed tokens, OAuth flows, scopes, or audit backends.

## Out Of Scope

ANSS does not implement:

- authentication;
- authorization;
- confirmation UI;
- audit-log storage;
- an Agent runtime;
- an IDE;
- a third-party registry;
- a separate Agent-only business service.

Adapters exposed through ANSS must call the same programmable service boundary as the product's normal API surface. ANSS can describe the security facts for a capability, but the product service remains responsible for enforcing them.

## Security Metadata Boundary

Each capability declares safety facts:

- `access`: product-defined access class such as `public-read`, `demo-read`, or `authenticated-write`;
- `writes`: whether the capability can mutate product state or external systems;
- `requiresUserConfirmation`: whether a consumer Agent should ask the user before calling.

These fields are advisory metadata for Agents and conformance. They are not authorization. A service must not infer permission from User-Agent or from the existence of an ANSS adapter.

## Capability Schema Boundary

Each capability declares:

- `inputSchema`: JSON Schema for callable input;
- `outputSchema`: JSON Schema for successful output;
- `errorSchema`: JSON Schema for product error responses.

OpenAPI, MCP tool schemas, ACLIP documentation, the public service map, and conformance checks are generated or verified from the same capability contract.

## Conformance

A conforming ANSS starter must pass these checks:

- root discovery exposes `agent-service-guide`, `service-manifest`, `service-map`, `adapter-install`, `mcp`, and `llms` links;
- `/.well-known/anss.json` resolves all canonical discovery and adapter install URLs;
- `/anss/saas.service-map.yaml` contains every declared capability, schema, adapter, and safety fact;
- `/anss/install/index.json` and per-adapter install manifests require no third-party registry;
- OpenAPI exposes every capability with ANSS operation metadata and JSON schemas;
- ACLIP CLI returns structured ACLIP envelopes for capability calls;
- remote MCP lists service-map-backed tools and returns structured content for a read-only tool call;
- `pnpm run anss:check`, `pnpm run anss:conformance`, and `pnpm run anss:agent-probe` pass against a running service.

## Return To Starter Mainline Gate

ANSS v0.1 is considered mature enough for the starter when:

- the canonical root discovery path is stable;
- service-map, OpenAPI, ACLIP, MCP, Skills, and install manifests share one capability source;
- a generated starter package passes static checks, production build, conformance, Agent probe, CLI call, and remote MCP call;
- this document clearly marks core, optional, and out-of-scope boundaries.

After this gate, ANSS work should be limited to bug fixes, compatibility maintenance, and specification clarifications. New product capabilities should return to the SaaS Starter mainline unless they directly fix ANSS conformance.
