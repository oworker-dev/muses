import { NextResponse } from "next/server"

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}

function getWebBaseUrl() {
  return withoutTrailingSlash(
    process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000",
  )
}

function getApiBaseUrl() {
  return withoutTrailingSlash(
    process.env.API_PUBLIC_URL || process.env.API_BASE_URL || "http://localhost:3001",
  )
}

export function GET() {
  const webBaseUrl = getWebBaseUrl()
  const apiBaseUrl = getApiBaseUrl()

  const body = {
    schema: "anss.discovery/0.1",
    service: {
      id: "oworker.saas-starter",
      name: "OWorker SaaS Starter",
      canonicalServiceRoot: webBaseUrl,
      summary:
        "Production-minded SaaS starter with a Next.js human UI and a Hono programmable service boundary.",
    },
    discovery: {
      agentServiceGuide: `${webBaseUrl}/agent-guide.md`,
      llms: `${webBaseUrl}/llms.txt`,
      serviceMap: `${webBaseUrl}/anss/saas.service-map.yaml`,
      installIndex: `${webBaseUrl}/anss/install/index.json`,
    },
    programmableServiceBoundary: {
      type: "hono",
      apiBaseUrl,
      capabilities: `${apiBaseUrl}/anss/capabilities`,
      health: `${apiBaseUrl}/health`,
      contracts: `${apiBaseUrl}/contracts/summary`,
    },
    adapters: {
      openapi: {
        status: "available",
        sourcePath: "interfaces/openapi/saas.openapi.yaml",
        publicUrl: `${webBaseUrl}/anss/openapi/saas.openapi.yaml`,
        installManifest: `${webBaseUrl}/anss/install/openapi.json`,
      },
      aclip: {
        status: "development-local",
        protocolRuntime: "@oworker/aclip",
        sourcePath: "interfaces/aclip/saas.md",
        localCli: "pnpm --filter ./src/apps/cli run saas -- saas health read --json",
        installManifest: `${webBaseUrl}/anss/install/cli.json`,
      },
      mcp: {
        status: "available",
        sourcePath: "interfaces/mcp/saas.md",
        localManifest: `${webBaseUrl}/anss/install/mcp.json`,
        remote: {
          status: "available",
          endpoint: `${webBaseUrl}/mcp`,
          transport: "streamable-http",
        },
      },
      skills: {
        status: "guide-only",
        sourcePath: "interfaces/skills/",
        installManifest: `${webBaseUrl}/anss/install/skills.json`,
      },
    },
    install: {
      index: `${webBaseUrl}/anss/install/index.json`,
      openapi: `${webBaseUrl}/anss/install/openapi.json`,
      cli: `${webBaseUrl}/anss/install/cli.json`,
      mcp: `${webBaseUrl}/anss/install/mcp.json`,
      skills: `${webBaseUrl}/anss/install/skills.json`,
      registryDependency: "none",
    },
    securityBoundary: {
      scope: "metadata-only",
      adapterCallsUseSameServiceBoundary: true,
      credentialModel: "service-defined",
      userAgentIsAuthorization: false,
      outOfScope: [
        "authentication",
        "authorization",
        "confirmation-ui",
        "audit-log-storage",
        "agent-runtime",
        "third-party-registry",
      ],
    },
    safety: {
      note:
        "ANSS declares safety metadata and adapter entrypoints. The product service remains responsible for authentication, authorization, confirmation, and audit behavior.",
    },
  }

  const response = NextResponse.json(body)
  response.headers.set(
    "Link",
    '</agent-guide.md>; rel="agent-service-guide"; type="text/markdown", </anss/saas.service-map.yaml>; rel="service-map"; type="text/yaml", </anss/install/index.json>; rel="adapter-install"; type="application/json", </mcp>; rel="mcp"; type="application/json", </llms.txt>; rel="llms"; type="text/plain"',
  )
  return response
}
