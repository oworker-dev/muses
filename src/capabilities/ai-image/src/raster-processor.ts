import sharp, { type OverlayOptions } from "sharp"

import type {
  AnalyzedElement,
  BoundingBoxV1,
  RasterImage,
} from "./pipeline-contracts.js"

export const DEFAULT_CHROMA_KEY = { r: 255, g: 0, b: 255 } as const

export type PreparedSource = {
  readonly original: RasterImage
  readonly modelInput: RasterImage
}

export async function prepareSourceImage(bytes: Uint8Array): Promise<PreparedSource> {
  const normalized = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true })
  const width = normalized.info.width
  const height = normalized.info.height
  const modelWidth = roundUp(width, 16)
  const modelHeight = roundUp(height, 16)
  const modelBytes = await sharp(normalized.data)
    .extend({
      right: modelWidth - width,
      bottom: modelHeight - height,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer()

  return {
    original: { bytes: normalized.data, mimeType: "image/png", width, height },
    modelInput: {
      bytes: modelBytes,
      mimeType: "image/png",
      width: modelWidth,
      height: modelHeight,
    },
  }
}

export async function createRemovalMask(
  width: number,
  height: number,
  elements: readonly AnalyzedElement[],
): Promise<RasterImage> {
  const raw = Buffer.alloc(width * height * 4, 255)
  for (const element of elements) {
    const margin = element.kind === "text" ? 3 : 6
    const box = expandBBox(element.logicalBBox, margin, width, height)
    for (let y = box.y; y < box.y + box.height; y += 1) {
      const row = y * width * 4
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const offset = row + x * 4
        raw[offset] = 0
        raw[offset + 1] = 0
        raw[offset + 2] = 0
        raw[offset + 3] = 0
      }
    }
  }
  const bytes = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  return { bytes, mimeType: "image/png", width, height }
}

export async function createSparseElementCanvas(input: {
  source: RasterImage
  elements: readonly AnalyzedElement[]
  activeElementIds?: ReadonlySet<string>
  key?: { readonly r: number; readonly g: number; readonly b: number }
  /** Keep source text/children when creating a fidelity fallback asset. */
  maskText?: boolean
  maskDescendants?: boolean
  /** Global source region to expose to the image editor. */
  region?: BoundingBoxV1
}): Promise<{
  readonly image: RasterImage
  readonly generationBoxes: Readonly<Record<string, BoundingBoxV1>>
  readonly origin: { readonly x: number; readonly y: number }
}> {
  const key = input.key ?? DEFAULT_CHROMA_KEY
  const { source } = input
  const decoded = await sharp(source.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const sourceRaw = Buffer.from(decoded.data)
  const channels = decoded.info.channels

  if (input.maskText ?? true) {
    for (const element of input.elements) {
      if (element.kind !== "text") continue
      const box = expandBBox(element.logicalBBox, 2, source.width, source.height)
      paintBox(sourceRaw, source.width, channels, box, key)
    }
  }

  const composites: OverlayOptions[] = []
  const generationBoxes: Record<string, BoundingBoxV1> = {}
  for (const element of input.elements) {
    if (element.kind !== "raster-layer") continue
    if (input.activeElementIds && !input.activeElementIds.has(element.id)) continue
    const box = expandBBox(element.logicalBBox, 8, source.width, source.height)
    generationBoxes[element.id] = box
    const elementRaw = Buffer.from(sourceRaw)
    if (input.maskDescendants ?? true) {
      for (const child of descendantsOf(element, input.elements)) {
        paintBox(
          elementRaw,
          source.width,
          channels,
          expandBBox(child.logicalBBox, 3, source.width, source.height),
          key,
        )
      }
    }
    const crop = await sharp(elementRaw, {
      raw: { width: source.width, height: source.height, channels },
    })
    .extract(regionOf(box))
      .png()
      .toBuffer()
    composites.push({ input: crop, left: box.x, top: box.y })
  }

  const fullCanvas = await sharp({
    create: {
      width: source.width,
      height: source.height,
      channels: 4,
      background: { ...key, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  const regionBox = input.region
    ? expandBBox(input.region, 0, source.width, source.height)
    : { x: 0, y: 0, width: source.width, height: source.height }
  const bytes =
    regionBox.x === 0 &&
    regionBox.y === 0 &&
    regionBox.width === source.width &&
    regionBox.height === source.height
      ? fullCanvas
      : await sharp(fullCanvas).extract(regionOf(regionBox)).png().toBuffer()

  return {
    image: {
      bytes,
      mimeType: "image/png",
      width: regionBox.width,
      height: regionBox.height,
    },
    generationBoxes,
    origin: { x: regionBox.x, y: regionBox.y },
  }
}

/**
 * Builds an Edit-only repair image. The provider receives the original layout
 * with explicit chroma-colored repair slots instead of a multipart mask.
 */
export async function createEditRepairCanvas(input: {
  source: RasterImage
  elements: readonly AnalyzedElement[]
  excludedElementIds?: ReadonlySet<string>
  key?: { readonly r: number; readonly g: number; readonly b: number }
}): Promise<RasterImage> {
  const key = input.key ?? DEFAULT_CHROMA_KEY
  const decoded = await sharp(input.source.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const raw = Buffer.from(decoded.data)
  for (const element of input.elements) {
    if (input.excludedElementIds?.has(element.id)) continue
    paintBox(
      raw,
      input.source.width,
      decoded.info.channels,
      expandBBox(element.logicalBBox, element.kind === "text" ? 3 : 6, input.source.width, input.source.height),
      key,
    )
  }
  const bytes = await sharp(raw, {
    raw: {
      width: input.source.width,
      height: input.source.height,
      channels: decoded.info.channels,
    },
  })
    .png()
    .toBuffer()
  return {
    bytes,
    mimeType: "image/png",
    width: input.source.width,
    height: input.source.height,
  }
}

export async function removeAlphaRegions(
  image: RasterImage,
  boxes: readonly BoundingBoxV1[],
): Promise<RasterImage> {
  if (boxes.length === 0) return image
  const decoded = await sharp(image.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const raw = Buffer.from(decoded.data)
  for (const candidate of boxes) {
    const box = clampBBox(candidate, image.width, image.height)
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        raw[(y * image.width + x) * decoded.info.channels + 3] = 0
      }
    }
  }
  const bytes = await sharp(raw, {
    raw: {
      width: image.width,
      height: image.height,
      channels: decoded.info.channels,
    },
  })
    .png()
    .toBuffer()
  return { bytes, mimeType: "image/png", width: image.width, height: image.height }
}

export async function removeTextPixels(
  image: RasterImage,
  elements: readonly AnalyzedElement[],
  tolerance = 96,
): Promise<RasterImage> {
  const textElements = elements.filter((element) => element.kind === "text")
  if (textElements.length === 0) return image
  const decoded = await sharp(image.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const raw = Buffer.from(decoded.data)
  const toleranceSquared = tolerance * tolerance
  for (const element of textElements) {
    const target = parseHexColor(element.fill)
    const box = expandBBox(element.logicalBBox, 2, image.width, image.height)
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const offset = (y * image.width + x) * decoded.info.channels
        if ((raw[offset + 3] ?? 255) === 0) continue
        if (pixelDistanceSquared(raw, offset, target) <= toleranceSquared) {
          raw[offset + 3] = 0
        }
      }
    }
  }
  const bytes = await sharp(raw, {
    raw: {
      width: image.width,
      height: image.height,
      channels: decoded.info.channels,
    },
  })
    .png()
    .toBuffer()
  return { bytes, mimeType: "image/png", width: image.width, height: image.height }
}

export async function chromaKeyToAlpha(input: {
  image: RasterImage
  expectedKey?: { readonly r: number; readonly g: number; readonly b: number }
  threshold?: number
}): Promise<{
  readonly image: RasterImage
  readonly detectedKey: { readonly r: number; readonly g: number; readonly b: number }
  readonly transparentCoverage: number
}> {
  const decoded = await sharp(input.image.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const width = decoded.info.width
  const height = decoded.info.height
  const channels = decoded.info.channels
  const raw = Buffer.from(decoded.data)
  const borderKey = medianBorderColor(raw, width, height, channels)
  const expected = input.expectedKey ?? DEFAULT_CHROMA_KEY
  const detectedKey =
    colorDistance(borderKey, expected) < 120 ? borderKey : expected
  const threshold = input.threshold ?? 110
  const thresholdSquared = threshold * threshold
  const background = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const enqueue = (pixel: number) => {
    if (background[pixel]) return
    const offset = pixel * channels
    if (pixelDistanceSquared(raw, offset, detectedKey) > thresholdSquared) return
    background[pixel] = 1
    queue[tail++] = pixel
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }

  while (head < tail) {
    const pixel = queue[head++]!
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - width)
    if (y + 1 < height) enqueue(pixel + width)
  }

  for (let pixel = 0; pixel < background.length; pixel += 1) {
    const offset = pixel * channels
    // The key color is reserved for the synthetic canvas. Treat enclosed
    // key-colored holes as transparent too; border flood-fill alone would
    // incorrectly preserve the magenta center of rings and charts.
    if (pixelDistanceSquared(raw, offset, detectedKey) <= thresholdSquared) {
      raw[offset + 3] = 0
      background[pixel] = 1
      continue
    }
    if (background[pixel]) {
      raw[offset + 3] = 0
      continue
    }
    if (touchesBackground(background, pixel, width, height)) {
      const distance = Math.sqrt(pixelDistanceSquared(raw, offset, detectedKey))
      if (distance < threshold + 48) {
        raw[offset + 3] = Math.min(
          raw[offset + 3] ?? 255,
          Math.round(Math.min(1, Math.max(0, (distance - threshold) / 48)) * 255),
        )
      }
    }
    const alpha = (raw[offset + 3] ?? 255) / 255
    if (alpha > 0 && alpha < 1) {
      raw[offset] = despillChannel(raw[offset] ?? 0, detectedKey.r, alpha)
      raw[offset + 1] = despillChannel(
        raw[offset + 1] ?? 0,
        detectedKey.g,
        alpha,
      )
      raw[offset + 2] = despillChannel(
        raw[offset + 2] ?? 0,
        detectedKey.b,
        alpha,
      )
    }
  }

  let transparentPixels = 0
  for (let pixel = 0; pixel < background.length; pixel += 1) {
    if ((raw[pixel * channels + 3] ?? 255) === 0) transparentPixels += 1
  }
  const bytes = await sharp(raw, { raw: { width, height, channels } })
    .png()
    .toBuffer()
  return {
    image: { bytes, mimeType: "image/png", width, height },
    detectedKey,
    transparentCoverage: transparentPixels / (width * height),
  }
}

function despillChannel(observed: number, key: number, alpha: number) {
  return Math.round(Math.min(255, Math.max(0, (observed - (1 - alpha) * key) / alpha)))
}

function parseHexColor(value: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!match) return { r: 0, g: 0, b: 0 }
  return {
    r: Number.parseInt(match[1]!, 16),
    g: Number.parseInt(match[2]!, 16),
    b: Number.parseInt(match[3]!, 16),
  }
}


export async function detectAlphaBBox(
  image: RasterImage,
  search: BoundingBoxV1,
  threshold = 12,
): Promise<BoundingBoxV1 | null> {
  const decoded = await sharp(image.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const width = decoded.info.width
  const height = decoded.info.height
  const channels = decoded.info.channels
  const box = clampBBox(search, width, height)
  let minX = box.x + box.width
  let minY = box.y + box.height
  let maxX = -1
  let maxY = -1
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const alpha = decoded.data[(y * width + x) * channels + 3] ?? 255
      if (alpha <= threshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < minX
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export async function cropImage(
  image: RasterImage,
  box: BoundingBoxV1,
): Promise<RasterImage> {
  const bounded = clampBBox(box, image.width, image.height)
  const bytes = await sharp(image.bytes).extract(regionOf(bounded)).png().toBuffer()
  return {
    bytes,
    mimeType: "image/png",
    width: bounded.width,
    height: bounded.height,
  }
}

export async function normalizeModelOutput(
  image: RasterImage,
  width: number,
  height: number,
  options: {
    readonly preserveAspectRatio?: boolean
    readonly background?: { readonly r: number; readonly g: number; readonly b: number }
  } = {},
): Promise<RasterImage> {
  if (image.width === width && image.height === height) return image
  const preserveAspectRatio = options.preserveAspectRatio ?? false
  const bytes = await sharp(image.bytes)
    .resize(width, height, {
      fit: preserveAspectRatio ? "contain" : "fill",
      ...(preserveAspectRatio
        ? { background: { ...(options.background ?? DEFAULT_CHROMA_KEY), alpha: 1 } }
        : {}),
    })
    .png()
    .toBuffer()
  return { bytes, mimeType: "image/png", width, height }
}

export function expandBBox(
  box: BoundingBoxV1,
  margin: number,
  width: number,
  height: number,
) {
  const x = Math.max(0, Math.floor(box.x - margin))
  const y = Math.max(0, Math.floor(box.y - margin))
  const right = Math.min(width, Math.ceil(box.x + box.width + margin))
  const bottom = Math.min(height, Math.ceil(box.y + box.height + margin))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

function clampBBox(box: BoundingBoxV1, width: number, height: number) {
  const x = Math.min(width - 1, Math.max(0, Math.floor(box.x)))
  const y = Math.min(height - 1, Math.max(0, Math.floor(box.y)))
  const right = Math.min(width, Math.max(x + 1, Math.ceil(box.x + box.width)))
  const bottom = Math.min(height, Math.max(y + 1, Math.ceil(box.y + box.height)))
  return { x, y, width: right - x, height: bottom - y }
}

function regionOf(box: BoundingBoxV1) {
  return { left: box.x, top: box.y, width: box.width, height: box.height }
}

function paintBox(
  raw: Buffer,
  width: number,
  channels: number,
  box: BoundingBoxV1,
  color: { readonly r: number; readonly g: number; readonly b: number },
) {
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const offset = (y * width + x) * channels
      raw[offset] = color.r
      raw[offset + 1] = color.g
      raw[offset + 2] = color.b
      if (channels === 4) raw[offset + 3] = 255
    }
  }
}

function descendantsOf(
  parent: AnalyzedElement,
  elements: readonly AnalyzedElement[],
) {
  const descendants: AnalyzedElement[] = []
  const visited = new Set<string>()
  const queue = elements.filter((element) => element.parentId === parent.id)
  while (queue.length > 0) {
    const child = queue.shift()!
    if (visited.has(child.id)) continue
    visited.add(child.id)
    descendants.push(child)
    queue.push(...elements.filter((element) => element.parentId === child.id))
  }
  return descendants
}

function medianBorderColor(raw: Buffer, width: number, height: number, channels: number) {
  const red: number[] = []
  const green: number[] = []
  const blue: number[] = []
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * channels
    red.push(raw[offset] ?? 0)
    green.push(raw[offset + 1] ?? 0)
    blue.push(raw[offset + 2] ?? 0)
  }
  const step = Math.max(1, Math.floor(Math.min(width, height) / 128))
  for (let x = 0; x < width; x += step) {
    add(x, 0)
    add(x, height - 1)
  }
  for (let y = step; y < height - 1; y += step) {
    add(0, y)
    add(width - 1, y)
  }
  return { r: median(red), g: median(green), b: median(blue) }
}

function median(values: number[]) {
  values.sort((left, right) => left - right)
  return values[Math.floor(values.length / 2)] ?? 0
}

function pixelDistanceSquared(
  raw: Buffer,
  offset: number,
  key: { readonly r: number; readonly g: number; readonly b: number },
) {
  const red = (raw[offset] ?? 0) - key.r
  const green = (raw[offset + 1] ?? 0) - key.g
  const blue = (raw[offset + 2] ?? 0) - key.b
  return red * red + green * green + blue * blue
}

function colorDistance(
  left: { readonly r: number; readonly g: number; readonly b: number },
  right: { readonly r: number; readonly g: number; readonly b: number },
) {
  return Math.sqrt(
    (left.r - right.r) ** 2 +
      (left.g - right.g) ** 2 +
      (left.b - right.b) ** 2,
  )
}

function touchesBackground(
  background: Uint8Array,
  pixel: number,
  width: number,
  height: number,
) {
  const x = pixel % width
  const y = Math.floor(pixel / width)
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue
      const nextX = x + offsetX
      const nextY = y + offsetY
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
      if (background[nextY * width + nextX]) return true
    }
  }
  return false
}

function roundUp(value: number, multiple: number) {
  return Math.ceil(value / multiple) * multiple
}
