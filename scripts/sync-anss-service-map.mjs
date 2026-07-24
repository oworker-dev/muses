import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const contractPath = join(root, "src/apps/api/src/capabilities.mjs");
const serverPath = join(root, "src/apps/api/src/server.mjs");
const serviceMapJsonPath = join(root, "interfaces/service-map/saas.service-map.json");
const serviceMapYamlTargets = [
  join(root, "interfaces/service-map/saas.service-map.yaml"),
  join(root, "src/apps/web/public/anss/saas.service-map.yaml")
];
const openapiTargets = [
  join(root, "interfaces/openapi/saas.openapi.yaml"),
  join(root, "src/apps/web/public/anss/openapi/saas.openapi.yaml")
];
const aclipPath = join(root, "interfaces/aclip/saas.md");
const mcpPath = join(root, "interfaces/mcp/saas.md");
const skillPath = join(root, "interfaces/skills/anss-service.md");
const agentGuidePath = join(root, "src/apps/web/public/agent-guide.md");
const llmsPath = join(root, "src/apps/web/public/llms.txt");
const installTargets = {
  index: join(root, "src/apps/web/public/anss/install/index.json"),
  cli: join(root, "src/apps/web/public/anss/install/cli.json"),
  mcp: join(root, "src/apps/web/public/anss/install/mcp.json"),
  skills: join(root, "src/apps/web/public/anss/install/skills.json"),
  openapi: join(root, "src/apps/web/public/anss/install/openapi.json")
};
const shouldWrite = process.argv.includes("--write");
const shouldCheck = process.argv.includes("--check") || !shouldWrite;

const { serviceMap } = await import(pathToFileURL(contractPath).href);
validateServiceMap(serviceMap);

const installManifests = buildInstallManifests(serviceMap);
const generated = [
  [serviceMapJsonPath, `${JSON.stringify(serviceMap, null, 2)}\n`],
  ...serviceMapYamlTargets.map((target) => [target, `${toYaml(serviceMap)}\n`]),
  ...openapiTargets.map((target) => [target, generateOpenApi(serviceMap)]),
  [aclipPath, generateAclip(serviceMap)],
  [mcpPath, generateMcp(serviceMap)],
  [skillPath, generateSkill(serviceMap, installManifests)],
  [agentGuidePath, generateAgentGuide(serviceMap, installManifests)],
  [llmsPath, generateLlms(serviceMap, installManifests)],
  [installTargets.index, json(installManifests.index)],
  [installTargets.cli, json(installManifests.cli)],
  [installTargets.mcp, json(installManifests.mcp)],
  [installTargets.skills, json(installManifests.skills)],
  [installTargets.openapi, json(installManifests.openapi)]
];
const errors = [];

if (shouldWrite) {
  for (const [target, content] of generated) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log("ANSS contract artifacts synced from src/apps/api/src/capabilities.mjs.");
}

if (shouldCheck) {
  for (const [target, expected] of generated) {
    if (!existsSync(target)) {
      errors.push(`Missing generated ANSS artifact: ${relative(target)}`);
      continue;
    }
    const actual = readFileSync(target, "utf8");
    if (actual !== expected) {
      errors.push(`Generated ANSS artifact is out of sync: ${relative(target)}`);
    }
  }
  checkRuntimeRouteReferences(serviceMap, errors);
  checkAdapterReferences(serviceMap, errors);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (shouldCheck) {
  console.log("ANSS contract check passed.");
}

function validateServiceMap(map) {
  if (map.schema !== "anss.service-map/0.1") {
    throw new Error("Service map schema must be anss.service-map/0.1.");
  }
  if (map.generatedFrom !== "src/apps/api/src/capabilities.mjs") {
    throw new Error("Service map must declare src/apps/api/src/capabilities.mjs as its generator source.");
  }
  if (!map.service?.id || !map.service?.canonicalServiceRoot) {
    throw new Error("Service map must include service.id and service.canonicalServiceRoot.");
  }
  if (map.service?.programmableServiceBoundary?.type !== "hono") {
    throw new Error("SaaS Starter service map must use the Hono programmable service boundary.");
  }
  if (map.securityBoundary?.scope !== "metadata-only" || !map.securityBoundary.adapterCallsUseSameServiceBoundary) {
    throw new Error("Service map must declare the ANSS metadata-only security boundary.");
  }
  if (!Array.isArray(map.capabilities) || map.capabilities.length === 0) {
    throw new Error("Service map must include at least one capability.");
  }

  const ids = new Set();
  for (const capability of map.capabilities) {
    if (!capability.id || ids.has(capability.id)) {
      throw new Error(`Invalid or duplicate capability id: ${capability.id}`);
    }
    ids.add(capability.id);
    if (!capability.summary || !capability.http?.method || !capability.http?.path) {
      throw new Error(`Capability ${capability.id} must include summary and http method/path.`);
    }
    if (!capability.safety || typeof capability.safety.writes !== "boolean") {
      throw new Error(`Capability ${capability.id} must include safety metadata.`);
    }
    if (!capability.inputSchema || !capability.outputSchema || !capability.errorSchema) {
      throw new Error(`Capability ${capability.id} must include inputSchema, outputSchema, and errorSchema.`);
    }
    if (capability.http.method !== "GET" && capability.inputSchema.type !== "object") {
      throw new Error(`Write capability ${capability.id} must declare an object inputSchema.`);
    }
  }
}

function checkRuntimeRouteReferences(map, targetErrors) {
  const server = readFileSync(serverPath, "utf8");
  for (const capability of map.capabilities) {
    const method = capability.http.method.toLowerCase();
    const routeDeclaration = `app.${method}("${capability.http.path}"`;
    if (!server.includes(routeDeclaration)) {
      targetErrors.push(`Hono server is missing ${capability.http.method} ${capability.http.path} for ${capability.id}.`);
    }
  }
}

function checkAdapterReferences(map, targetErrors) {
  const aclip = readFileSync(aclipPath, "utf8");
  const mcp = readFileSync(mcpPath, "utf8");
  const openapi = readFileSync(openapiTargets[0], "utf8");

  for (const capability of map.capabilities) {
    if (!openapi.includes(`  ${capability.http.path}:`)) {
      targetErrors.push(`OpenAPI is missing ${capability.http.path} for ${capability.id}.`);
    }
    if (capability.aclip?.command && !aclip.includes(capability.aclip.command)) {
      targetErrors.push(`ACLIP docs are missing ${capability.aclip.command} for ${capability.id}.`);
    }
    if (capability.mcp?.tool && !mcp.includes(capability.mcp.tool)) {
      targetErrors.push(`MCP docs are missing ${capability.mcp.tool} for ${capability.id}.`);
    }
  }
}

function buildInstallManifests(map) {
  const readableCapabilities = map.capabilities.map((capability) => capability.id);
  const cliCapabilities = map.capabilities
    .filter((capability) => capability.aclip?.command)
    .map((capability) => ({
      id: capability.id,
      command: capability.aclip.command,
      aliases: capability.aclip.aliases || [],
      safety: capability.safety,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      errorSchema: capability.errorSchema
    }));
  const mcpTools = map.capabilities
    .filter((capability) => capability.mcp?.tool)
    .map((capability) => ({
      id: capability.id,
      tool: capability.mcp.tool,
      safety: capability.safety,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      errorSchema: capability.errorSchema
    }));

  const base = {
    service: map.service.id,
    generatedFrom: map.generatedFrom,
    registryDependency: "none",
    install: {
      source: "canonical-root",
      userApprovalRequired: true,
      registryDependency: "none",
      note: "The service canonical root is the primary discovery source. Third-party registries may mirror this metadata, but are not required."
    },
    securityBoundary: map.securityBoundary,
    authorization: {
      installRequiresUserApproval: true,
      note: "Adapter discovery is public, but installation and authenticated calls must follow user or organization policy."
    }
  };

  const cli = {
    schema: "anss.adapter-install/0.1",
    adapter: "cli",
    status: "development-local",
    ...base,
    sourcePath: "src/apps/cli",
    runtime: "node",
    protocolRuntime: "@oworker/aclip",
    commands: {
      base: "pnpm --filter ./src/apps/cli run saas --",
      examples: cliCapabilities.map((capability) => capability.command)
    },
    environment: {
      apiBaseUrl: "SAAS_API_BASE_URL",
      token: "SAAS_API_TOKEN"
    },
    clientConfiguration: {
      kind: "local-command",
      command: "pnpm --filter ./src/apps/cli run saas --",
      env: {
        SAAS_API_BASE_URL: "Service API base URL.",
        SAAS_API_TOKEN: "Optional service-defined bearer token."
      }
    },
    externalDistribution: {
      status: "not-configured",
      note: "Projects may publish a CLI through an official binary, package manager, private channel, or not expose one externally."
    },
    capabilities: cliCapabilities
  };

  const mcp = {
    schema: "anss.adapter-install/0.1",
    adapter: "mcp",
    status: "available",
    ...base,
    local: {
      status: "development-local",
      sourcePath: "src/apps/mcp",
      command: "pnpm --filter ./src/apps/mcp run start",
      transport: "executable-skeleton",
      environment: {
        apiBaseUrl: "SAAS_API_BASE_URL",
        token: "SAAS_API_TOKEN"
      }
    },
    remote: {
      status: "available",
      endpoint: "/mcp",
      transport: "streamable-http",
      auth: {
        mode: "same-service-boundary",
        bearerTokenEnv: "SAAS_API_TOKEN"
      },
      clientConfiguration: {
        type: "streamable-http",
        url: "/mcp",
        headers: {
          authorization: "Bearer ${SAAS_API_TOKEN}"
        }
      },
      note: "Remote MCP is exposed from the service canonical root and forwards tool calls to the same Hono capability boundary."
    },
    tools: mcpTools
  };

  const skills = {
    schema: "anss.adapter-install/0.1",
    adapter: "skills",
    status: "guide-only",
    ...base,
    sourcePath: "interfaces/skills/",
    guides: [
      "interfaces/skills/anss-service.md",
      "interfaces/skills/saas-auth.md",
      "interfaces/skills/account-console.md",
      "interfaces/skills/site-admin.md"
    ],
    packageDistribution: {
      status: "not-configured",
      note: "This starter exposes skill-facing guides, not a packaged client-specific Skill bundle."
    },
    capabilities: readableCapabilities
  };

  const openapi = {
    schema: "anss.adapter-install/0.1",
    adapter: "openapi",
    status: "available",
    ...base,
    sourcePath: "interfaces/openapi/saas.openapi.yaml",
    publicPath: "/anss/openapi/saas.openapi.yaml",
    generatedFrom: map.generatedFrom,
    capabilities: readableCapabilities
  };

  return {
    index: {
      schema: "anss.adapter-install-index/0.1",
      service: map.service.id,
      generatedFrom: map.generatedFrom,
      registryDependency: "none",
      adapters: {
        openapi: {
          status: openapi.status,
          manifest: "/anss/install/openapi.json",
          publicPath: openapi.publicPath
        },
        cli: {
          status: cli.status,
          manifest: "/anss/install/cli.json",
          protocolRuntime: cli.protocolRuntime
        },
        mcp: {
          status: mcp.status,
          manifest: "/anss/install/mcp.json",
          remoteStatus: mcp.remote.status,
          remoteEndpoint: mcp.remote.endpoint,
          remoteTransport: mcp.remote.transport
        },
        skills: {
          status: skills.status,
          manifest: "/anss/install/skills.json"
        }
      }
    },
    cli,
    mcp,
    skills,
    openapi
  };
}

function generateOpenApi(map) {
  const paths = {};
  for (const capability of map.capabilities) {
    const method = capability.http.method.toLowerCase();
    paths[capability.http.path] ||= {};
    const operation = {
      operationId: toOperationId(capability.id),
      summary: capability.summary,
      "x-anss-capability-id": capability.id,
      "x-anss-safety": capability.safety,
      "x-anss-input-schema": capability.inputSchema,
      "x-anss-output-schema": capability.outputSchema,
      responses: {
        "200": {
          description: "JSON response",
          content: {
            "application/json": {
              schema: capability.outputSchema
            }
          }
        },
        default: {
          description: "Error response",
          content: {
            "application/json": {
              schema: capability.errorSchema
            }
          }
        }
      }
    };
    if (capability.http.method !== "GET") {
      operation.requestBody = {
        required: false,
        content: {
          "application/json": {
            schema: capability.inputSchema
          }
        }
      };
    }
    paths[capability.http.path][method] = operation;
  }

  return `${toYaml({
    openapi: "3.1.0",
    info: {
      title: "OWorker SaaS Starter API",
      version: "0.1.0",
      description: `Generated from ${map.generatedFrom}.`
    },
    servers: [
      {
        url: map.service.programmableServiceBoundary.localBaseUrl
      }
    ],
    paths
  })}\n`;
}

function generateAclip(map) {
  const commands = map.capabilities.filter((capability) => capability.aclip?.command);
  return `# SaaS ACLIP-Ready CLI Surface

> Generated from \`${map.generatedFrom}\`. Do not hand-edit capability mappings here; update the Hono capability contract instead.

The SaaS Starter includes a local CLI at \`src/apps/cli\`. It is implemented with \`@oworker/aclip\` for Agent-native command disclosure, manifest semantics, structured output, and credential metadata. Business behavior remains a thin forwarder to the Hono API.

Set the API base URL with:

\`\`\`bash
SAAS_API_BASE_URL=http://localhost:3001
\`\`\`

Adapter install state:

- Status: \`development-local\`
- Install manifest: \`/anss/install/cli.json\`
- Protocol runtime: \`@oworker/aclip\`
- External distribution: \`not-configured\`

Each command uses the capability \`inputSchema\`, \`outputSchema\`, \`errorSchema\`, and \`safety\` facts declared in \`/anss/saas.service-map.yaml\`. The CLI does not define a separate business contract.

Supported commands:

\`\`\`bash
${commands.map((capability) => `pnpm --filter ./src/apps/cli run saas -- ${capability.aclip.command}`).join("\n")}
\`\`\`

Command mapping:

| Service capability | CLI command | Hono API |
|---|---|---|
${commands.map((capability) => `| \`${capability.id}\` | \`${capability.aclip.command}\` | \`${capability.http.method} ${capability.http.path}\` |`).join("\n")}

The ACLIP runtime declares \`SAAS_API_TOKEN\` as the service-token credential and forwards it as a bearer token when it is present. Product write actions should require explicit authentication, authorization, confirmation, and audit behavior before being added to this surface.
`;
}

function generateMcp(map) {
  const tools = map.capabilities.filter((capability) => capability.mcp?.tool);
  return `# SaaS MCP Surface

> Generated from \`${map.generatedFrom}\`. Do not hand-edit tool mappings here; update the Hono capability contract instead.

The starter exposes a remote MCP endpoint at \`/mcp\` using Streamable HTTP and keeps tool definitions contract-first. The local \`src/apps/mcp\` executable remains a development helper, but consumer Agents should discover and install the remote endpoint from \`/anss/install/mcp.json\`.

Adapter install state:

- Local MCP: \`development-local\`
- Remote MCP: \`available\`
- Remote endpoint: \`/mcp\`
- Remote transport: \`streamable-http\`
- Install manifest: \`/anss/install/mcp.json\`

Initial tool contracts:

${tools.map((capability) => `- \`${capability.mcp.tool}\`: ${capability.summary}`).join("\n")}

The local development helper can list tools or call a service-map-backed tool from the command line:

\`\`\`bash
pnpm --filter ./src/apps/mcp run start
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/mcp run start -- call saas.health.read
\`\`\`

Remote MCP calls forward authorization to the Hono capability boundary. Production projects should replace the local service-token example with the product's real auth, authorization, confirmation, and audit model.

Remote MCP tools expose generated input and output schemas from the service map. ANSS does not implement authorization or confirmation flows; it only exposes safety metadata so a consumer Agent can decide when user approval or credentials are required by the product service.
`;
}

function generateSkill(map, installManifests) {
  return `# ANSS Service Skill

> Generated from \`${map.generatedFrom}\`. This is a skill-facing guide, not a packaged client-specific Skill bundle.

Use this guide when an Agent needs to discover and call this generated SaaS service.

Start from the canonical root, then read:

- \`/agent-guide.md\`
- \`/.well-known/anss.json\`
- \`/anss/saas.service-map.yaml\`
- \`/anss/install/index.json\`
- \`/llms.txt\`

Current adapter install states:

- OpenAPI: \`${installManifests.openapi.status}\`
- CLI: \`${installManifests.cli.status}\`
- MCP local: \`${installManifests.mcp.local.status}\`
- MCP remote: \`${installManifests.mcp.remote.status}\`
- Skills: \`${installManifests.skills.status}\`

For local validation:

\`\`\`bash
pnpm run anss:conformance
pnpm run anss:agent-probe
\`\`\`

For CLI/API authentication status:

\`\`\`bash
SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- saas auth status --json
\`\`\`
`;
}

function generateAgentGuide(map, installManifests) {
  const capabilities = map.capabilities.map((capability) => `- \`${capability.id}\`: ${capability.summary}`).join("\n");
  return `# OWorker SaaS Starter Agent Service Guide

This public guide is discovered from the canonical service root. It is not part of the primary human UI, but it is intentionally readable and auditable by humans.

## Service Identity

- Service: ${map.service.name}
- Canonical service root: \`/\`
- Discovery manifest: \`/.well-known/anss.json\`
- Service map: \`/anss/saas.service-map.yaml\`
- Adapter install index: \`/anss/install/index.json\`
- LLM document index: \`/llms.txt\`

## Architecture

The human Web experience is served by the Next.js app. Durable programmable service calls are exposed through the Hono API app.

\`\`\`text
Human UI -> Next.js
Agent / CLI / MCP / API clients -> Hono API
\`\`\`

The Hono API is the default programmable service boundary for this starter. Capability metadata is declared once in \`${map.generatedFrom}\`; service-map, OpenAPI, ACLIP, MCP, Skills, and this guide are generated from that contract.

## Available Service Capabilities

The starter exposes a small set of neutral, real SaaS capabilities:

${capabilities}

Read the full mapping at \`/anss/saas.service-map.yaml\`.

## Invocation Adapters

- OpenAPI contract: \`/anss/openapi/saas.openapi.yaml\`
- ACLIP-ready CLI contract: \`interfaces/aclip/saas.md\`
- MCP tool contract: \`interfaces/mcp/saas.md\`
- Remote MCP endpoint: \`/mcp\`
- Skill-facing guides: \`interfaces/skills/\`

Adapter install state:

- OpenAPI: \`${installManifests.openapi.status}\`
- CLI: \`${installManifests.cli.status}\`
- MCP local: \`${installManifests.mcp.local.status}\`
- MCP remote: \`${installManifests.mcp.remote.status}\`
- Skills: \`${installManifests.skills.status}\`

Local API examples:

\`\`\`bash
curl http://localhost:3001/health
curl http://localhost:3001/integrations/health
curl http://localhost:3001/auth/status
curl http://localhost:3001/billing/plans
curl http://localhost:3001/anss/capabilities
\`\`\`

Local CLI examples:

\`\`\`bash
${map.capabilities
  .filter((capability) => capability.aclip?.command)
  .map((capability) => `SAAS_API_BASE_URL=http://localhost:3001 pnpm --filter ./src/apps/cli run saas -- ${capability.aclip.command}`)
  .join("\n")}
\`\`\`

## Auth And Safety

ANSS only declares safety metadata. It does not implement authentication, authorization, confirmation UI, audit storage, an Agent runtime, or a third-party registry.

Read-only public capabilities may be called without a user session. Account, billing, storage, admin, and write actions must use the same service-defined authentication, authorization, confirmation, and audit boundaries as the human Web UI.

Do not infer permission from User-Agent. User-Agent and Agent headers are discovery or negotiation hints, not authorization.

For local CLI/API validation, the starter supports an optional service-token check:

- set \`SAAS_SERVICE_TOKEN\` on the API process;
- set \`SAAS_API_TOKEN\` on the CLI or MCP caller;
- call \`saas auth status --json\` to confirm whether the token is accepted.

This is not a replacement for product authentication. Production projects should use the same auth model as their human product.

## Current Limits

- \`llms.txt\` is the starter-maintained minimal Agent index. Projects that need a full documentation site can add the optional \`docs-site\` extension.
- The CLI is implemented with \`@oworker/aclip\` and remains a development-local distribution by default. Projects can publish binaries or packages later without changing the capability contract.
- MCP is exposed at \`/mcp\` using Streamable HTTP and is suitable for consumer Agent installation from the service canonical root. Production projects should replace the local service-token example with their real product auth before exposing sensitive tools.
- Skills are guide-only by default. Projects can package client-specific Skills later without changing the service capability contract.
- The ANSS v0.1 boundary and return-to-Starter-mainline gate are documented in \`docs/anss-v0.1.md\`.
`;
}

function generateLlms(map, installManifests) {
  return `# OWorker SaaS Starter

> This is the starter-maintained minimal Agent index for the generated SaaS project. Projects that need a full documentation site can add the optional docs-site extension.

## Agent Discovery

- Agent Service Guide: /agent-guide.md
- ANSS discovery manifest: /.well-known/anss.json
- Service capability map: /anss/saas.service-map.yaml
- Adapter install index: /anss/install/index.json

## Runtime Surfaces

- Human Web UI: /
- Hono API health: http://localhost:3001/health
- Hono API capabilities: http://localhost:3001/anss/capabilities
- Hono API auth status: http://localhost:3001/auth/status
- Remote MCP: /mcp

## Adapter Install State

- OpenAPI: ${installManifests.openapi.status}
- CLI: ${installManifests.cli.status}
- MCP local: ${installManifests.mcp.local.status}
- MCP remote: ${installManifests.mcp.remote.status}
- Skills: ${installManifests.skills.status}

## Repository Interface Contracts

- OpenAPI: interfaces/openapi/saas.openapi.yaml
- ACLIP-ready CLI: interfaces/aclip/saas.md
- MCP: interfaces/mcp/saas.md
- Skills: interfaces/skills/
- ANSS service skill: interfaces/skills/anss-service.md

## Safety

ANSS declares safety metadata and adapter entrypoints. The product service remains responsible for authentication, authorization, confirmation, and audit behavior.
`;
}

function toOperationId(id) {
  return id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${pad}- ${formatScalar(item)}`;
        }
        const entries = Object.entries(item);
        if (entries.length === 0) {
          return `${pad}- {}`;
        }
        const [firstKey, firstValue] = entries[0];
        const first = isScalar(firstValue)
          ? `${pad}- ${firstKey}: ${formatScalar(firstValue)}`
          : `${pad}- ${firstKey}:\n${toYaml(firstValue, indent + 4)}`;
        const rest = entries
          .slice(1)
          .map(([key, nested]) =>
            isScalar(nested)
              ? `${" ".repeat(indent + 2)}${key}: ${formatScalar(nested)}`
              : `${" ".repeat(indent + 2)}${key}:\n${toYaml(nested, indent + 4)}`
          );
        return [first, ...rest].join("\n");
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) =>
        isScalar(nested)
          ? `${pad}${key}: ${formatScalar(nested)}`
          : `${pad}${key}:\n${toYaml(nested, indent + 2)}`
      )
      .join("\n");
  }
  return `${pad}${formatScalar(value)}`;
}

function isScalar(value) {
  return value === null || typeof value !== "object";
}

function formatScalar(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function relative(path) {
  return path.replace(`${root}\\`, "").replace(`${root}/`, "");
}
