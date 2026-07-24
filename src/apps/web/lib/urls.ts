export function getAppUrl() {
  return process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"
}

export function normalizeInternalPath(value?: string | null, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback
  }

  return value
}
