import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const workspaceRoot = new URL("../", import.meta.url)
const webPackage = JSON.parse(
  await readFile(new URL("src/apps/web/package.json", workspaceRoot), "utf8"),
)
const lockfile = await readFile(new URL("pnpm-lock.yaml", workspaceRoot), "utf8")
const packages = new Map([
  ["@oworker/open-agent-client", "agent-client"],
  ["@oworker/open-agent-contracts", "agent-contracts"],
  ["@oworker/open-agent-host", "agent-host"],
])
const commits = new Set()

for (const [packageName, packagePath] of packages) {
  const specifier = webPackage.dependencies?.[packageName]
  const match = specifier?.match(
    new RegExp(
      `^github:oworker-dev/open-agent#([0-9a-f]{40})&path:/packages/${packagePath}$`,
    ),
  )
  assert.ok(match, `${packageName} must use an exact Muses Agent commit and package path.`)
  commits.add(match[1])
}

assert.equal(commits.size, 1, "All Agent SDK packages must resolve from the same commit.")
const [commit] = commits

for (const forbidden of [
  "release-assets.githubusercontent.com",
  "github.com/oworker-dev/open-agent/releases/download/",
  "jwt=",
]) {
  assert.equal(lockfile.includes(forbidden), false, `pnpm-lock.yaml contains ${forbidden}.`)
}

for (const packagePath of packages.values()) {
  const immutableSource =
    `https://codeload.github.com/oworker-dev/open-agent/tar.gz/${commit}`
    + `#path:/packages/${packagePath}`
  assert.ok(
    lockfile.includes(immutableSource),
    `pnpm-lock.yaml does not freeze ${packagePath} to ${commit}.`,
  )
}

console.log(JSON.stringify({ commit, packages: [...packages.keys()], ok: true }))
