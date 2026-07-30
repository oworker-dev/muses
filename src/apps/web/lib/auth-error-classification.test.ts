import { describe, expect, it } from "vitest"

import {
  classifyFormSignInFailure,
  isEmailVerificationRequiredError,
} from "./auth-error-classification"

describe("auth error classification", () => {
  it("recognizes explicit Better Auth email verification errors", () => {
    expect(
      isEmailVerificationRequiredError({ code: "EMAIL_NOT_VERIFIED" })
    ).toBe(true)
    expect(
      isEmailVerificationRequiredError({ message: "Email is not verified" })
    ).toBe(true)
  })

  it("does not treat unrelated forbidden responses as email failures", () => {
    expect(
      isEmailVerificationRequiredError({
        status: 403,
        code: "INVALID_ORIGIN",
        message: "Invalid origin",
      })
    ).toBe(false)
    expect(
      classifyFormSignInFailure(403, {
        code: "INVALID_ORIGIN",
        message: "Invalid origin",
      })
    ).toBe("auth-unavailable")
  })

  it("preserves stable status mappings for other sign-in failures", () => {
    expect(classifyFormSignInFailure(401, null)).toBe("invalid-credentials")
    expect(classifyFormSignInFailure(429, null)).toBe("too-many-attempts")
    expect(classifyFormSignInFailure(403, { code: "EMAIL_NOT_VERIFIED" })).toBe(
      "email-not-verified"
    )
  })
})
