type BrowserRandomSource = Pick<Crypto, "getRandomValues">

export function createClientId(
  prefix?: string,
  randomSource: BrowserRandomSource = globalThis.crypto
) {
  if (!randomSource?.getRandomValues) {
    throw new Error("This browser cannot generate a safe client request id.")
  }

  const bytes = randomSource.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")

  return prefix ? `${prefix}_${value}` : value
}
