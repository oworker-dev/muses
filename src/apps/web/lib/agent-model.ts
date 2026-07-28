import { createOpenAI } from "@ai-sdk/openai"
import {
  generateText,
  jsonSchema,
  tool,
  type ModelMessage,
  type ToolSet,
} from "ai"

import type {
  AgentMessage,
  AgentModelPort,
  AgentToolDefinition,
} from "@muses/agent-core"

const DEFAULT_AGENT_MODEL = "gpt-5.6-sol"
const MODEL_TIMEOUT_MS = 2 * 60 * 1000

export class AiSdkAgentModel implements AgentModelPort {
  async complete(input: Parameters<AgentModelPort["complete"]>[0]) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey)
      throw new Error("The OpenAI Agent model provider is not configured.")
    const provider = createOpenAI({
      apiKey,
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
    })
    const modelId = providerModelId(input.run.profile.modelRef)
    const toolAliases = createToolAliases(input.tools)
    const { system, messages } = toAiSdkTranscript(
      input.messages,
      toolAliases.canonicalToAlias
    )
    const result = await generateText({
      model: provider.languageModel(modelId),
      system,
      messages,
      tools: toAiSdkTools(input.tools, toolAliases.canonicalToAlias),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    const toolCalls = result.toolCalls.map((call) => {
      if (!isRecord(call.input)) {
        throw new Error(`Agent tool "${call.toolName}" returned invalid input.`)
      }
      const canonicalName = toolAliases.aliasToCanonical.get(call.toolName)
      if (!canonicalName) {
        throw new Error(
          `Agent model requested unknown tool "${call.toolName}".`
        )
      }
      return {
        id: call.toolCallId,
        name: canonicalName,
        input: call.input,
      }
    })
    const inputTokens = result.usage.inputTokens || 0
    const outputTokens = result.usage.outputTokens || 0
    return {
      content: result.text,
      finishReason:
        toolCalls.length > 0 ? ("tool-calls" as const) : ("stop" as const),
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        creditMicros: modelCreditMicros(inputTokens, outputTokens),
      },
      plan: imageExecutionPlan(input.run, toolCalls),
    }
  }
}

export function configuredAgentModelRef() {
  const model = process.env.MUSES_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL
  return model.includes("/") ? model : `openai/${model}`
}

export function toAiSdkTranscript(
  messages: readonly AgentMessage[],
  canonicalToAlias: ReadonlyMap<string, string> = new Map()
): {
  system: string
  messages: ModelMessage[]
} {
  const system: string[] = []
  const transcript: ModelMessage[] = []
  for (const message of messages) {
    switch (message.role) {
      case "system":
        system.push(message.content)
        break
      case "user":
        transcript.push({ role: "user", content: message.content })
        break
      case "assistant": {
        const toolCalls = message.toolCalls || []
        if (toolCalls.length === 0) {
          transcript.push({ role: "assistant", content: message.content })
          break
        }
        transcript.push({
          role: "assistant",
          content: [
            ...(message.content
              ? [{ type: "text" as const, text: message.content }]
              : []),
            ...toolCalls.map((call) => ({
              type: "tool-call" as const,
              toolCallId: call.id,
              toolName:
                canonicalToAlias.get(call.name) || modelSafeToolName(call.name),
              input: call.input,
            })),
          ],
        })
        break
      }
      case "tool":
        if (!message.toolCallId || !message.toolName) {
          throw new Error(
            "Persisted Agent tool results require call id and tool name."
          )
        }
        transcript.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: message.toolCallId,
              toolName:
                canonicalToAlias.get(message.toolName) ||
                modelSafeToolName(message.toolName),
              output: { type: "text", value: message.content },
            },
          ],
        })
        break
    }
  }
  return { system: system.join("\n\n"), messages: transcript }
}

function toAiSdkTools(
  definitions: readonly AgentToolDefinition[],
  canonicalToAlias: ReadonlyMap<string, string>
): ToolSet {
  return Object.fromEntries(
    definitions.map((definition) => [
      canonicalToAlias.get(definition.name) ||
        modelSafeToolName(definition.name),
      tool({
        description: definition.description,
        inputSchema: jsonSchema(
          definition.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
      }),
    ])
  )
}

function createToolAliases(definitions: readonly AgentToolDefinition[]) {
  const canonicalToAlias = new Map<string, string>()
  const aliasToCanonical = new Map<string, string>()
  for (const definition of definitions) {
    const base = modelSafeToolName(definition.name)
    let alias = base
    let suffix = 2
    while (aliasToCanonical.has(alias)) {
      alias = `${base}_${suffix}`
      suffix += 1
    }
    canonicalToAlias.set(definition.name, alias)
    aliasToCanonical.set(alias, definition.name)
  }
  return { canonicalToAlias, aliasToCanonical }
}

function modelSafeToolName(name: string) {
  const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_")
  return normalized || "muses_tool"
}

function providerModelId(modelRef: string) {
  const slash = modelRef.indexOf("/")
  const value = slash >= 0 ? modelRef.slice(slash + 1) : modelRef
  const version = value.indexOf("@")
  return (version >= 0 ? value.slice(0, version) : value).trim()
}

function modelCreditMicros(inputTokens: number, outputTokens: number) {
  const inputRate = nonNegativeBigInt(
    process.env.MUSES_AGENT_INPUT_CREDIT_MICROS_PER_MILLION
  )
  const outputRate = nonNegativeBigInt(
    process.env.MUSES_AGENT_OUTPUT_CREDIT_MICROS_PER_MILLION
  )
  const million = BigInt(1_000_000)
  const charge =
    (BigInt(inputTokens) * inputRate + million - BigInt(1)) / million +
    (BigInt(outputTokens) * outputRate + million - BigInt(1)) / million
  return charge.toString()
}

function nonNegativeBigInt(value: string | undefined) {
  return value && /^\d+$/.test(value) ? BigInt(value) : BigInt(0)
}

function imageExecutionPlan(
  run: Parameters<AgentModelPort["complete"]>[0]["run"],
  toolCalls: readonly { id: string; name: string }[]
) {
  const latestUserRequest = [...run.context.messages]
    .reverse()
    .find(({ role }) => role === "user")?.content
  const imageCallPending = toolCalls.some(
    ({ name }) => name === "image.generate"
  )
  const completedAssets = completedImageAssetIds(run.context.messages)
  const continuing = toolCalls.length > 0
  const imageStatus = imageCallPending
    ? ("in-progress" as const)
    : completedAssets.length > 0
      ? ("completed" as const)
      : continuing
        ? ("pending" as const)
        : ("blocked" as const)
  const placeStatus =
    imageCallPending || continuing
      ? ("pending" as const)
      : completedAssets.length > 0
        ? ("completed" as const)
        : ("blocked" as const)

  return {
    goal: latestUserRequest || "Create an image on the Muses canvas.",
    steps: [
      {
        id: "understand-request",
        title: "Understand the request",
        status: "completed" as const,
        dependsOn: [],
        evidenceRefs: [],
      },
      {
        id: "generate-image",
        title: "Generate the image",
        status: imageStatus,
        dependsOn: ["understand-request"],
        evidenceRefs: completedAssets,
      },
      {
        id: "place-result",
        title: "Place the result on the canvas",
        status: placeStatus,
        dependsOn: ["generate-image"],
        evidenceRefs: completedAssets,
      },
    ],
  }
}

function completedImageAssetIds(messages: readonly AgentMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool" || message.toolName !== "image.generate") {
      continue
    }
    try {
      const output = JSON.parse(message.content) as {
        assets?: Array<{ id?: unknown }>
      }
      if (Array.isArray(output.assets)) {
        return output.assets.flatMap(({ id }) =>
          typeof id === "string" && id ? [id] : []
        )
      }
    } catch {
      return []
    }
  }
  return []
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
