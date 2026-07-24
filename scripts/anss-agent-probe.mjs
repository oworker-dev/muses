import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const expectedServiceMap = JSON.parse(readFileSync(join(rootDir, "interfaces/service-map/saas.service-map.json"), "utf8"));
const rootUrl = withoutTrailingSlash(process.env.ANSS_ROOT_URL || process.env.ANSS_WEB_BASE_URL || "http://localhost:3000");
const jsonOutput = process.argv.includes("--json");
const steps = [];

try {
  const report = await probe();
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("ANSS agent probe passed.");
    console.log(`Root: ${report.rootUrl}`);
    console.log(`Guide: ${report.discovery.agentServiceGuide}`);
    console.log(`Capabilities: ${report.capabilities.count}`);
    console.log(`Selected API capability: ${report.selected.apiCapability}`);
    console.log(`Selected CLI capability: ${report.selected.cliCapability}`);
    console.log(`Selected MCP tool: ${report.selected.mcpTool}`);
  }
} catch (error) {
  const report = {
    status: "fail",
    rootUrl,
    steps,
    error: error instanceof Error ? error.message : String(error)
  };
  console.error(jsonOutput ? JSON.stringify(report, null, 2) : report.error);
  process.exit(1);
}

async function probe() {
  const rootResponse = await fetchOk(rootUrl, "fetch canonical root", { method: "HEAD" });
  const links = parseLinkHeader(rootResponse.headers.get("link") || "", rootUrl);
  assert(Boolean(links["agent-service-guide"]), "root exposes agent-service-guide link");

  const manifestUrl = links["service-manifest"] || new URL("/.well-known/anss.json", rootUrl).href;
  const manifest = await fetchJson(manifestUrl, "read discovery manifest");
  assert(manifest.schema === "anss.discovery/0.1", "manifest schema is readable");
  assert(manifest.install?.registryDependency === "none", "manifest does not require a third-party registry");
  assert(manifest.securityBoundary?.scope === "metadata-only", "agent understands ANSS security metadata boundary");

  const guideUrl = manifest.discovery?.agentServiceGuide || links["agent-service-guide"];
  const serviceMapUrl = manifest.discovery?.serviceMap || links["service-map"];
  const capabilitiesUrl = manifest.programmableServiceBoundary?.capabilities;
  const installIndexUrl = manifest.install?.index || links["adapter-install"];
  assert(Boolean(guideUrl), "manifest resolves Agent Service Guide");
  assert(Boolean(serviceMapUrl), "manifest resolves service map");
  assert(Boolean(capabilitiesUrl), "manifest resolves capabilities endpoint");
  assert(Boolean(installIndexUrl), "manifest resolves adapter install index");

  const guide = await fetchText(guideUrl, "read Agent Service Guide");
  assert(guide.includes("Invocation Adapters"), "guide explains invocation adapters");

  const serviceMapText = await fetchText(serviceMapUrl, "read public service map");
  assert(serviceMapText.includes("generatedFrom"), "service map declares generated source");
  for (const capability of expectedServiceMap.capabilities) {
    assert(serviceMapText.includes(capability.id), `service map includes ${capability.id}`);
  }

  const installIndex = await fetchJson(installIndexUrl, "read adapter install index");
  assert(installIndex.adapters?.cli?.status === "development-local", "agent understands local CLI install state");
  assert(installIndex.adapters?.cli?.protocolRuntime === "@oworker/aclip", "agent understands CLI protocol runtime");
  assert(installIndex.adapters?.mcp?.status === "available", "agent understands MCP install state");
  assert(installIndex.adapters?.mcp?.remoteStatus === "available", "agent understands remote MCP is available");
  assert(installIndex.adapters?.mcp?.remoteEndpoint === "/mcp", "agent discovers remote MCP endpoint");
  assert(installIndex.adapters?.mcp?.remoteTransport === "streamable-http", "agent discovers remote MCP transport");
  assert(installIndex.adapters?.skills?.status === "guide-only", "agent understands Skills are guide-only");
  assert(installIndex.adapters?.openapi?.status === "available", "agent understands OpenAPI is available");

  const cliInstall = await fetchJson(new URL(installIndex.adapters.cli.manifest, rootUrl).href, "read CLI install manifest");
  assert(cliInstall.externalDistribution?.status === "not-configured", "agent does not assume a public CLI binary exists");
  assert(cliInstall.install?.source === "canonical-root", "agent understands CLI install source");
  assert(cliInstall.securityBoundary?.scope === "metadata-only", "agent understands CLI security boundary");
  assert(cliInstall.capabilities?.every((capability) => capability.inputSchema && capability.outputSchema), "agent reads CLI capability schemas");

  const mcpInstall = await fetchJson(new URL(installIndex.adapters.mcp.manifest, rootUrl).href, "read MCP install manifest");
  assert(mcpInstall.remote?.status === "available", "agent confirms remote MCP exists");
  assert(mcpInstall.remote?.transport === "streamable-http", "agent understands remote MCP transport");
  assert(mcpInstall.remote?.clientConfiguration?.url === "/mcp", "agent can construct remote MCP client configuration");
  assert(mcpInstall.securityBoundary?.scope === "metadata-only", "agent understands MCP security boundary");
  assert(mcpInstall.tools?.every((tool) => tool.inputSchema && tool.outputSchema), "agent reads MCP tool schemas");

  const apiCapabilities = await fetchJson(capabilitiesUrl, "read API capabilities");
  const expectedIds = expectedServiceMap.capabilities.map((capability) => capability.id).sort();
  const actualIds = apiCapabilities.capabilities.map((capability) => capability.id).sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), "API capabilities match service-map");
  assert(apiCapabilities.capabilities.every((capability) => capability.inputSchema), "agent can read capability input schemas");
  assert(apiCapabilities.capabilities.every((capability) => capability.outputSchema), "agent can read capability output schemas");
  assert(apiCapabilities.capabilities.every((capability) => capability.errorSchema), "agent can read capability error schemas");

  const apiReadable = apiCapabilities.capabilities.find(
    (capability) => capability.id === "saas.health.read" && capability.http?.method === "GET"
  );
  assert(Boolean(apiReadable), "agent can choose a read-only API capability");
  const apiResult = await fetchJson(new URL(apiReadable.http.path, capabilitiesUrl).href, "call selected API capability");
  assert(Boolean(apiResult.status), "selected API capability returns structured result");

  const cliReadable = expectedServiceMap.capabilities.find((capability) => capability.id === "saas.anss.capabilities.read");
  assert(Boolean(cliReadable?.aclip?.command), "agent can choose an ACLIP-ready CLI capability");
  const cliEnvelope = runCli(cliReadable.aclip.command, new URL(capabilitiesUrl).origin);
  assert(cliEnvelope.protocol === "aclip/0.1", "selected CLI capability returns ACLIP envelope");
  assert(cliEnvelope.type === "result" && cliEnvelope.ok === true, "selected CLI capability succeeds");
  const cliResult = cliEnvelope.data;
  assert(cliResult.schema === "anss.capabilities/0.1", "selected CLI capability returns structured result");

  const mcpTool = await callRemoteMcpTool(mcpInstall, "saas.health.read");
  assert(mcpTool.result?.structuredContent?.status === "ok", "selected MCP tool returns structured result");

  return {
    status: "pass",
    rootUrl,
    discovery: {
      agentServiceGuide: guideUrl,
      serviceMap: serviceMapUrl,
      capabilities: capabilitiesUrl,
      installIndex: installIndexUrl
    },
    capabilities: {
      count: actualIds.length,
      ids: actualIds
    },
    selected: {
      apiCapability: apiReadable.id,
      cliCapability: cliReadable.id,
      mcpTool: "saas.health.read"
    },
    steps
  };
}

async function callRemoteMcpTool(mcpInstall, toolName) {
  const endpoint = new URL(mcpInstall.remote.endpoint, rootUrl).href;
  const initialize = await callMcp(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "anss-agent-probe", version: "0.1.0" }
      }
    },
    "initialize remote MCP"
  );
  assert(!initialize.error, "agent initializes remote MCP");

  const tools = await callMcp(endpoint, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "list remote MCP tools");
  assert(!tools.error, "agent lists remote MCP tools");
  const toolNames = (tools.result?.tools || []).map((tool) => tool.name);
  assert(toolNames.includes(toolName), `agent discovers ${toolName} MCP tool`);
  const selectedTool = (tools.result?.tools || []).find((tool) => tool.name === toolName);
  assert(Boolean(selectedTool?.inputSchema), `agent sees ${toolName} input schema`);
  assert(Boolean(selectedTool?.outputSchema), `agent sees ${toolName} output schema`);

  const result = await callMcp(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {}
      }
    },
    `call remote MCP tool ${toolName}`
  );
  assert(!result.error, `agent calls ${toolName} MCP tool`);
  return result;
}

async function fetchOk(url, label, init = {}) {
  const response = await fetch(url, init);
  assert(response.ok, `${label} returned ${response.status}`);
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

function runCli(command, apiBaseUrl) {
  const args = command.split(/\s+/).filter(Boolean);
  const result = spawnSync(process.execPath, ["src/apps/cli/src/cli.mjs", ...args], {
    cwd: rootDir,
    env: {
      ...process.env,
      SAAS_API_BASE_URL: apiBaseUrl
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "CLI command failed.");
  }
  return JSON.parse(result.stdout);
}

function parseLinkHeader(header, baseUrl) {
  const links = {};
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (!match) {
      continue;
    }
    links[match[2]] = new URL(match[1], baseUrl).href;
  }
  return links;
}

function assert(condition, message) {
  steps.push({ status: condition ? "pass" : "fail", message });
  if (!condition) {
    throw new Error(message);
  }
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
