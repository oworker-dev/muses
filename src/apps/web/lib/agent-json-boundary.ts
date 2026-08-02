import type { JsonValue } from "@muses/agent-contracts/agent-run"
import { FatalError } from "workflow"

const AGENT_JSON_MAX_DEPTH = 32
const AGENT_JSON_MAX_VALUES = 10_000
const AGENT_JSON_MAX_STRING_CHARACTERS = 1_000_000

export function requireAgentJsonObject(
  value: Readonly<Record<string, unknown>>
): Readonly<Record<string, JsonValue>> {
  const normalized = normalizeAgentJsonValue(
    value,
    0,
    { stringCharacters: 0, values: 0 },
    new Set()
  )
  if (!isAgentJsonObject(normalized)) {
    throw new FatalError("Agent output schema must be a JSON object.")
  }
  return normalized
}

function isAgentJsonObject(
  value: JsonValue
): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeAgentJsonValue(
  value: unknown,
  depth: number,
  budget: { stringCharacters: number; values: number },
  ancestors: Set<object>
): JsonValue {
  budget.values += 1
  if (budget.values > AGENT_JSON_MAX_VALUES) {
    throw new FatalError("Agent output schema exceeds the JSON value limit.")
  }
  if (depth > AGENT_JSON_MAX_DEPTH) {
    throw new FatalError("Agent output schema exceeds the JSON depth limit.")
  }
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FatalError("Agent output schema contains a non-finite number.")
    }
    return value
  }
  if (typeof value === "string") {
    addAgentJsonStringCharacters(value, budget)
    return value
  }
  if (typeof value !== "object") {
    throw new FatalError("Agent output schema contains a non-JSON value.")
  }
  if (ancestors.has(value)) {
    throw new FatalError("Agent output schema contains a circular reference.")
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry) =>
        normalizeAgentJsonValue(entry, depth + 1, budget, ancestors)
      )
    }

    const prototype = Object.getPrototypeOf(value)
    const entries = Object.entries(value)
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(value).length !== entries.length
    ) {
      throw new FatalError(
        "Agent output schema must contain only plain JSON objects."
      )
    }

    const normalized: Record<string, JsonValue> = {}
    for (const [key, entry] of entries) {
      if (key === "__proto__") {
        throw new FatalError("Agent output schema contains an unsafe object key.")
      }
      addAgentJsonStringCharacters(key, budget)
      normalized[key] = normalizeAgentJsonValue(
        entry,
        depth + 1,
        budget,
        ancestors
      )
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

function addAgentJsonStringCharacters(
  value: string,
  budget: { stringCharacters: number }
) {
  budget.stringCharacters += value.length
  if (budget.stringCharacters > AGENT_JSON_MAX_STRING_CHARACTERS) {
    throw new FatalError("Agent output schema exceeds the JSON string limit.")
  }
}
