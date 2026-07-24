import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AclipApp, envCredential, runCli, stringArgument } from "@oworker/aclip";

import { normalizeRuntimeArgv } from "./argv.mjs";

const serviceMap = readServiceMap();

if (process.argv.includes("--check")) {
  console.log("OWorker SaaS ACLIP CLI check passed.");
  process.exit(0);
}

void runCli(createApp(), normalizeRuntimeArgv(process.argv.slice(2)));

function createApp() {
  const app = new AclipApp({
    name: "saas",
    version: "0.1.0",
    summary: "Agent-ready CLI for the OWorker SaaS Starter.",
    description:
      "Uses ACLIP for command disclosure and structured output, while forwarding capability calls to the Hono service boundary.",
    credentials: [
      envCredential("service-token", {
        envVar: "SAAS_API_TOKEN",
        required: false,
        description: "Optional bearer token forwarded to the SaaS API and remote service boundary."
      })
    ]
  });
  const groups = new Map();

  for (const capability of serviceMap.capabilities) {
    if (!capability.aclip?.command) {
      continue;
    }
    const path = normalizeAclipPath(capability.aclip.command);
    if (!path.length) {
      continue;
    }
    const parent = ensureGroup(app, groups, path.slice(0, -1));
    const name = path.at(-1);
    const registration = {
      summary: capability.summary,
      description: buildDescription(capability),
      arguments: capability.http.method === "GET" ? [] : [bodyArgument()],
      examples: [`saas ${path.join(" ")} --json`],
      handler: async (payload) => callCapability(capability, payload)
    };

    if (parent) {
      parent.command(name, registration);
    } else {
      app.command(name, registration);
    }
  }

  return app;
}

async function callCapability(capability, payload) {
  const apiBaseUrl = (process.env.SAAS_API_BASE_URL || process.env.API_BASE_URL || "http://localhost:3001").replace(
    /\/+$/,
    ""
  );
  const headers = {
    accept: "application/json",
    "user-agent": "oworker-saas-aclip/0.1"
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
    init.body = JSON.stringify(createBody(payload));
  }

  const response = await fetch(`${apiBaseUrl}${capability.http.path}`, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed with status ${response.status}.`);
  }
  return text ? JSON.parse(text) : {};
}

function createBody(payload) {
  if (!payload.body) {
    return {};
  }
  if (typeof payload.body === "string") {
    return JSON.parse(payload.body);
  }
  return payload.body;
}

function bodyArgument() {
  return stringArgument("body", {
    flag: "--body",
    required: false,
    description: "JSON request body passed through to the Hono capability endpoint."
  });
}

function ensureGroup(app, groups, path) {
  if (!path.length) {
    return null;
  }
  const key = path.join(" ");
  if (groups.has(key)) {
    return groups.get(key);
  }

  const parent = ensureGroup(app, groups, path.slice(0, -1));
  const groupName = path.at(-1);
  const registration = {
    summary: `${path.join(" ")} commands.`,
    description: `ACLIP command group generated from the ANSS service capability contract for ${path.join(" ")}.`
  };
  const builder = parent ? parent.group(groupName, registration) : app.group(groupName, registration);
  groups.set(key, builder);
  return builder;
}

function buildDescription(capability) {
  const safety = capability.safety || {};
  return [
    capability.summary,
    `Capability: ${capability.id}.`,
    `HTTP: ${capability.http.method} ${capability.http.path}.`,
    `Access: ${safety.access || "unspecified"}.`,
    safety.requiresUserConfirmation ? "Requires user confirmation before execution." : "Does not require confirmation."
  ].join(" ");
}

function normalizeAclipPath(command) {
  return command
    .split(/\s+/)
    .filter((part) => part && part !== "saas" && part !== "--json" && !part.startsWith("<"))
    .filter((part) => !part.startsWith("--"))
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
