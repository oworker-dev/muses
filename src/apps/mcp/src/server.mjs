import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serviceMap = readServiceMap();
const tools = serviceMap.capabilities
  .filter((capability) => capability.mcp?.tool)
  .map((capability) => ({
    name: capability.mcp.tool,
    description: capability.summary,
    http: capability.http,
    safety: capability.safety
  }));

if (process.argv.includes("--check")) {
  console.log("OWorker SaaS MCP executable skeleton check passed.");
  process.exit(0);
}

const [command, toolName] = process.argv.slice(2);

if (!command) {
  console.log(JSON.stringify({ service: "oworker.saas.mcp", status: "executable-skeleton", tools }, null, 2));
  process.exit(0);
}

if (command !== "call" || !toolName) {
  printUsage();
  process.exit(1);
}

const capability = serviceMap.capabilities.find((item) => item.mcp?.tool === toolName);
if (!capability) {
  console.error(`Unknown MCP tool: ${toolName}`);
  printUsage();
  process.exit(1);
}

try {
  const input = readInputJson();
  const result = await callCapability(capability, input);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function callCapability(capability, input) {
  const apiBaseUrl = (process.env.SAAS_API_BASE_URL || process.env.API_BASE_URL || "http://localhost:3001").replace(
    /\/+$/,
    ""
  );
  const headers = {
    accept: "application/json",
    "user-agent": "oworker-saas-mcp/0.1"
  };
  if (process.env.SAAS_API_TOKEN) {
    headers.authorization = `Bearer ${process.env.SAAS_API_TOKEN}`;
  }

  const init = {
    method: capability.http.method,
    headers
  };
  if (capability.http.method !== "GET") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(input);
  }

  const response = await fetch(`${apiBaseUrl}${capability.http.path}`, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Tool call failed with status ${response.status}.`);
  }
  return text ? JSON.parse(text) : null;
}

function readInputJson() {
  const index = process.argv.indexOf("--input-json");
  if (index === -1) {
    return {};
  }
  return JSON.parse(process.argv[index + 1] || "{}");
}

function printUsage() {
  console.error("Usage: node src/server.mjs call <tool-name> [--input-json '{\"prompt\":\"...\"}']");
}

function readServiceMap() {
  const candidates = [
    process.env.ANSS_SERVICE_MAP_PATH,
    fileURLToPath(new URL("../../../../interfaces/service-map/saas.service-map.json", import.meta.url))
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8"));
    }
  }

  throw new Error("ANSS service map not found.");
}
