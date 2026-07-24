import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const projectName =
  process.env.OWORKER_DOCKER_PROJECT ||
  process.env.COMPOSE_PROJECT_NAME ||
  normalizeProjectName(readPackageName())
const defaultEnvFile = fileURLToPath(new URL("../.env.development", import.meta.url))
const defaultExternalEnvFile = fileURLToPath(
  new URL("../.tmp/external.runtime.env", import.meta.url),
)
const { envFileArgs, commandArgs } = extractEnvFileArgs(args)
const composeArgs = ["compose", "-p", projectName, "-f", "ops/docker/compose.yaml"]

if (envFileArgs.length > 0) {
  composeArgs.push(...envFileArgs)
} else if (existsSync(defaultEnvFile)) {
  composeArgs.push("--env-file", defaultEnvFile)
  if (existsSync(defaultExternalEnvFile)) {
    composeArgs.push("--env-file", defaultExternalEnvFile)
  }
}

composeArgs.push(...commandArgs)

const result = spawnSync(
  "docker",
  composeArgs,
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  }
)

process.exit(result.status ?? 1)

function readPackageName() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    return typeof pkg.name === "string" ? pkg.name : "oworker-saas"
  } catch {
    return "oworker-saas"
  }
}

function normalizeProjectName(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "oworker-saas"
  )
}

function extractEnvFileArgs(values) {
  const envFileArgs = []
  const commandArgs = []

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]

    if (value === "--env-file") {
      envFileArgs.push(value)
      if (values[index + 1]) {
        envFileArgs.push(values[index + 1])
        index += 1
      }
      continue
    }

    if (value.startsWith("--env-file=")) {
      envFileArgs.push(value)
      continue
    }

    commandArgs.push(value)
  }

  return { envFileArgs, commandArgs }
}
