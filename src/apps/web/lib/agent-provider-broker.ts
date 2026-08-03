import { createHash, timingSafeEqual } from "node:crypto"

import type { ProviderRuntimeConnection } from "./provider-connections"

export const AGENT_PROVIDER_BROKER_MAX_BODY_BYTES = 2 * 1024 * 1024
export const AGENT_PROVIDER_BROKER_DEFAULT_TIMEOUT_MS = 120_000

type BrokerEnvironment = Readonly<Record<string, string | undefined>>

type BrokerDependencies = {
  resolveConnection(input: {
    capabilityFamily: "llm"
    providerModelId: string
  }): Promise<ProviderRuntimeConnection | null>
  fetch?: typeof globalThis.fetch
}

class BrokerRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "BrokerRequestError"
  }
}

export async function handleAgentProviderResponsesRequest(
  request: Request,
  dependencies: BrokerDependencies,
  environment: BrokerEnvironment = process.env
): Promise<Response> {
  try {
    authenticateBrokerRequest(request, environment)
    requireJsonContentType(request)
    const bodyText = await readBoundedBody(request)
    const body = parseResponsesBody(bodyText)
    const connection = await dependencies.resolveConnection({
      capabilityFamily: "llm",
      providerModelId: body.model,
    })
    if (!connection) {
      throw new BrokerRequestError(
        "provider-connection-unavailable",
        "No active LLM Provider Connection accepts the requested model.",
        503
      )
    }

    const providerUrl = responsesUrl(connection)
    const timeoutSignal = AbortSignal.timeout(readProviderTimeout(environment))
    const signal = AbortSignal.any([request.signal, timeoutSignal])
    let upstream: Response
    try {
      upstream = await (dependencies.fetch || globalThis.fetch)(providerUrl, {
        method: "POST",
        headers: providerRequestHeaders(request.headers, connection.apiKey),
        body: bodyText,
        cache: "no-store",
        redirect: "manual",
        signal,
      })
    } catch (error) {
      if (timeoutSignal.aborted && !request.signal.aborted) {
        throw new BrokerRequestError(
          "provider-timeout",
          "The model Provider did not respond before the request deadline.",
          504
        )
      }
      if (request.signal.aborted) {
        throw new BrokerRequestError(
          "request-cancelled",
          "The Agent cancelled the Provider request.",
          499
        )
      }
      throw new BrokerRequestError(
        "provider-unreachable",
        "The model Provider could not be reached.",
        502
      )
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: providerResponseHeaders(upstream.headers),
    })
  } catch (error) {
    if (error instanceof BrokerRequestError) {
      return brokerErrorResponse(error)
    }
    return brokerErrorResponse(
      new BrokerRequestError(
        "provider-broker-unavailable",
        "The model Provider broker is temporarily unavailable.",
        503
      )
    )
  }
}

function authenticateBrokerRequest(
  request: Request,
  environment: BrokerEnvironment
) {
  const secret = environment.MUSES_AGENT_PROVIDER_BROKER_SECRET?.trim()
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new BrokerRequestError(
      "provider-broker-not-configured",
      "The model Provider broker is not configured.",
      503
    )
  }
  const authorization = request.headers.get("authorization")
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : ""
  if (!supplied || !constantTimeEqual(supplied, secret)) {
    throw new BrokerRequestError(
      "provider-broker-unauthorized",
      "The model Provider broker rejected the request credentials.",
      401
    )
  }
}

function requireJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type") || ""
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new BrokerRequestError(
      "unsupported-content-type",
      "The model Provider broker accepts application/json requests only.",
      415
    )
  }
}

async function readBoundedBody(request: Request) {
  const declaredLength = request.headers.get("content-length")
  if (declaredLength) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new BrokerRequestError(
        "invalid-content-length",
        "The request Content-Length is invalid.",
        400
      )
    }
    if (length > AGENT_PROVIDER_BROKER_MAX_BODY_BYTES) {
      throw requestTooLarge()
    }
  }

  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > AGENT_PROVIDER_BROKER_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw requestTooLarge()
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    throw new BrokerRequestError(
      "invalid-json",
      "The request body must be valid UTF-8 JSON.",
      400
    )
  }
}

function requestTooLarge() {
  return new BrokerRequestError(
    "request-too-large",
    `The request body exceeds ${AGENT_PROVIDER_BROKER_MAX_BODY_BYTES} bytes.`,
    413
  )
}

function parseResponsesBody(bodyText: string) {
  let value: unknown
  try {
    value = JSON.parse(bodyText)
  } catch {
    throw new BrokerRequestError(
      "invalid-json",
      "The request body must be valid JSON.",
      400
    )
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidModel()
  }
  const model = (value as Record<string, unknown>).model
  if (
    typeof model !== "string" ||
    model !== model.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model)
  ) {
    throw invalidModel()
  }
  return { model }
}

function invalidModel() {
  return new BrokerRequestError(
    "invalid-model",
    "The request must contain a valid Provider model id.",
    400
  )
}

function responsesUrl(connection: ProviderRuntimeConnection) {
  const baseUrl =
    connection.baseURL ||
    (connection.providerSlug === "openai"
      ? "https://api.openai.com/v1/"
      : undefined)
  if (!baseUrl) {
    throw new BrokerRequestError(
      "provider-base-url-unavailable",
      "The selected Provider Connection has no Responses-compatible base URL.",
      503
    )
  }
  const normalized = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
  if (normalized.protocol !== "https:" && normalized.protocol !== "http:") {
    throw new BrokerRequestError(
      "provider-base-url-invalid",
      "The selected Provider Connection has an invalid base URL.",
      503
    )
  }
  return new URL("responses", normalized)
}

function providerRequestHeaders(incoming: Headers, apiKey: string) {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "user-agent": "muses-agent-provider-broker/1",
  })
  copyBoundedHeader(incoming, headers, "traceparent", 512)
  copyBoundedHeader(incoming, headers, "tracestate", 1024)
  return headers
}

function copyBoundedHeader(
  source: Headers,
  target: Headers,
  name: string,
  maxLength: number
) {
  const value = source.get(name)
  if (value && value.length <= maxLength && !/[\r\n]/.test(value)) {
    target.set(name, value)
  }
}

function providerResponseHeaders(upstream: Headers) {
  const result = new Headers()
  for (const name of [
    "cache-control",
    "content-type",
    "openai-processing-ms",
    "openai-request-id",
    "retry-after",
    "x-request-id",
  ]) {
    copyBoundedHeader(upstream, result, name, 2048)
  }
  for (const [name, value] of upstream.entries()) {
    if (name.toLowerCase().startsWith("x-ratelimit-") && value.length <= 2048) {
      result.set(name, value)
    }
  }
  return result
}

function readProviderTimeout(environment: BrokerEnvironment) {
  const raw = environment.MUSES_AGENT_PROVIDER_TIMEOUT_MS?.trim()
  if (!raw) return AGENT_PROVIDER_BROKER_DEFAULT_TIMEOUT_MS
  const timeout = Number(raw)
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 300_000) {
    throw new BrokerRequestError(
      "provider-broker-not-configured",
      "MUSES_AGENT_PROVIDER_TIMEOUT_MS must be an integer from 1000 to 300000.",
      503
    )
  }
  return timeout
}

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest()
  const rightDigest = createHash("sha256").update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

function brokerErrorResponse(error: BrokerRequestError) {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        type: "muses_agent_provider_broker_error",
      },
    },
    {
      status: error.status,
      headers:
        error.status === 401
          ? { "www-authenticate": 'Bearer realm="muses-agent-provider"' }
          : undefined,
    }
  )
}
