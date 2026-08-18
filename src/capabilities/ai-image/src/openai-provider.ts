import sharp from "sharp"

import type {
  AnalyzedElement,
  ImageEditPort,
  ImageEditRequest,
  ImageEditResult,
  ImageStructureAnalysis,
  ProviderCallReceipt,
  RasterImage,
  VisionAnalyzerPort,
  VisionAnalysisRequest,
  VisionAnalysisResult,
} from "./pipeline-contracts.js"

export type OpenAiConnection = {
  readonly apiKey: string
  readonly baseUrl?: string
}

export type OpenAiImageToEditableConfig = {
  readonly vision: OpenAiConnection & {
    readonly model: string
    readonly reasoningEffort: "low" | "medium" | "high"
    readonly maxOutputTokens: number
  }
  readonly image: OpenAiConnection & { readonly model: string }
}

type Fetch = typeof globalThis.fetch

export class OpenAiProviderError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined

  constructor(message: string, details: { status?: number; code?: string } = {}) {
    super(message)
    this.name = "OpenAiProviderError"
    this.status = details.status
    this.code = details.code
  }
}

export function resolveOpenAiImageToEditableConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OpenAiImageToEditableConfig | null {
  const visionApiKey = nonEmpty(env.OPENAI_API_KEY)
  if (!visionApiKey) return null

  const visionBaseUrl = nonEmpty(env.OPENAI_BASE_URL)
  const imageApiKey = nonEmpty(env.OPENAI_IMAGE_API_KEY)
  const imageBaseUrl = nonEmpty(env.OPENAI_IMAGE_BASE_URL)
  if (imageBaseUrl && !imageApiKey) {
    throw new Error(
      "OPENAI_IMAGE_BASE_URL requires OPENAI_IMAGE_API_KEY so shared credentials are not forwarded to another endpoint.",
    )
  }

  return {
    vision: {
      apiKey: visionApiKey,
      model: nonEmpty(env.AI_IMAGE_VISION_MODEL) ?? "gpt-5.6",
      reasoningEffort: reasoningEffort(env.AI_IMAGE_VISION_REASONING_EFFORT),
      maxOutputTokens: positiveInteger(env.AI_IMAGE_VISION_MAX_OUTPUT_TOKENS, 16_000),
      ...(visionBaseUrl ? { baseUrl: visionBaseUrl } : {}),
    },
    image: imageApiKey
      ? {
          apiKey: imageApiKey,
          model: nonEmpty(env.AI_IMAGE_EDIT_MODEL) ?? "gpt-image-2",
          ...(imageBaseUrl ? { baseUrl: imageBaseUrl } : {}),
        }
      : {
          apiKey: visionApiKey,
          model: nonEmpty(env.AI_IMAGE_EDIT_MODEL) ?? "gpt-image-2",
          ...(visionBaseUrl ? { baseUrl: visionBaseUrl } : {}),
        },
  }
}

export class OpenAiVisionAnalyzer implements VisionAnalyzerPort {
  constructor(
    private readonly config: OpenAiConnection & {
      readonly model: string
      readonly reasoningEffort?: "low" | "medium" | "high"
      readonly maxOutputTokens?: number
    },
    private readonly fetchImplementation: Fetch = globalThis.fetch,
  ) {}

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
    const startedAt = Date.now()
    const image = request.image
    const body = JSON.stringify({
      model: this.config.model,
      store: false,
      stream: true,
      reasoning: { effort: this.config.reasoningEffort ?? "medium" },
      max_output_tokens: this.config.maxOutputTokens ?? 10_000,
      input: [
        {
          role: "system",
          content:
            "You are a production document-image decomposition engine. Return exhaustive, pixel-coordinate scene structure for reconstruction, not a prose summary.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: analysisPrompt(image.width, image.height),
            },
            {
              type: "input_image",
              image_url: dataUrl(image),
              detail: "original",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "editable_image_analysis",
          strict: true,
          schema: IMAGE_ANALYSIS_SCHEMA,
        },
      },
    })
    const response = await fetchWithTransientRetries(
      this.fetchImplementation,
      endpoint(this.config.baseUrl, "responses"),
      () => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        ...(request.signal ? { signal: request.signal } : {}),
      }),
    )
    const payload = await readResponsePayload(response)
    assertOk(response, payload)
    const rawAnalysis = JSON.parse(extractResponseText(payload)) as unknown
    const analysis = validateAnalysis(rawAnalysis, image.width, image.height)

    const receipt = responseReceipt(
      payload,
      this.config.model,
      "vision-analysis",
      startedAt,
    )
    if (request.onPartialResult) {
      await request.onPartialResult({
        analysis,
        receipt,
        tile: { x: 0, y: 0, width: image.width, height: image.height },
      })
    }
    return {
      analysis,
      receipts: [receipt],
    }
  }
}

export class OpenAiImageEditor implements ImageEditPort {
  constructor(
    private readonly config: OpenAiConnection & { readonly model: string },
    private readonly fetchImplementation: Fetch = globalThis.fetch,
  ) {}

  async edit(request: ImageEditRequest): Promise<ImageEditResult> {
    const startedAt = Date.now()
    const response = await fetchWithTransientRetries(
      this.fetchImplementation,
      endpoint(this.config.baseUrl, "images/edits"),
      () => {
        const form = new FormData()
        form.append("model", this.config.model)
        form.append("prompt", request.prompt)
        form.append("size", request.size)
        form.append("quality", request.quality)
        form.append("output_format", "png")
        form.append("n", "1")
        form.append("image", pngBlob(request.image.bytes), "input.png")
        return {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        ...(request.signal ? { signal: request.signal } : {}),
        }
      },
    )
    const payload = await readJson(response)
    assertOk(response, payload)
    const encoded = imageBase64(payload)
    const bytes = Buffer.from(encoded, "base64")
    const metadata = await sharp(bytes).metadata()
    if (!metadata.width || !metadata.height) {
      throw new OpenAiProviderError("Image Edit returned an undecodable image.")
    }

    return {
      image: {
        bytes,
        mimeType: "image/png",
        width: metadata.width,
        height: metadata.height,
      },
      receipt: imageReceipt(
        payload,
        this.config.model,
        request.operation,
        startedAt,
      ),
    }
  }
}

export const IMAGE_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    canvasSummary: { type: "string" },
    backgroundDescription: { type: "string" },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          k: {
            type: "string",
            enum: ["t", "r"],
            description: "t=text, r=non-text raster layer",
          },
          b: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
            description: "[x,y,width,height] in source pixels",
          },
          v: {
            type: "string",
            description: "verbatim text for t; short semantic description for r",
          },
          c: {
            type: "string",
            description: "primary #RRGGBB text color for t; #000000 for r",
          },
          s: { type: "number", description: "font size for t; 0 for r" },
          w: { type: "number", description: "font weight for t; 400 for r" },
          a: { type: "string", enum: ["start", "middle", "end"] },
          r: { type: "number", description: "rotation degrees" },
          z: { type: "number", description: "back-to-front z order" },
          q: { type: "number", description: "confidence from 0 to 1" },
          f: { type: "string", enum: ["standard", "critical"] },
          p: {
            type: ["integer", "null"],
            description: "parent element array index, or null for a root element",
          },
          d: {
            type: "string",
            enum: ["keep-whole", "split-group", "split-leaf", "native-text"],
          },
          e: { type: "string", enum: ["high", "medium", "low"] },
          h: { type: "string", enum: ["low", "medium", "high"] },
          g: {
            type: "string",
            enum: ["background", "foreground"],
            description: "background only for the single coherent base scene layer",
          },
          u: {
            type: "string",
            enum: [
              "background-field",
              "bounded-artwork",
              "container",
              "leaf",
              "native-text",
            ],
            description:
              "scene role: diffuse base field, bounded replaceable artwork, editable container, leaf visual, or native text",
          },
        },
        required: [
          "k",
          "b",
          "v",
          "c",
          "s",
          "w",
          "a",
          "r",
          "z",
          "q",
          "f",
          "p",
          "d",
          "e",
          "h",
          "g",
          "u",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["canvasSummary", "backgroundDescription", "elements"],
  additionalProperties: false,
} as const

function analysisPrompt(width: number, height: number) {
  return `Analyze this ${width}x${height} image for conversion into an editable SVG.

Coordinate contract: origin is the top-left pixel. Encode every bbox as b=[x,y,width,height] in source pixels and keep it within 0..${width} by 0..${height}.

Return every separately editable text run, including headings, labels, values, legends, chart axes, captions, and footer copy. Preserve text verbatim. Use one text element per visually coherent run or line, not one character. Estimate font size, weight, primary solid color, alignment, rotation, z-order, and confidence.

Return non-text content as raster-layer elements according to edit value and contextual editability, not pixel count. Split high-value independent elements such as logos, icons, chart groups, card frames, legends, route diagrams, and editable visual modules. A complex visual is still a candidate for a separate raster layer when it has a clear silhouette, closed boundary, panel edge, footer shape, or other replaceable footprint, even if it is not individually vector-editable. Keep only diffuse gradients, environmental light, fused shadows, texture, or artwork whose boundary cannot be separated reliably as one keep-whole base field. Use split-group for a meaningful container and split-leaf for an independently editable child. Do not create raster layers for plain whitespace.

Use u=background-field only for a diffuse/fused base field that should be reconstructed into the clean background. Never use background-field for a bounded corner illustration, city/terrain panel, wave/mesh footer, chart panel, card, logo, icon, frame, or local decorative artwork with a visible boundary. Use u=bounded-artwork for those complex but clearly bounded replaceable regions. Use u=container for cards, chart modules, frames, and grouped sections; u=leaf for icons and small decorations; u=native-text for text. g=background is allowed only on a root background-field element; every other element is g=foreground. It is valid to have multiple root foreground elements. Do not force unrelated elements under a full-canvas background.

Every element must have a parent array index p or null, a decomposition strategy d, an edit-value score e, a fidelity-risk score h, a role g, and a scene role u. Parent elements must be listed before their children. Use the smallest meaningful split-group that visually contains a child; otherwise leave p=null. Do not attach a bounded-artwork, container, or leaf to the background merely to make the tree look complete. Every split-group must have at least one direct child; use split-leaf instead when the element has no independently editable children. If a parent and child overlap, the parent is a residual visual layer after the child area is removed; never duplicate the same pixels in both layers. The diffuse root background remains an editable raster through the repaired clean-background asset and must not be duplicated as a foreground layer.

For each raster bbox include the full visible footprint with a small safety margin. Do not crop logos, chart axes, frame strokes, rounded corners, shadows that belong to the component, or thin decorative lines. Mark logos, charts, route diagrams, and brand marks as f=critical. The final list must cover all meaningful editable content while avoiding low-value decorative fragmentation. Compact element encoding: k is t for text or r for raster; v is verbatim text for t or a concise visual description for r; c/s/w are text color/font size/font weight and must be #000000/0/400 for r; a is alignment; r is rotation degrees; z is z-order; q is confidence; f is critical for logos, precise charts, route diagrams, and brand marks; p/d/e/h/g/u are parent, decomposition, edit-value, fidelity risk, foreground/background role, and scene role.`
}

function validateAnalysis(
  value: unknown,
  canvasWidth: number,
  canvasHeight: number,
): ImageStructureAnalysis {
  if (!isRecord(value) || !Array.isArray(value.elements)) {
    throw new OpenAiProviderError("Vision analysis did not match the expected object shape.")
  }
  const provisional = value.elements.map((candidate, index) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.b) || candidate.b.length !== 4) {
      throw new OpenAiProviderError(`Vision element ${index} is malformed.`)
    }
    const kind: AnalyzedElement["kind"] = candidate.k === "t" ? "text" : "raster-layer"
    const bbox = normalizeBBox(
      {
        x: candidate.b[0],
        y: candidate.b[1],
        width: candidate.b[2],
        height: candidate.b[3],
      },
      canvasWidth,
      canvasHeight,
    )
    const content = stringValue(candidate.v, "")
    const semanticId = slug(content).slice(0, 48)
    const id = semanticId
      ? `${kind === "text" ? "text" : "raster"}-${semanticId}-${index + 1}`
      : `${kind === "text" ? "text" : "raster"}-${index + 1}`

    const decomposition: AnalyzedElement["decomposition"] =
      candidate.d === "keep-whole" ||
      candidate.d === "split-group" ||
      candidate.d === "split-leaf" ||
      candidate.d === "native-text"
        ? candidate.d
        : kind === "text"
          ? "native-text"
          : "keep-whole"
    const editValue: AnalyzedElement["editValue"] =
      candidate.e === "high" || candidate.e === "low" ? candidate.e : "medium"
    const fidelityRisk: AnalyzedElement["fidelityRisk"] =
      candidate.h === "high" || candidate.h === "low" ? candidate.h : "medium"
    const textAlign: AnalyzedElement["textAlign"] =
      candidate.a === "middle" || candidate.a === "end" ? candidate.a : "start"
    const fidelity: AnalyzedElement["fidelity"] =
      candidate.f === "critical" ? "critical" : "standard"
    const role: AnalyzedElement["role"] =
      kind === "raster-layer" && candidate.g === "background"
        ? "background"
        : "foreground"
    const sceneRole = sceneRoleValue(
      candidate.u,
      kind,
      role,
      decomposition,
      bbox,
      canvasWidth,
      canvasHeight,
    )

    return {
      id,
      name: kind === "text" ? content.slice(0, 80) || id : content || id,
      kind,
      role,
      sceneRole,
      parentIndex:
        typeof candidate.p === "number" &&
        Number.isInteger(candidate.p) &&
        candidate.p >= 0 &&
        candidate.p < (value.elements as unknown[]).length &&
        candidate.p < index &&
        candidate.p !== index
          ? candidate.p
          : null,
      decomposition,
      editValue,
      fidelityRisk,
      zIndex: finite(candidate.z, index + 1),
      logicalBBox: bbox,
      text: kind === "text" ? content : "",
      fontSize: kind === "text" ? clamp(finite(candidate.s, 16), 4, 512) : 0,
      fontWeight: clamp(Math.round(finite(candidate.w, 400) / 100) * 100, 100, 900),
      fill: color(stringValue(candidate.c, "#0f172a")),
      textAlign,
      rotationDegrees: clamp(finite(candidate.r, 0), -360, 360),
      confidence: clamp(finite(candidate.q, 0.5), 0, 1),
      description: kind === "raster-layer" ? content : "",
      fidelity,
    }
  })
  const ids = provisional.map((element) => element.id)
  const normalizedElements = provisional.map((element) => {
    const { parentIndex, ...normalized } = element
    return {
      ...normalized,
      parentId: parentIndex === null ? null : ids[parentIndex] ?? null,
    } satisfies AnalyzedElement
  })
  const elements = normalizeSceneHierarchy(normalizedElements)

  return {
    canvasSummary: stringValue(value.canvasSummary, ""),
    backgroundDescription: stringValue(value.backgroundDescription, "clean background"),
    elements,
  }
}

export function normalizeSceneHierarchy(elements: readonly AnalyzedElement[]) {
  const backgroundIds = new Set(
    elements
      .filter((element) => element.sceneRole === "background-field")
      .map((element) => element.id),
  )
  return elements.map((element, index) => {
    if (
      element.sceneRole === "background-field" ||
      (element.parentId && !backgroundIds.has(element.parentId))
    ) {
      return element
    }
    const container = elements
      .slice(0, index)
      .filter(
        (candidate) =>
          candidate.kind === "raster-layer" &&
          (candidate.sceneRole === "container" ||
            candidate.sceneRole === "bounded-artwork" ||
            candidate.sceneRole === undefined) &&
          candidate.decomposition === "split-group" &&
          (bboxArea(candidate.logicalBBox) > bboxArea(element.logicalBBox) ||
            (candidate.sceneRole === "bounded-artwork" &&
              bboxArea(candidate.logicalBBox) === bboxArea(element.logicalBBox))) &&
          containsCenter(candidate.logicalBBox, element.logicalBBox),
      )
      .sort(
        (left, right) => bboxArea(left.logicalBBox) - bboxArea(right.logicalBBox),
      )[0]
    return { ...element, parentId: container?.id ?? element.parentId }
  })
}

function sceneRoleValue(
  value: unknown,
  kind: AnalyzedElement["kind"],
  role: AnalyzedElement["role"],
  decomposition: AnalyzedElement["decomposition"],
  bbox: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
): NonNullable<AnalyzedElement["sceneRole"]> {
  if (
    value === "background-field" ||
    value === "bounded-artwork" ||
    value === "container" ||
    value === "leaf" ||
    value === "native-text"
  ) {
    return value
  }
  if (kind === "text") return "native-text"
  if (
    role === "background" &&
    decomposition === "keep-whole" &&
    bboxArea(bbox) >= 0.8 * canvasWidth * canvasHeight
  ) {
    return "background-field"
  }
  if (decomposition === "split-group") return "container"
  if (decomposition === "keep-whole") return "bounded-artwork"
  return "leaf"
}

function containsCenter(parent: BoundingBox, child: BoundingBox) {
  const centerX = child.x + child.width / 2
  const centerY = child.y + child.height / 2
  return (
    centerX >= parent.x &&
    centerY >= parent.y &&
    centerX <= parent.x + parent.width &&
    centerY <= parent.y + parent.height
  )
}

function bboxArea(box: BoundingBox) {
  return box.width * box.height
}

type BoundingBox = AnalyzedElement["logicalBBox"]

function normalizeBBox(
  value: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
) {
  const x = clamp(Math.floor(finite(value.x, 0)), 0, canvasWidth - 1)
  const y = clamp(Math.floor(finite(value.y, 0)), 0, canvasHeight - 1)
  const width = clamp(Math.ceil(finite(value.width, 1)), 1, canvasWidth - x)
  const height = clamp(Math.ceil(finite(value.height, 1)), 1, canvasHeight - y)
  return { x, y, width, height }
}

function endpoint(baseUrl: string | undefined, path: string) {
  return `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/${path}`
}

function dataUrl(image: RasterImage) {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`
}

function pngBlob(bytes: Uint8Array) {
  return new Blob([Buffer.from(bytes)], { type: "image/png" })
}

async function fetchWithTransientRetries(
  fetchImplementation: Fetch,
  url: string,
  buildInit: () => RequestInit,
  maxAttempts = 3,
) {
  let lastResponse: Response | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImplementation(url, buildInit())
    lastResponse = response
    const transient =
      response.status === 429 || (response.status >= 500 && response.status !== 524)
    if (!transient || attempt === maxAttempts) return response
    await response.arrayBuffer()
    await delay(750 * 2 ** (attempt - 1))
  }
  return lastResponse!
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try {
    const value = JSON.parse(text) as unknown
    if (isRecord(value)) return value
  } catch {
    // The sanitized error below deliberately excludes provider HTML/body content.
  }
  throw new OpenAiProviderError(
    `Provider returned a non-JSON response with status ${response.status}.`,
    { status: response.status },
  )
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (!response.ok || !contentType.includes("text/event-stream")) {
    return readJson(response)
  }
  if (!response.body) {
    throw new OpenAiProviderError("Streaming response did not include a body.", {
      status: response.status,
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let completed: Record<string, unknown> | undefined
  while (true) {
    const chunk = await reader.read()
    buffer += decoder.decode(chunk.value, { stream: !chunk.done })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ""
    for (const frame of frames) {
      const event = parseServerSentEvent(frame)
      if (!event) continue
      if (event.type === "response.completed" && isRecord(event.response)) {
        completed = event.response
      }
      if (event.type === "response.failed" && isRecord(event.response)) {
        const failure = event.response
        const error = isRecord(failure.error) ? failure.error : {}
        throw new OpenAiProviderError(
          stringValue(error.message, "Streaming vision response failed."),
          {
            ...(typeof error.code === "string" ? { code: error.code } : {}),
          },
        )
      }
    }
    if (chunk.done) break
  }
  if (completed) return completed
  throw new OpenAiProviderError(
    "Streaming vision response ended without response.completed.",
  )
}

function parseServerSentEvent(frame: string): Record<string, unknown> | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
  if (!data || data === "[DONE]") return null
  try {
    const value = JSON.parse(data) as unknown
    return isRecord(value) ? value : null
  } catch {
    throw new OpenAiProviderError("Provider emitted malformed SSE JSON.")
  }
}

function assertOk(response: Response, payload: Record<string, unknown>) {
  if (response.ok) return
  const error = isRecord(payload.error) ? payload.error : payload
  const code = typeof error.code === "string" ? error.code : undefined
  const message =
    typeof error.message === "string"
      ? error.message
      : `Provider request failed with status ${response.status}.`
  throw new OpenAiProviderError(message, {
    status: response.status,
    ...(code ? { code } : {}),
  })
}

function extractResponseText(payload: Record<string, unknown>) {
  if (payload.status !== "completed") {
    throw new OpenAiProviderError(
      `Vision response did not complete (status=${String(payload.status)}).`,
    )
  }
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!isRecord(content)) continue
      if (content.type === "refusal") {
        throw new OpenAiProviderError("Vision analysis was refused by the provider.")
      }
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text
      }
    }
  }
  throw new OpenAiProviderError("Vision response did not contain output text.")
}

function imageBase64(payload: Record<string, unknown>) {
  const data = Array.isArray(payload.data) ? payload.data : []
  const first = data[0]
  if (!isRecord(first) || typeof first.b64_json !== "string") {
    throw new OpenAiProviderError("Image Edit response did not contain b64_json.")
  }
  return first.b64_json
}

function responseReceipt(
  payload: Record<string, unknown>,
  model: string,
  operation: ProviderCallReceipt["operation"],
  startedAt: number,
): ProviderCallReceipt {
  const usage = isRecord(payload.usage) ? payload.usage : {}
  return {
    requestId: stringValue(payload.id, "unknown"),
    provider: "openai",
    model: stringValue(payload.model, model),
    operation,
    createdAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    usage: {
      ...optionalNumber("inputTokens", usage.input_tokens),
      ...optionalNumber("outputTokens", usage.output_tokens),
      ...optionalNumber("totalTokens", usage.total_tokens),
    },
  }
}

function imageReceipt(
  payload: Record<string, unknown>,
  model: string,
  operation: ProviderCallReceipt["operation"],
  startedAt: number,
): ProviderCallReceipt {
  const usage = isRecord(payload.usage) ? payload.usage : {}
  const details = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : {}
  return {
    requestId: stringValue(payload.id, `image-${startedAt}`),
    provider: "openai",
    model,
    operation,
    createdAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    usage: {
      ...optionalNumber("inputTokens", usage.input_tokens),
      ...optionalNumber("outputTokens", usage.output_tokens),
      ...optionalNumber("totalTokens", usage.total_tokens),
      ...optionalNumber("inputImageTokens", details.image_tokens),
      ...optionalNumber("inputTextTokens", details.text_tokens),
    },
  }
}

function optionalNumber<Key extends string>(key: Key, value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? ({ [key]: value } as Record<Key, number>)
    : ({} as Record<string, never>)
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback
}

function color(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#0f172a"
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim()
  return normalized || undefined
}

function reasoningEffort(value: string | undefined) {
  return value === "low" || value === "high" ? value : "medium"
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
