import { describe, expect, it } from "vitest"

import { createClientId } from "./client-id"

describe("createClientId", () => {
  it("works with the insecure-context Web Crypto surface", () => {
    const insecureContextCrypto = {
      getRandomValues<T extends ArrayBufferView | null>(array: T) {
        if (array instanceof Uint8Array) {
          array.forEach((_, index) => {
            array[index] = index
          })
        }
        return array
      },
    }

    expect(createClientId("command", insecureContextCrypto)).toBe(
      "command_000102030405460788090a0b0c0d0e0f"
    )
    expect(insecureContextCrypto).not.toHaveProperty("randomUUID")
  })

  it("creates compact unique ids with the browser crypto source", () => {
    const first = createClientId()
    const second = createClientId()

    expect(first).toMatch(/^[a-f0-9]{32}$/)
    expect(second).toMatch(/^[a-f0-9]{32}$/)
    expect(second).not.toBe(first)
  })
})
