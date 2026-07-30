import { APICallError } from "ai"

export type OpenAiImageProviderConfig = {
  readonly apiKey: string
  readonly baseURL?: string
}

type OpenAiImageProviderEnv = Readonly<Record<string, string | undefined>>

const DEFINITIVE_PROVIDER_CODES = new Set([
  "invalid_model",
  "model_not_found",
  "model_not_supported",
  "unsupported_model",
])

export function resolveOpenAiImageProviderConfig(
  env: OpenAiImageProviderEnv = process.env
): OpenAiImageProviderConfig | null {
  const imageApiKey = nonEmpty(env.OPENAI_IMAGE_API_KEY)
  const imageBaseURL = nonEmpty(env.OPENAI_IMAGE_BASE_URL)

  if (imageBaseURL && !imageApiKey) {
    throw new Error(
      "OPENAI_IMAGE_BASE_URL requires OPENAI_IMAGE_API_KEY so credentials are not forwarded across providers."
    )
  }
  if (imageApiKey) {
    return {
      apiKey: imageApiKey,
      ...(imageBaseURL ? { baseURL: imageBaseURL } : {}),
    }
  }

  const sharedApiKey = nonEmpty(env.OPENAI_API_KEY)
  if (!sharedApiKey) return null
  const sharedBaseURL = nonEmpty(env.OPENAI_BASE_URL)
  return {
    apiKey: sharedApiKey,
    ...(sharedBaseURL ? { baseURL: sharedBaseURL } : {}),
  }
}

export function isDefinitiveImageProviderRejection(error: unknown) {
  if (!APICallError.isInstance(error)) return false
  const status = error.statusCode
  if (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 429
  ) {
    return true
  }
  const providerCode = normalizedProviderCode(error.data)
  return providerCode ? DEFINITIVE_PROVIDER_CODES.has(providerCode) : false
}

function normalizedProviderCode(data: unknown) {
  if (!isRecord(data)) return undefined
  const error = isRecord(data.error) ? data.error : data
  const code = error.code
  if (typeof code !== "string" && typeof code !== "number") return undefined
  const normalized = String(code).trim().toLowerCase()
  return /^[a-z0-9_-]{1,80}$/.test(normalized) ? normalized : undefined
}

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim()
  return normalized || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
