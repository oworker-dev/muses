import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import sharp from "sharp"

import {
  OpenAiImageEditor,
  OpenAiVisionAnalyzer,
  resolveOpenAiImageToEditableConfig,
} from "../src/openai-provider.js"
import type {
  AnalyzedElement,
  ImageEditPort,
  ImageEditRequest,
  ProviderCallReceipt,
  VisionAnalyzerPort,
} from "../src/pipeline-contracts.js"
import { convertImageToEditable } from "../src/provider-pipeline.js"
import {
  chromaKeyToAlpha,
  createRemovalMask,
  createSparseElementCanvas,
  detectAlphaBBox,
  removeAlphaRegions,
  removeTextPixels,
  normalizeModelOutput,
} from "../src/raster-processor.js"

describe("OpenAI image-to-editable adapters", () => {
  it("keeps image-specific credentials isolated from the shared endpoint", () => {
    assert.deepEqual(
      resolveOpenAiImageToEditableConfig({
        OPENAI_API_KEY: "vision-key",
        OPENAI_BASE_URL: "https://vision.example/v1",
        OPENAI_IMAGE_API_KEY: "image-key",
      }),
      {
        vision: {
          apiKey: "vision-key",
          baseUrl: "https://vision.example/v1",
          model: "gpt-5.6",
          reasoningEffort: "medium",
          maxOutputTokens: 16000,
        },
        image: { apiKey: "image-key", model: "gpt-image-2" },
      },
    )
    assert.throws(
      () =>
        resolveOpenAiImageToEditableConfig({
          OPENAI_API_KEY: "vision-key",
          OPENAI_IMAGE_BASE_URL: "https://images.example/v1",
        }),
      /requires OPENAI_IMAGE_API_KEY/,
    )
  })

  it("uses original-detail vision input and strict structured output", async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      const completed = {
        id: "resp_test",
        status: "completed",
        model: "gpt-5.6",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  canvasSummary: "report",
                  backgroundDescription: "white",
                  elements: [
                    {
                      k: "t",
                      b: [-3, 4, 120, 20],
                      v: "Report",
                      c: "#123456",
                      s: 18,
                      w: 700,
                      a: "start",
                      r: 0,
                      z: 2,
                      q: 0.9,
                      f: "standard",
                      p: null,
                      d: "native-text",
                      e: "high",
                      h: "low",
                      g: "foreground",
                    },
                  ],
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      }
      return new Response(
        `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )
    }) as typeof fetch
    const analyzer = new OpenAiVisionAnalyzer(
      { apiKey: "test", baseUrl: "https://provider.example/v1", model: "gpt-5.6" },
      fetchMock,
    )
    const result = await analyzer.analyze({
      image: {
        bytes: Buffer.from("image"),
        mimeType: "image/png",
        width: 100,
        height: 50,
      },
    })

    const input = requestBody?.input as Array<Record<string, unknown>>
    const userContent = input[1]?.content as Array<Record<string, unknown>>
    assert.equal(userContent[1]?.detail, "original")
    const textConfig = requestBody?.text as Record<string, unknown>
    const format = textConfig.format as Record<string, unknown>
    assert.equal(format.type, "json_schema")
    assert.equal(format.strict, true)
    assert.equal(requestBody?.stream, true)
    assert.equal(result.analysis.elements[0]?.id, "text-report-1")
    assert.deepEqual(result.analysis.elements[0]?.logicalBBox, {
      x: 0,
      y: 4,
      width: 100,
      height: 20,
    })
    assert.equal(result.receipts[0]?.requestId, "resp_test")
  })

  it("completes missing container relationships under one background root", async () => {
    const element = (
      k: "t" | "r",
      b: [number, number, number, number],
      v: string,
      input: { p: number | null; d: string; g: string },
    ) => ({
      k,
      b,
      v,
      c: k === "t" ? "#111111" : "#000000",
      s: k === "t" ? 12 : 0,
      w: k === "t" ? 600 : 400,
      a: "start",
      r: 0,
      z: 1,
      q: 0.9,
      f: "standard",
      p: input.p,
      d: input.d,
      e: "high",
      h: "medium",
      g: input.g,
    })
    const completed = {
      id: "resp_hierarchy",
      status: "completed",
      model: "gpt-5.6",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                canvasSummary: "nested panel",
                backgroundDescription: "complex background",
                elements: [
                  element("r", [0, 0, 100, 100], "base", {
                    p: null,
                    d: "keep-whole",
                    g: "background",
                  }),
                  element("r", [20, 20, 60, 60], "panel", {
                    p: 0,
                    d: "split-group",
                    g: "foreground",
                  }),
                  element("t", [25, 25, 30, 12], "Title", {
                    p: 0,
                    d: "native-text",
                    g: "foreground",
                  }),
                  element("r", [30, 45, 16, 16], "icon", {
                    p: null,
                    d: "split-leaf",
                    g: "foreground",
                  }),
                ],
              }),
            },
          ],
        },
      ],
      usage: {},
    }
    const fetchMock = (async () =>
      new Response(
        `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )) as typeof fetch
    const analyzer = new OpenAiVisionAnalyzer(
      { apiKey: "test", model: "gpt-5.6" },
      fetchMock,
    )
    const result = await analyzer.analyze({
      image: {
        bytes: Buffer.from("image"),
        mimeType: "image/png",
        width: 100,
        height: 100,
      },
    })
    const [background, panel, title, icon] = result.analysis.elements
    assert.equal(panel?.parentId, background?.id)
    assert.equal(title?.parentId, panel?.id)
    assert.equal(icon?.parentId, panel?.id)
  })

  it("keeps clearly bounded artwork out of the repaired background root", async () => {
    const completed = {
      id: "resp_roles",
      status: "completed",
      model: "gpt-5.6",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                canvasSummary: "bounded artwork",
                backgroundDescription: "diffuse light field",
                elements: [
                  {
                    k: "r",
                    b: [0, 0, 100, 100],
                    v: "diffuse background field",
                    c: "#000000",
                    s: 0,
                    w: 400,
                    a: "start",
                    r: 0,
                    z: 0,
                    q: 0.95,
                    f: "standard",
                    p: null,
                    d: "keep-whole",
                    e: "medium",
                    h: "medium",
                    g: "background",
                    u: "background-field",
                  },
                  {
                    k: "r",
                    b: [4, 4, 30, 30],
                    v: "bounded corner illustration with a clear outline",
                    c: "#000000",
                    s: 0,
                    w: 400,
                    a: "start",
                    r: 0,
                    z: 1,
                    q: 0.95,
                    f: "critical",
                    p: null,
                    d: "split-group",
                    e: "high",
                    h: "high",
                    g: "foreground",
                    u: "bounded-artwork",
                  },
                  {
                    k: "r",
                    b: [10, 10, 8, 8],
                    v: "small outlined detail inside the artwork",
                    c: "#000000",
                    s: 0,
                    w: 400,
                    a: "start",
                    r: 0,
                    z: 2,
                    q: 0.9,
                    f: "standard",
                    p: null,
                    d: "split-leaf",
                    e: "medium",
                    h: "medium",
                    g: "foreground",
                    u: "leaf",
                  },
                ],
              }),
            },
          ],
        },
      ],
      usage: {},
    }
    const fetchMock = (async () =>
      new Response(
        `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )) as typeof fetch
    const analyzer = new OpenAiVisionAnalyzer(
      { apiKey: "test", model: "gpt-5.6" },
      fetchMock,
    )
    const result = await analyzer.analyze({
      image: { bytes: Buffer.from("image"), mimeType: "image/png", width: 100, height: 100 },
    })
    const artwork = result.analysis.elements[1]
    const detail = result.analysis.elements[2]
    assert.equal(artwork?.sceneRole, "bounded-artwork")
    assert.equal(artwork?.parentId, null)
    assert.equal(detail?.parentId, artwork?.id)
  })

  it("sends an Images Edit multipart request and captures usage", async () => {
    const output = await sharp({
      create: { width: 32, height: 32, channels: 4, background: "#ffffff" },
    })
      .png()
      .toBuffer()
    let fields: string[] = []
    const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
      assert.ok(init?.body instanceof FormData)
      fields = [...init.body.keys()]
      return new Response(
        JSON.stringify({
          id: "img_test",
          data: [{ b64_json: output.toString("base64") }],
          usage: {
            input_tokens: 11,
            output_tokens: 12,
            total_tokens: 23,
            input_tokens_details: { image_tokens: 9, text_tokens: 2 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as typeof fetch
    const editor = new OpenAiImageEditor(
      { apiKey: "test", model: "gpt-image-2" },
      fetchMock,
    )
    const result = await editor.edit({
      operation: "background-repair",
      image: { bytes: output, mimeType: "image/png", width: 32, height: 32 },
      prompt: "remove foreground",
      size: "32x32",
      quality: "low",
    })

    assert.ok(fields.includes("image"))
    assert.equal(fields.includes("mask"), false)
    assert.ok(fields.includes("model"))
    assert.equal(result.image.width, 32)
    assert.equal(result.receipt.usage.inputImageTokens, 9)
  })
})

describe("deterministic image processing", () => {
  it("turns only border-connected chroma into alpha and detects the subject bbox", async () => {
    const keyed = await sharp({
      create: { width: 64, height: 48, channels: 4, background: "#ff00ff" },
    })
      .composite([
        {
          input: {
            create: {
              width: 24,
              height: 16,
              channels: 4,
              background: "#0066cc",
            },
          },
          left: 20,
          top: 18,
        },
      ])
      .png()
      .toBuffer()
    const alpha = await chromaKeyToAlpha({
      image: { bytes: keyed, mimeType: "image/png", width: 64, height: 48 },
    })
    const bbox = await detectAlphaBBox(alpha.image, {
      x: 0,
      y: 0,
      width: 64,
      height: 48,
    })
    assert.deepEqual(bbox, { x: 20, y: 18, width: 24, height: 16 })
    assert.ok(alpha.transparentCoverage > 0.8)
  })

  it("removes enclosed chroma holes instead of preserving synthetic magenta", async () => {
    const keyed = await sharp({
      create: { width: 48, height: 48, channels: 4, background: "#ff00ff" },
    })
      .composite([
        {
          input: {
            create: { width: 28, height: 28, channels: 4, background: "#0066cc" },
          },
          left: 10,
          top: 10,
        },
        {
          input: {
            create: { width: 12, height: 12, channels: 4, background: "#ff00ff" },
          },
          left: 18,
          top: 18,
        },
      ])
      .png()
      .toBuffer()
    const alpha = await chromaKeyToAlpha({
      image: { bytes: keyed, mimeType: "image/png", width: 48, height: 48 },
    })
    const raw = await sharp(alpha.image.bytes).ensureAlpha().raw().toBuffer()
    assert.equal(raw[(24 * 48 + 24) * 4 + 3], 0)
  })

  it("supports a local sparse redraw canvas with a global origin", async () => {
    const source = await sharp({
      create: { width: 64, height: 64, channels: 4, background: "#eeeeee" },
    })
      .composite([
        {
          input: { create: { width: 12, height: 10, channels: 4, background: "#0066cc" } },
          left: 24,
          top: 22,
        },
      ])
      .png()
      .toBuffer()
    const element = rasterElement({
      id: "local-icon",
      bbox: { x: 24, y: 22, width: 12, height: 10 },
    })
    const sparse = await createSparseElementCanvas({
      source: { bytes: source, mimeType: "image/png", width: 64, height: 64 },
      elements: [element],
      activeElementIds: new Set([element.id]),
      region: { x: 16, y: 14, width: 28, height: 26 },
    })
    assert.deepEqual(sparse.origin, { x: 16, y: 14 })
    assert.deepEqual(
      { width: sparse.image.width, height: sparse.image.height },
      { width: 28, height: 26 },
    )
    const raw = await sharp(sparse.image.bytes).raw().toBuffer()
    assert.deepEqual([...raw.subarray((8 * 28 + 8) * 4, (8 * 28 + 8) * 4 + 3)], [0, 102, 204])
  })

  it("preserves redraw aspect ratio when normalizing provider dimensions", async () => {
    const source = await sharp({
      create: { width: 20, height: 20, channels: 4, background: "#0066cc" },
    })
      .png()
      .toBuffer()
    const normalized = await normalizeModelOutput(
      { bytes: source, mimeType: "image/png", width: 20, height: 20 },
      80,
      40,
      { preserveAspectRatio: true },
    )
    const bbox = await detectAlphaBBox(
      await chromaKeyToAlpha({ image: normalized }).then((result) => result.image),
      { x: 0, y: 0, width: 80, height: 40 },
    )
    assert.deepEqual(bbox, { x: 20, y: 0, width: 40, height: 40 })
  })

  it("builds an edit mask with transparent element regions", async () => {
    const mask = await createRemovalMask(32, 32, [
      {
        id: "title",
        name: "title",
        kind: "text",
        role: "foreground",
        parentId: null,
        decomposition: "native-text",
        editValue: "high",
        fidelityRisk: "low",
        zIndex: 1,
        logicalBBox: { x: 10, y: 10, width: 4, height: 4 },
        text: "A",
        fontSize: 12,
        fontWeight: 400,
        fill: "#000000",
        textAlign: "start",
        rotationDegrees: 0,
        confidence: 1,
        description: "",
        fidelity: "standard",
      },
    ])
    const raw = await sharp(mask.bytes).ensureAlpha().raw().toBuffer()
    assert.equal(raw[(11 * 32 + 11) * 4 + 3], 0)
    assert.equal(raw[0 * 4 + 3], 255)
  })

  it("keeps parent and child pixels in separate residual layers", async () => {
    const source = await sharp({
      create: { width: 64, height: 64, channels: 4, background: "#eeeeee" },
    })
      .composite([
        {
          input: {
            create: { width: 40, height: 40, channels: 4, background: "#cc3300" },
          },
          left: 10,
          top: 10,
        },
        {
          input: {
            create: { width: 10, height: 10, channels: 4, background: "#0066cc" },
          },
          left: 25,
          top: 25,
        },
      ])
      .png()
      .toBuffer()
    const parent = rasterElement({
      id: "parent",
      bbox: { x: 10, y: 10, width: 40, height: 40 },
      decomposition: "split-group",
    })
    const child = rasterElement({
      id: "child",
      parentId: parent.id,
      bbox: { x: 25, y: 25, width: 10, height: 10 },
    })
    const image = {
      bytes: source,
      mimeType: "image/png" as const,
      width: 64,
      height: 64,
    }

    const parentSparse = await createSparseElementCanvas({
      source: image,
      elements: [parent, child],
      activeElementIds: new Set([parent.id]),
    })
    const parentRaw = await sharp(parentSparse.image.bytes).raw().toBuffer()
    const childOffset = (30 * 64 + 30) * 4
    assert.deepEqual([...parentRaw.subarray(childOffset, childOffset + 3)], [255, 0, 255])

    const preservedParent = await createSparseElementCanvas({
      source: image,
      elements: [parent, child],
      activeElementIds: new Set([parent.id]),
      maskDescendants: false,
    })
    const preservedRaw = await sharp(preservedParent.image.bytes).raw().toBuffer()
    assert.deepEqual(
      [...preservedRaw.subarray(childOffset, childOffset + 3)],
      [0, 102, 204],
    )

    const childSparse = await createSparseElementCanvas({
      source: image,
      elements: [parent, child],
      activeElementIds: new Set([child.id]),
    })
    const childRaw = await sharp(childSparse.image.bytes).raw().toBuffer()
    assert.deepEqual([...childRaw.subarray(childOffset, childOffset + 3)], [0, 102, 204])

    const alpha = await chromaKeyToAlpha({ image: parentSparse.image })
    const residual = await removeAlphaRegions(alpha.image, [child.logicalBBox])
    const residualRaw = await sharp(residual.bytes).ensureAlpha().raw().toBuffer()
    assert.equal(residualRaw[childOffset + 3], 0)
  })

  it("removes text-colored pixels without punching out the whole text bbox", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "#ffffff" },
    })
      .composite([
        {
          input: {
            create: { width: 4, height: 4, channels: 4, background: "#111111" },
          },
          left: 6,
          top: 6,
        },
      ])
      .png()
      .toBuffer()
    const cleaned = await removeTextPixels(
      { bytes, mimeType: "image/png", width: 16, height: 16 },
      [
        {
          id: "text",
          name: "text",
          kind: "text",
          role: "foreground",
          parentId: null,
          decomposition: "native-text",
          editValue: "high",
          fidelityRisk: "low",
          zIndex: 1,
          logicalBBox: { x: 4, y: 4, width: 8, height: 8 },
          text: "A",
          fontSize: 8,
          fontWeight: 400,
          fill: "#111111",
          textAlign: "start",
          rotationDegrees: 0,
          confidence: 1,
          description: "",
          fidelity: "standard",
        },
      ],
    )
    const raw = await sharp(cleaned.bytes).ensureAlpha().raw().toBuffer()
    assert.equal(raw[(7 * 16 + 7) * 4 + 3], 0)
    assert.equal(raw[(5 * 16 + 5) * 4 + 3], 255)
  })
})

describe("provider-backed conversion pipeline", () => {
  it("persists three provider stages and assembles an editable SVG", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "ai-image-provider-test-"))
    try {
      const inputPath = path.join(temporary, "source.png")
      const outputDirectory = path.join(temporary, "output")
      const source = await sharp({
        create: { width: 128, height: 128, channels: 4, background: "#eeeeee" },
      })
        .png()
        .toBuffer()
      await writeFile(inputPath, source)
      const vision: VisionAnalyzerPort = {
        analyze: async () => ({
          analysis: {
            canvasSummary: "fixture",
            backgroundDescription: "plain white",
            elements: [
              {
                id: "title",
                name: "Title",
                kind: "text",
                role: "foreground",
                parentId: null,
                decomposition: "native-text",
                editValue: "high",
                fidelityRisk: "low",
                zIndex: 2,
                logicalBBox: { x: 5, y: 5, width: 45, height: 12 },
                text: "Editable",
                fontSize: 10,
                fontWeight: 700,
                fill: "#111111",
                textAlign: "start",
                rotationDegrees: 0,
                confidence: 0.95,
                description: "title",
                fidelity: "standard",
              },
              {
                id: "icon",
                name: "Icon",
                kind: "raster-layer",
                role: "foreground",
                parentId: null,
                decomposition: "split-leaf",
                editValue: "high",
                fidelityRisk: "medium",
                zIndex: 1,
                logicalBBox: { x: 40, y: 40, width: 30, height: 25 },
                text: "",
                fontSize: 0,
                fontWeight: 400,
                fill: "#000000",
                textAlign: "start",
                rotationDegrees: 0,
                confidence: 0.9,
                description: "blue icon",
                fidelity: "standard",
              },
            ],
          },
          receipts: [receipt("vision-analysis", "vision-1")],
        }),
      }
      const imageEditor = new FixtureImageEditor()
      const result = await convertImageToEditable({
        inputPath,
        outputDirectory,
        visionAnalyzer: vision,
        imageEditor,
        quality: "low",
      })

      assert.equal(result.manifest.provenance.calls.length, 3)
      assert.equal(result.qa.structure.textElements, 1)
      assert.equal(result.qa.structure.renderedRasterElements, 1)
      assert.equal(result.qa.checks.editableTextVisible, true)
      const svg = await readFile(path.join(outputDirectory, "editable.svg"), "utf8")
      assert.match(svg, /data-layer-type="text"/)
      assert.match(svg, /data-layer-type="raster-layer"/)
      assert.match(svg, /id="clean-background"/)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it("promotes a complex root background and redraws foreground by hierarchy depth", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "ai-image-hierarchy-test-"))
    try {
      const inputPath = path.join(temporary, "source.png")
      const outputDirectory = path.join(temporary, "output")
      const source = await sharp({
        create: { width: 128, height: 128, channels: 4, background: "#eeeeee" },
      })
        .composite([
          {
            input: {
              create: { width: 60, height: 60, channels: 4, background: "#cc3300" },
            },
            left: 20,
            top: 20,
          },
          {
            input: {
              create: { width: 20, height: 20, channels: 4, background: "#0066cc" },
            },
            left: 40,
            top: 40,
          },
        ])
        .png()
        .toBuffer()
      await writeFile(inputPath, source)

      const background = rasterElement({
        id: "base-scene",
        bbox: { x: 0, y: 0, width: 128, height: 128 },
        role: "background",
        decomposition: "keep-whole",
        zIndex: 0,
      })
      const panel = rasterElement({
        id: "panel",
        parentId: background.id,
        bbox: { x: 20, y: 20, width: 60, height: 60 },
        decomposition: "split-group",
        zIndex: 1,
      })
      const icon = rasterElement({
        id: "icon",
        parentId: panel.id,
        bbox: { x: 40, y: 40, width: 20, height: 20 },
        zIndex: 2,
      })
      const title: AnalyzedElement = {
        id: "title",
        name: "Title",
        kind: "text",
        role: "foreground",
        parentId: background.id,
        decomposition: "native-text",
        editValue: "high",
        fidelityRisk: "low",
        zIndex: 3,
        logicalBBox: { x: 5, y: 5, width: 35, height: 10 },
        text: "Editable",
        fontSize: 10,
        fontWeight: 700,
        fill: "#111111",
        textAlign: "start",
        rotationDegrees: 0,
        confidence: 0.95,
        description: "title",
        fidelity: "standard",
      }
      const vision: VisionAnalyzerPort = {
        analyze: async () => ({
          analysis: {
            canvasSummary: "hierarchy fixture",
            backgroundDescription: "soft gray field",
            elements: [background, panel, icon, title],
          },
          receipts: [receipt("vision-analysis", "vision-hierarchy")],
        }),
      }
      const redrawDepths: number[] = []
      const imageEditor: ImageEditPort = {
        edit: async (request) => {
          if (request.operation === "background-repair") {
            const input = await sharp(request.image.bytes).ensureAlpha().raw().toBuffer()
            const preserved = (110 * 128 + 110) * 4
            const removed = (50 * 128 + 50) * 4
            assert.deepEqual([...input.subarray(preserved, preserved + 3)], [238, 238, 238])
            assert.deepEqual([...input.subarray(removed, removed + 3)], [255, 0, 255])
            const bytes = await sharp({
              create: { width: 128, height: 128, channels: 4, background: "#eeeeee" },
            })
              .png()
              .toBuffer()
            return {
              image: { bytes, mimeType: "image/png", width: 128, height: 128 },
              receipt: receipt("background-repair", "background-hierarchy"),
            }
          }

          const depth = request.prompt.includes("hierarchy-depth 1") ? 1 : 2
          redrawDepths.push(depth)
          const input = await sharp(request.image.bytes).ensureAlpha().raw().toBuffer()
          const center = (50 * 128 + 50) * 4
          assert.deepEqual(
            [...input.subarray(center, center + 3)],
            depth === 1 ? [255, 0, 255] : [0, 102, 204],
          )
          const visual =
            depth === 1
              ? { left: 20, top: 20, width: 60, height: 60, color: "#cc3300" }
              : { left: 40, top: 40, width: 20, height: 20, color: "#0066cc" }
          const bytes = await sharp({
            create: { width: 128, height: 128, channels: 4, background: "#ff00ff" },
          })
            .composite([
              {
                input: {
                  create: {
                    width: visual.width,
                    height: visual.height,
                    channels: 4,
                    background: visual.color,
                  },
                },
                left: visual.left,
                top: visual.top,
              },
            ])
            .png()
            .toBuffer()
          return {
            image: { bytes, mimeType: "image/png", width: 128, height: 128 },
            receipt: receipt("element-redraw", `redraw-depth-${depth}`),
          }
        },
      }

      const result = await convertImageToEditable({
        inputPath,
        outputDirectory,
        visionAnalyzer: vision,
        imageEditor,
        quality: "low",
      })

      assert.deepEqual(redrawDepths, [1, 2])
      assert.equal(result.manifest.background.sourceElementId, background.id)
      assert.equal(result.manifest.elements.some((element) => element.id === background.id), false)
      assert.equal(result.qa.structure.renderedRasterElements, 2)
      const panelScene = result.manifest.elements.find((element) => element.id === panel.id)
      assert.ok(panelScene?.asset && panelScene.cropBBox)
      const panelAsset = await sharp(
        await readFile(path.join(outputDirectory, panelScene.asset.path)),
      )
        .ensureAlpha()
        .raw()
        .toBuffer()
      const childX = 50 - panelScene.cropBBox.x
      const childY = 50 - panelScene.cropBBox.y
      assert.equal(panelAsset[(childY * panelScene.asset.width + childX) * 4 + 3], 0)
      const svg = await readFile(path.join(outputDirectory, "editable.svg"), "utf8")
      assert.match(svg, /id="panel"[^>]*x="18"/)
      assert.match(svg, /data-layer-type="raster-background"/)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it("keeps completed redraw receipts when a concurrent provider batch fails", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "ai-image-provider-failure-test-"))
    try {
      const inputPath = path.join(temporary, "source.png")
      const outputDirectory = path.join(temporary, "output")
      const source = await sharp({
        create: { width: 96, height: 64, channels: 4, background: "#eeeeee" },
      })
        .png()
        .toBuffer()
      await writeFile(inputPath, source)

      const background = rasterElement({
        id: "failure-background",
        bbox: { x: 0, y: 0, width: 96, height: 64 },
        role: "background",
        decomposition: "keep-whole",
        zIndex: 0,
      })
      const first = {
        ...rasterElement({ id: "first", bbox: { x: 8, y: 8, width: 20, height: 20 } }),
        fidelity: "critical" as const,
      }
      const second = {
        ...rasterElement({ id: "second", bbox: { x: 60, y: 8, width: 20, height: 20 } }),
        fidelity: "critical" as const,
      }
      const vision: VisionAnalyzerPort = {
        analyze: async () => ({
          analysis: {
            canvasSummary: "failure fixture",
            backgroundDescription: "flat gray",
            elements: [background, first, second],
          },
          receipts: [receipt("vision-analysis", "vision-failure")],
        }),
      }
      let redrawCalls = 0
      const imageEditor: ImageEditPort = {
        edit: async (request) => {
          if (request.operation === "element-redraw") {
            redrawCalls += 1
            if (redrawCalls === 2) {
              await new Promise((resolve) => setTimeout(resolve, 10))
              throw new Error("quota exhausted")
            }
            return {
              image: request.image,
              receipt: receipt("element-redraw", "redraw-completed-before-failure"),
            }
          }
          throw new Error("background repair should not run after redraw failure")
        },
      }

      await assert.rejects(
        convertImageToEditable({
          inputPath,
          outputDirectory,
          visionAnalyzer: vision,
          imageEditor,
          redrawConcurrency: 2,
        }),
        /quota exhausted/,
      )
      const provenance = JSON.parse(
        await readFile(path.join(outputDirectory, "provenance.json"), "utf8"),
      ) as { calls: ProviderCallReceipt[] }
      assert.deepEqual(
        provenance.calls.map((item) => item.requestId),
        ["vision-failure", "redraw-completed-before-failure"],
      )
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
})

class FixtureImageEditor implements ImageEditPort {
  async edit(request: ImageEditRequest) {
    const bytes =
      request.operation === "element-redraw"
        ? await sharp({
            create: {
              width: request.image.width,
              height: request.image.height,
              channels: 4,
              background: "#ff00ff",
            },
          })
            .composite([
              {
                input: {
                  create: {
                    width: 30,
                    height: 25,
                    channels: 4,
                    background: "#0066cc",
                  },
                },
                left: 40,
                top: 40,
              },
            ])
            .png()
            .toBuffer()
        : await sharp({
            create: {
              width: request.image.width,
              height: request.image.height,
              channels: 4,
              background: "#ffffff",
            },
          })
            .png()
            .toBuffer()
    return {
      image: {
        bytes,
        mimeType: "image/png" as const,
        width: request.image.width,
        height: request.image.height,
      },
      receipt: receipt(
        request.operation,
        request.operation === "element-redraw" ? "image-1" : "image-2",
      ),
    }
  }
}

function rasterElement(input: {
  id: string
  bbox: AnalyzedElement["logicalBBox"]
  parentId?: string | null
  role?: AnalyzedElement["role"]
  decomposition?: AnalyzedElement["decomposition"]
  zIndex?: number
}): AnalyzedElement {
  return {
    id: input.id,
    name: input.id,
    kind: "raster-layer",
    role: input.role ?? "foreground",
    parentId: input.parentId ?? null,
    decomposition: input.decomposition ?? "split-leaf",
    editValue: "high",
    fidelityRisk: "medium",
    zIndex: input.zIndex ?? 1,
    logicalBBox: input.bbox,
    text: "",
    fontSize: 0,
    fontWeight: 400,
    fill: "#000000",
    textAlign: "start",
    rotationDegrees: 0,
    confidence: 0.95,
    description: input.id,
    fidelity: "standard",
  }
}

function receipt(
  operation: ProviderCallReceipt["operation"],
  requestId: string,
): ProviderCallReceipt {
  return {
    requestId,
    provider: "openai",
    model: operation === "vision-analysis" ? "gpt-5.6" : "gpt-image-2",
    operation,
    createdAt: "2026-08-18T00:00:00.000Z",
    durationMs: 1,
    usage: {},
  }
}
