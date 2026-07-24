import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRuntimeArgv } from "../../src/apps/cli/src/argv.mjs";

test("normalizes direct ACLIP arguments", () => {
  assert.deepEqual(normalizeRuntimeArgv(["saas", "health", "read", "--json"]), [
    "health",
    "read",
    "--json"
  ]);
});

test("normalizes pnpm-separated ACLIP arguments", () => {
  assert.deepEqual(normalizeRuntimeArgv(["--", "saas", "health", "read", "--json"]), [
    "health",
    "read",
    "--json"
  ]);
});
