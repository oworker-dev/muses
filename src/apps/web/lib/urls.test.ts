import { describe, expect, it } from "vitest"

import { normalizeInternalPath } from "./urls"

describe("normalizeInternalPath", () => {
  it("preserves same-origin application paths", () => {
    expect(normalizeInternalPath("/studio?mode=professional#canvas")).toBe(
      "/studio?mode=professional#canvas"
    )
  })

  it.each([
    "https://example.com/studio",
    "//example.com/studio",
    "/\\example.com/studio",
    "/studio\nlocation:https://example.com",
  ])("rejects external or ambiguous callback %s", (callbackURL) => {
    expect(normalizeInternalPath(callbackURL, "/studio")).toBe("/studio")
  })
})
