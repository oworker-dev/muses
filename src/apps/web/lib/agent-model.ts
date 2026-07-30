import { createOpenAI } from "@ai-sdk/openai"
import {
  APICallError,
  generateText,
  jsonSchema,
  tool,
  type ModelMessage,
  type ToolSet,
} from "ai"

import {
  AgentModelError,
  type AgentModelResult,
  type AgentMessage,
  type AgentModelPort,
  type AgentToolDefinition,
} from "@muses/agent-core"

import {
  fingerprintAgentModelCall,
  PostgresAgentModelCallStore,
  type AgentModelCallStore,
} from "./agent-model-call-store"
import { resolveProviderRuntimeConnection } from "./provider-connections"

const DEFAULT_AGENT_MODEL = "gpt-5.6-sol"
const MODEL_TIMEOUT_MS = 2 * 60 * 1000

export class AiSdkAgentModel implements AgentModelPort {
  constructor(
    private readonly calls: AgentModelCallStore = new PostgresAgentModelCallStore(),
    private readonly generate: typeof generateText = generateText
  ) {}

  estimate(input: Parameters<AgentModelPort["estimate"]>[0]) {
    const inputTokens = estimateInputTokens(input.messages, input.tools)
    const outputTokens = remainingOutputTokens(input.run)
    return {
      inputTokens,
      outputTokens,
      creditMicros: modelCreditMicros(inputTokens, outputTokens),
    }
  }

  async complete(input: Parameters<AgentModelPort["complete"]>[0]) {
    const requestFingerprint = fingerprintAgentModelCall({
      schemaVersion: "agent-model-request-v1",
      modelRef: input.run.profile.modelRef,
      messages: input.messages,
      tools: input.tools,
      estimate: input.estimate,
    })
    const claim = await this.calls.claim({
      callId: input.callId,
      run: input.run,
      requestFingerprint,
      estimate: input.estimate,
    })
    switch (claim.state) {
      case "replayed":
        return claim.result
      case "in-progress":
        throw retryDriverError(
          "model-call-in-progress",
          "The Agent model call is still owned by another attempt."
        )
      case "ambiguous":
        throw reviewRequiredError()
      case "failed":
        throw new AgentModelError(
          claim.failureCode || "model-provider-rejected",
          "The Agent model provider rejected this turn.",
          false
        )
      case "idempotency-conflict":
        throw new AgentModelError(
          "model-call-idempotency-conflict",
          "The Agent model call no longer matches its persisted receipt.",
          false
        )
      case "insufficient-credits":
        throw new AgentModelError(
          "insufficient-credits",
          "The Workspace does not have enough credits for this Agent turn.",
          false
        )
    }

    const modelId = providerModelId(input.run.profile.modelRef)
    let storedProvider
    try {
      storedProvider = await resolveProviderRuntimeConnection({
        capabilityFamily: "llm",
        providerSlug: providerSlug(input.run.profile.modelRef),
        providerModelId: modelId,
      })
    } catch {
      await this.calls.failDefinitive({
        callId: input.callId,
        attemptId: claim.attemptId,
        failureCode: "model-provider-connection-invalid",
      })
      throw new AgentModelError(
        "model-provider-not-configured",
        "The Agent model provider connection is unavailable.",
        false
      )
    }
    const apiKey = storedProvider?.apiKey || process.env.OPENAI_API_KEY
    const baseURL = storedProvider?.baseURL || process.env.OPENAI_BASE_URL
    if (!apiKey) {
      await this.calls.failDefinitive({
        callId: input.callId,
        attemptId: claim.attemptId,
        failureCode: "model-provider-not-configured",
      })
      throw new AgentModelError(
        "model-provider-not-configured",
        "The Agent model provider is not configured.",
        false
      )
    }

    const provider = createOpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    })
    const toolAliases = createToolAliases(input.tools)
    const { system, messages } = toAiSdkTranscript(
      input.messages,
      toolAliases.canonicalToAlias
    )
    try {
      await this.calls.begin(input.callId, claim.attemptId)
    } catch {
      throw retryDriverError(
        "model-call-start-deferred",
        "The Agent model call is waiting for durable receipt ownership."
      )
    }

    let providerResult: Awaited<ReturnType<typeof generateText>>
    try {
      providerResult = await this.generate({
        model: provider.languageModel(modelId),
        system,
        messages,
        tools: toAiSdkTools(input.tools, toolAliases.canonicalToAlias),
        runtimeContext: {
          agentRunId: input.run.runId,
          workspaceId: input.run.session.workspaceId,
          projectId: input.run.session.projectId,
          modelCallId: input.callId,
          turn: input.run.turn + 1,
          contextVersion: input.run.context.version,
        },
        telemetry: {
          isEnabled: true,
          functionId: "muses-agent-model",
          recordInputs: false,
          recordOutputs: false,
          includeRuntimeContext: {
            agentRunId: true,
            workspaceId: true,
            projectId: true,
            modelCallId: true,
            turn: true,
            contextVersion: true,
          },
        },
        maxOutputTokens: input.estimate.outputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      })
    } catch (error) {
      const providerRequestId = providerRequestIdFromError(error)
      if (isDefinitiveProviderRejection(error)) {
        try {
          await this.calls.failDefinitive({
            callId: input.callId,
            attemptId: claim.attemptId,
            failureCode: providerFailureCode(error),
            providerRequestId,
          })
        } catch {
          throw retryDriverError(
            "model-receipt-commit-unknown",
            "The Agent model rejection is waiting for durable receipt recovery."
          )
        }
        throw new AgentModelError(
          "model-provider-rejected",
          "The Agent model provider rejected this turn.",
          false
        )
      }
      try {
        await this.calls.markAmbiguous({
          callId: input.callId,
          attemptId: claim.attemptId,
          failureCode: "provider-outcome-unknown",
          providerRequestId,
        })
      } catch {
        throw retryDriverError(
          "model-receipt-commit-unknown",
          "The Agent model outcome is waiting for durable receipt recovery."
        )
      }
      throw reviewRequiredError()
    }

    const providerRequestId = providerResult.response.id
    let modelResult: AgentModelResult
    try {
      const toolCalls = providerResult.toolCalls.map((call) => {
        if (!isRecord(call.input)) {
          throw new Error(
            `Agent tool "${call.toolName}" returned invalid input.`
          )
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
      const inputTokens = providerResult.usage.inputTokens || 0
      const outputTokens = providerResult.usage.outputTokens || 0
      modelResult = {
        content: providerResult.text,
        finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
        toolCalls,
        usage: {
          inputTokens,
          outputTokens,
          creditMicros: modelCreditMicros(inputTokens, outputTokens),
        },
        plan: imageExecutionPlan(input.run, toolCalls),
      }
    } catch {
      try {
        await this.calls.markAmbiguous({
          callId: input.callId,
          attemptId: claim.attemptId,
          failureCode: "provider-result-invalid",
          providerRequestId,
        })
      } catch {
        throw retryDriverError(
          "model-receipt-commit-unknown",
          "The invalid Agent model result is waiting for durable receipt recovery."
        )
      }
      throw reviewRequiredError()
    }

    let completion
    try {
      completion = await this.calls.complete({
        callId: input.callId,
        attemptId: claim.attemptId,
        result: modelResult,
        providerRequestId,
      })
    } catch {
      throw retryDriverError(
        "model-receipt-commit-unknown",
        "The Agent model result is waiting for durable receipt recovery."
      )
    }
    if (completion.state === "review-required") {
      throw reviewRequiredError()
    }
    return modelResult
  }
}

function retryDriverError(code: string, message: string) {
  return new AgentModelError(code, message, true, "retry-driver")
}

function reviewRequiredError() {
  return new AgentModelError(
    "model-call-review-required",
    "This Agent model call needs billing review before it can continue.",
    false
  )
}

function isDefinitiveProviderRejection(error: unknown) {
  if (!APICallError.isInstance(error)) return false
  const status = error.statusCode
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408
  )
}

function providerFailureCode(error: unknown) {
  return APICallError.isInstance(error) && error.statusCode
    ? `provider-http-${error.statusCode}`
    : "provider-rejected"
}

function providerRequestIdFromError(error: unknown) {
  if (!APICallError.isInstance(error)) return undefined
  const headers = error.responseHeaders
  return (
    headers?.["x-request-id"] ||
    headers?.["request-id"] ||
    headers?.["openai-request-id"]
  )
}

function estimateInputTokens(
  messages: readonly AgentMessage[],
  tools: readonly AgentToolDefinition[]
) {
  const serialized = JSON.stringify({ messages, tools })
  const bytes = new TextEncoder().encode(serialized).byteLength
  const structuralOverhead = 512 + messages.length * 128 + tools.length * 128
  return Math.max(1, bytes + structuralOverhead)
}

function remainingOutputTokens(
  run: Parameters<AgentModelPort["complete"]>[0]["run"]
) {
  return Math.max(
    1,
    Math.min(
      16_384,
      run.budget.limit.maxOutputTokens - run.budget.usage.outputTokens
    )
  )
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

function providerSlug(modelRef: string) {
  const slash = modelRef.indexOf("/")
  return (slash >= 0 ? modelRef.slice(0, slash) : "openai").trim() || "openai"
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
