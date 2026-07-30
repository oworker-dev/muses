export type FormSignInErrorCode =
  | "invalid-credentials"
  | "email-not-verified"
  | "too-many-attempts"
  | "auth-unavailable"

export function isEmailVerificationRequiredError(error: unknown) {
  const payload = error as { code?: unknown; message?: unknown }
  const code = normalized(payload?.code)
  const message = normalized(payload?.message)

  return (
    code === "email_not_verified" ||
    code === "email-not-verified" ||
    message.includes("email not verified") ||
    message.includes("email is not verified")
  )
}

export function classifyFormSignInFailure(
  status: number,
  error: unknown
): FormSignInErrorCode {
  if (status === 401) return "invalid-credentials"
  if (status === 429) return "too-many-attempts"
  if (isEmailVerificationRequiredError(error)) return "email-not-verified"
  return "auth-unavailable"
}

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}
