import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production Compose passes the complete Muses Agent Host boundary", async () => {
  const compose = await readFile(
    new URL("ops/docker/compose.yaml", root),
    "utf8",
  );
  for (const name of [
    "MUSES_AGENT_SERVICE_URL",
    "MUSES_AGENT_PUBLIC_URL",
    "MUSES_AGENT_HOST_JWT_SECRET",
    "MUSES_AGENT_HOST_JWT_ISSUER",
    "MUSES_AGENT_HOST_JWT_AUDIENCE",
    "MUSES_AGENT_HOST_JWT_TTL_SECONDS",
    "MUSES_AGENT_RUNTIME_CONFIG_JSON",
    "MUSES_AGENT_MODELS_JSON",
    "MUSES_AGENT_DEFAULT_MODEL_ID",
    "MUSES_AGENT_HOST_TOOLS_SECRET",
    "MUSES_AGENT_PROVIDER_BROKER_SECRET",
  ]) {
    assert.match(
      compose,
      new RegExp(`^\\s+${name}: \\$\\{${name}(?::-.*)?\\}$`, "m"),
    );
  }
});

test("the root package exposes both production Host directions", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    pkg.scripts["verify:workflow-agent-bridge"],
    "node scripts/verify-workflow-agent-bridge.mjs",
  );
  assert.equal(
    pkg.scripts["verify:agent-host-canvas"],
    "node scripts/verify-agent-host-canvas.mjs",
  );
});
