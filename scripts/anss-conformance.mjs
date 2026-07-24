import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const serviceMap = JSON.parse(readFileSync(join(root, "interfaces/service-map/saas.service-map.json"), "utf8"));
const webBaseUrl = withoutTrailingSlash(process.env.ANSS_WEB_BASE_URL || "http://localhost:3000");
const apiBaseUrl = withoutTrailingSlash(
  process.env.ANSS_API_BASE_URL || process.env.SAAS_API_BASE_URL || process.env.API_BASE_URL || "http://localhost:3001"
);
const jsonOutput = process.argv.includes("--json");
const checks = [];

try {
  await run();
  const summary = {
    status: "pass",
    webBaseUrl,
    apiBaseUrl,
    expectedCapabilities: serviceMap.capabilities.length,
    checks
  };
  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("ANSS conformance check passed.");
  }
} catch (error) {
  const summary = {
    status: "fail",
    webBaseUrl,
    apiBaseUrl,
    checks,
    error: error instanceof Error ? error.message : String(error)
  };
  console.error(jsonOutput ? JSON.stringify(summary, null, 2) : summary.error);
  process.exit(1);
}

async function run() {
  const rootResponse = await fetchOk(webBaseUrl, "canonical root", { method: "HEAD" });
  const rootLink = rootResponse.headers.get("link") || "";
  assert(rootLink.includes("agent-service-guide"), "canonical root exposes agent-service-guide Link header");

  const manifest = await fetchJson(new URL("/.well-known/anss.json", webBaseUrl), "ANSS discovery manifest");
  assert(manifest.schema === "anss.discovery/0.1", "manifest schema is anss.discovery/0.1");
  assert(Boolean(manifest.discovery?.agentServiceGuide), "manifest points to Agent Service Guide");
  assert(Boolean(manifest.discovery?.serviceMap), "manifest points to service map");
  assert(Boolean(manifest.discovery?.installIndex), "manifest points to adapter install index");
  assert(Boolean(manifest.programmableServiceBoundary?.capabilities), "manifest points to capabilities endpoint");
  assert(manifest.install?.registryDependency === "none", "manifest does not require a third-party registry");
  assert(Boolean(manifest.install?.cli), "manifest points to CLI install manifest");
  assert(Boolean(manifest.install?.mcp), "manifest points to MCP install manifest");
  assert(Boolean(manifest.install?.skills), "manifest points to Skills install manifest");
  assert(Boolean(manifest.install?.openapi), "manifest points to OpenAPI install manifest");
  assert(manifest.securityBoundary?.scope === "metadata-only", "manifest declares ANSS metadata-only security boundary");
  assert(manifest.securityBoundary?.adapterCallsUseSameServiceBoundary === true, "manifest requires adapters to use the service boundary");

  const guide = await fetchText(new URL("/agent-guide.md", webBaseUrl), "Agent Service Guide");
  assert(guide.includes("Agent Service Guide"), "Agent Service Guide content is readable");

  const llms = await fetchText(new URL("/llms.txt", webBaseUrl), "llms.txt");
  assert(llms.includes("Agent Discovery"), "llms.txt content is readable");

  const serviceMapText = await fetchText(new URL("/anss/saas.service-map.yaml", webBaseUrl), "public service map");
  assert(serviceMapText.includes("generatedFrom"), "public service map declares generated source");
  assert(serviceMapText.includes("securityBoundary"), "public service map declares security boundary");
  assert(serviceMapText.includes("inputSchema"), "public service map declares input schemas");
  assert(serviceMapText.includes("outputSchema"), "public service map declares output schemas");
  for (const capability of serviceMap.capabilities) {
    assert(serviceMapText.includes(capability.id), `public service map includes ${capability.id}`);
  }

  const installIndex = await fetchJson(new URL(manifest.install.index), "adapter install index");
  assert(installIndex.schema === "anss.adapter-install-index/0.1", "install index schema is readable");
  assert(installIndex.registryDependency === "none", "install index does not require a third-party registry");
  assert(installIndex.adapters?.cli?.status === "development-local", "CLI install state is development-local");
  assert(installIndex.adapters?.cli?.protocolRuntime === "@oworker/aclip", "CLI install index declares ACLIP runtime");
  assert(installIndex.adapters?.mcp?.status === "available", "MCP install state is available");
  assert(installIndex.adapters?.mcp?.remoteStatus === "available", "remote MCP state is available");
  assert(installIndex.adapters?.mcp?.remoteEndpoint === "/mcp", "remote MCP endpoint is discoverable");
  assert(installIndex.adapters?.mcp?.remoteTransport === "streamable-http", "remote MCP transport is discoverable");
  assert(installIndex.adapters?.skills?.status === "guide-only", "Skills install state is guide-only");
  assert(installIndex.adapters?.openapi?.status === "available", "OpenAPI install state is available");

  const cliInstall = await fetchJson(new URL(manifest.install.cli), "CLI install manifest");
  assert(cliInstall.status === "development-local", "CLI install manifest is development-local");
  assert(cliInstall.install?.source === "canonical-root", "CLI install manifest declares canonical-root source");
  assert(cliInstall.securityBoundary?.scope === "metadata-only", "CLI install manifest carries security boundary");
  assert(cliInstall.clientConfiguration?.kind === "local-command", "CLI install manifest declares client configuration");
  assert(cliInstall.externalDistribution?.status === "not-configured", "CLI external distribution is not configured by default");
  assertSameIds(cliInstall.capabilities.map((capability) => capability.id), "CLI install capabilities");
  assert(cliInstall.capabilities.every((capability) => capability.inputSchema), "CLI install capabilities include input schemas");
  assert(cliInstall.capabilities.every((capability) => capability.outputSchema), "CLI install capabilities include output schemas");

  const mcpInstall = await fetchJson(new URL(manifest.install.mcp), "MCP install manifest");
  assert(mcpInstall.local?.status === "development-local", "MCP local install manifest is development-local");
  assert(mcpInstall.remote?.status === "available", "MCP remote install manifest is available");
  assert(mcpInstall.remote?.endpoint === "/mcp", "MCP remote endpoint is /mcp");
  assert(mcpInstall.remote?.transport === "streamable-http", "MCP remote transport is Streamable HTTP");
  assert(mcpInstall.install?.source === "canonical-root", "MCP install manifest declares canonical-root source");
  assert(mcpInstall.securityBoundary?.scope === "metadata-only", "MCP install manifest carries security boundary");
  assert(mcpInstall.remote?.clientConfiguration?.type === "streamable-http", "MCP install manifest declares client configuration");
  assertSameIds(mcpInstall.tools.map((tool) => tool.id), "MCP install tools");
  assert(mcpInstall.tools.every((tool) => tool.inputSchema), "MCP install tools include input schemas");
  assert(mcpInstall.tools.every((tool) => tool.outputSchema), "MCP install tools include output schemas");
  await assertRemoteMcp(mcpInstall);

  const skillsInstall = await fetchJson(new URL(manifest.install.skills), "Skills install manifest");
  assert(skillsInstall.status === "guide-only", "Skills install manifest is guide-only");
  assertSameIds(skillsInstall.capabilities, "Skills install capabilities");

  const openapiInstall = await fetchJson(new URL(manifest.install.openapi), "OpenAPI install manifest");
  assert(openapiInstall.status === "available", "OpenAPI install manifest is available");
  const publicOpenApi = await fetchText(new URL(openapiInstall.publicPath, webBaseUrl), "public OpenAPI");
  assert(publicOpenApi.includes("x-anss-input-schema"), "public OpenAPI includes ANSS input schema metadata");
  assert(publicOpenApi.includes("x-anss-output-schema"), "public OpenAPI includes ANSS output schema metadata");
  for (const capability of serviceMap.capabilities) {
    assert(publicOpenApi.includes(capability.id), `public OpenAPI includes ${capability.id}`);
  }

  const apiCapabilities = await fetchJson(new URL("/anss/capabilities", apiBaseUrl), "API capabilities");
  assert(apiCapabilities.schema === "anss.capabilities/0.1", "API capabilities schema is anss.capabilities/0.1");
  assertSameCapabilities(apiCapabilities.capabilities, "API capabilities");
  assert(apiCapabilities.capabilities.every((capability) => capability.inputSchema), "API capabilities include input schemas");
  assert(apiCapabilities.capabilities.every((capability) => capability.outputSchema), "API capabilities include output schemas");
  assert(apiCapabilities.capabilities.every((capability) => capability.errorSchema), "API capabilities include error schemas");

  const cliEnvelope = runCli();
  assert(cliEnvelope.protocol === "aclip/0.1", "CLI returns an ACLIP envelope");
  assert(cliEnvelope.type === "result" && cliEnvelope.ok === true, "CLI returns an ACLIP result");
  const cli = cliEnvelope.data;
  assert(cli.schema === "anss.capabilities/0.1", "CLI returns ANSS capabilities schema");
  assertSameCapabilities(cli.capabilities, "CLI capabilities");
}

async function assertRemoteMcp(mcpInstall) {
  const endpoint = new URL(mcpInstall.remote.endpoint, webBaseUrl);
  const initialize = await callMcp(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "anss-conformance", version: "0.1.0" }
      }
    },
    "remote MCP initialize"
  );
  assert(!initialize.error, "remote MCP initialize succeeds");

  const tools = await callMcp(endpoint, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "remote MCP tools/list");
  assert(!tools.error, "remote MCP lists tools");
  const toolNames = (tools.result?.tools || []).map((tool) => tool.name).sort();
  const expectedToolNames = serviceMap.capabilities.map((capability) => capability.mcp.tool).sort();
  assert(JSON.stringify(toolNames) === JSON.stringify(expectedToolNames), "remote MCP tools match service-map");
  assert((tools.result?.tools || []).every((tool) => tool.inputSchema), "remote MCP tools include input schemas");
  assert((tools.result?.tools || []).every((tool) => tool.outputSchema), "remote MCP tools include output schemas");

  const health = await callMcp(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "saas.health.read",
        arguments: {}
      }
    },
    "remote MCP tools/call"
  );
  assert(!health.error, "remote MCP calls selected tool");
  assert(health.result?.structuredContent?.status === "ok", "remote MCP selected tool returns structured content");
}

async function callMcp(url, message, label) {
  const response = await fetchOk(url, label, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify(message)
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  return parseMcpPayload(text, contentType);
}

function parseMcpPayload(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter(Boolean)
      .at(-1);
    if (!data) {
      throw new Error("MCP event-stream response did not include a data payload.");
    }
    return JSON.parse(data);
  }
  return text ? JSON.parse(text) : {};
}

async function fetchOk(url, label, init = {}) {
  const response = await fetch(url, init);
  assert(response.ok, `${label} returns ${response.status}`);
  return response;
}

async function fetchJson(url, label) {
  const response = await fetchOk(url, label);
  return response.json();
}

async function fetchText(url, label) {
  const response = await fetchOk(url, label);
  return response.text();
}

function runCli() {
  const result = spawnSync(
    process.execPath,
    ["src/apps/cli/src/cli.mjs", "saas", "anss", "capabilities", "read", "--json"],
    {
      cwd: root,
      env: {
        ...process.env,
        SAAS_API_BASE_URL: apiBaseUrl
      },
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "CLI capabilities command failed.");
  }
  return JSON.parse(result.stdout);
}

function assertSameCapabilities(actual, label) {
  const expectedIds = serviceMap.capabilities.map((capability) => capability.id).sort();
  const actualIds = (actual || []).map((capability) => capability.id).sort();
  assertSameIds(actualIds, label);
}

function assertSameIds(actual, label) {
  const expectedIds = serviceMap.capabilities.map((capability) => capability.id).sort();
  const actualIds = (actual || []).sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${label} matches service-map capability ids`);
}

function assert(condition, message) {
  checks.push({ status: condition ? "pass" : "fail", message });
  if (!condition) {
    throw new Error(message);
  }
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
