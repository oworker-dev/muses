export function getAppUrl() {
  return process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"
}

export function normalizeInternalPath(value?: string | null, fallback = "/") {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback
  }

  try {
    const internalOrigin = "http://muses.internal"
    const url = new URL(value, internalOrigin)
    return url.origin === internalOrigin
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback
  } catch {
    return fallback
  }
}
