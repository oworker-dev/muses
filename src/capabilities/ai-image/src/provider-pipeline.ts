import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import type {
  AnalyzedElement,
  BoundingBoxV1,
  ImageEditPort,
  ProviderBackedSceneElement,
  ProviderBackedSceneManifest,
  ProviderCallReceipt,
  RasterImage,
  VisionAnalyzerPort,
} from "./pipeline-contracts.js"
import {
  chromaKeyToAlpha,
  createEditRepairCanvas,
  createSparseElementCanvas,
  cropImage,
  DEFAULT_CHROMA_KEY,
  detectAlphaBBox,
  expandBBox,
  normalizeModelOutput,
  prepareSourceImage,
  removeAlphaRegions,
  removeTextPixels,
} from "./raster-processor.js"
import { assembleEditableSvg } from "./svg-assembler.js"

export type ProviderBackedConversionOptions = {
  readonly inputPath: string
  readonly outputDirectory: string
  readonly visionAnalyzer: VisionAnalyzerPort
  readonly imageEditor: ImageEditPort
  readonly quality?: "low" | "medium" | "high" | "auto"
  /** Maximum number of independent element redraw edits in flight. */
  readonly redrawConcurrency?: number
  readonly force?: boolean
  readonly signal?: AbortSignal
}

export type ProviderBackedConversionResult = {
  readonly manifest: ProviderBackedSceneManifest
  readonly qa: ReconstructionQa
  readonly outputDirectory: string
}

type ReconstructionQa = {
  readonly schemaVersion: "1.0"
  readonly source: { readonly width: number; readonly height: number }
  readonly rendered: { readonly width: number; readonly height: number }
  readonly structure: {
    readonly textElements: number
    readonly visibleTextElements: number
    readonly rasterElements: number
    readonly renderedRasterElements: number
  }
  readonly pixels: {
    readonly nonBlank: boolean
    readonly meanAbsoluteError: number
    readonly similarity: number
  }
  readonly chroma: {
    readonly detectedKey: { readonly r: number; readonly g: number; readonly b: number }
    readonly transparentCoverage: number
  }
  readonly elements: readonly {
    readonly id: string
    readonly sceneRole?: AnalyzedElement["sceneRole"]
    readonly critical: boolean
    readonly aspectRatioDrift: number
    readonly keyLeakage: number
    readonly opaqueEdgeCoverage: number
    readonly sourceVisualSimilarity?: number
    readonly scaleDrift?: number
    readonly touchesGenerationBoundary: boolean
    readonly status: "passed" | "failed"
    readonly failures: readonly string[]
  }[]
  readonly checks: Readonly<Record<string, boolean>>
}

export async function convertImageToEditable(
  options: ProviderBackedConversionOptions,
): Promise<ProviderBackedConversionResult> {
  const output = path.resolve(options.outputDirectory)
  if (!options.force && (await exists(path.join(output, "editable.svg")))) {
    throw new Error(`Output already contains editable.svg: ${output}`)
  }
  await createOutputDirectories(output)

  const sourceBytes = await readFile(options.inputPath)
  const prepared = await prepareSourceImage(sourceBytes)
  const sourceSha256 = sha256(prepared.original.bytes)
  await writeFile(path.join(output, "inputs/source.png"), prepared.original.bytes)
  await writeFile(path.join(output, "inputs/source-padded.png"), prepared.modelInput.bytes)

  const receipts: ProviderCallReceipt[] = []
  let tileIndex = 0
  const analysisResult = await options.visionAnalyzer.analyze({
    image: prepared.original,
    ...(options.signal ? { signal: options.signal } : {}),
    onPartialResult: async (partial) => {
      tileIndex += 1
      receipts.push(partial.receipt)
      await writeJson(
        path.join(output, `analysis-tiles/${String(tileIndex).padStart(3, "0")}.json`),
        { schemaVersion: "1.0", ...partial },
      )
      await writeJson(path.join(output, "provenance.json"), { calls: receipts })
    },
  })
  for (const receipt of analysisResult.receipts) {
    if (!receipts.some((candidate) => candidate.requestId === receipt.requestId)) {
      receipts.push(receipt)
    }
  }
  await writeJson(path.join(output, "analysis.json"), {
    schemaVersion: "1.0",
    analysis: analysisResult.analysis,
    receipts: analysisResult.receipts,
  })
  await writeJson(path.join(output, "provenance.json"), { calls: receipts })

  const workingElements = analysisResult.analysis.elements
  const hierarchyWarnings = validateHierarchy(workingElements)
  const backgroundElement = selectBackgroundElement(
    workingElements,
    prepared.original.width,
    prepared.original.height,
  )
  const backgroundElementIds = new Set(
    backgroundElement ? [backgroundElement.id] : [],
  )
  const repairCanvas = await createEditRepairCanvas({
    source: prepared.modelInput,
    elements: workingElements,
    excludedElementIds: backgroundElementIds,
  })
  await writeFile(path.join(output, "inputs/background-repair.png"), repairCanvas.bytes)

  const rasterElements = workingElements.filter(
    (element) =>
      element.kind === "raster-layer" && element.id !== backgroundElement?.id,
  )
  const size = `${prepared.modelInput.width}x${prepared.modelInput.height}` as const
  const allRasterIds = new Set(rasterElements.map((element) => element.id))
  const sparsePreview = await createSparseElementCanvas({
    source: prepared.modelInput,
    elements: workingElements,
    activeElementIds: allRasterIds,
  })
  await writeFile(
    path.join(output, "inputs/elements-sparse.png"),
    sparsePreview.image.bytes,
  )

  const redrawByElement = new Map<
    string,
    {
      readonly image: RasterImage
      readonly reference: RasterImage
      readonly generationBBox: BoundingBoxV1
      readonly origin: { readonly x: number; readonly y: number }
      readonly depth: number
    }
  >()
  const chromaStats: Array<{
    readonly detectedKey: { readonly r: number; readonly g: number; readonly b: number }
    readonly transparentCoverage: number
  }> = []
  const redrawBatches = rasterRedrawBatches(
    rasterElements,
    workingElements,
    prepared.modelInput,
  )
  type RedrawBatchResult = {
    readonly batch: (typeof redrawBatches)[number]
    readonly sparse: Awaited<ReturnType<typeof createSparseElementCanvas>>
    readonly redrawResult: Awaited<ReturnType<ImageEditPort["edit"]>>
    readonly alphaResult: Awaited<ReturnType<typeof chromaKeyToAlpha>>
    readonly alphaWithoutText: RasterImage
  }
  const partialRedrawReceipts = new Map<number, ProviderCallReceipt>()
  let redrawResults: RedrawBatchResult[]
  try {
    redrawResults = await mapByDepth(
      redrawBatches,
      clampConcurrency(options.redrawConcurrency ?? 3),
      async (batch, batchIndex) => {
      const label = String(batch.depth).padStart(2, "0")
      const batchLabel = `${label}-batch-${String(batchIndex + 1).padStart(2, "0")}`
      const activeElementIds = new Set(batch.elements.map((element) => element.id))
      const sparse = await createSparseElementCanvas({
        source: prepared.modelInput,
        elements: workingElements,
        activeElementIds,
        region: batch.region,
      })
      await writeFile(
        path.join(output, `inputs/elements-depth-${batchLabel}.png`),
        sparse.image.bytes,
      )
      const redrawResult = await options.imageEditor.edit({
        operation: "element-redraw",
        image: sparse.image,
        prompt: redrawPrompt(
          batch.elements,
          DEFAULT_CHROMA_KEY,
          batch.depth,
          sparse.origin,
        ),
        size: `${sparse.image.width}x${sparse.image.height}` as `${number}x${number}`,
        quality: options.quality ?? "medium",
        ...(options.signal ? { signal: options.signal } : {}),
      })
      partialRedrawReceipts.set(batchIndex, redrawResult.receipt)
      const redrawNormalized = await normalizeModelOutput(
        redrawResult.image,
        sparse.image.width,
        sparse.image.height,
        { preserveAspectRatio: true, background: DEFAULT_CHROMA_KEY },
      )
      await writeFile(
        path.join(output, `model/element-redraw-depth-${batchLabel}-chroma.png`),
        redrawNormalized.bytes,
      )
      const alphaResult = await chromaKeyToAlpha({
        image: redrawNormalized,
        expectedKey: DEFAULT_CHROMA_KEY,
      })
      const alphaWithoutText = await removeTextPixels(
        alphaResult.image,
        batch.elements.map((element) => translateElement(element, sparse.origin, -1)),
      )
      await writeFile(
        path.join(output, `model/element-redraw-depth-${batchLabel}-alpha.png`),
        alphaWithoutText.bytes,
      )
      return {
        batch,
        sparse,
        redrawResult,
        alphaResult,
        alphaWithoutText,
      }
      },
    )
  } catch (error) {
    for (const receipt of [...partialRedrawReceipts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, receipt]) => receipt)) {
      receipts.push(receipt)
    }
    await writeJson(path.join(output, "provenance.json"), { calls: receipts })
    throw error
  }
  for (const result of redrawResults) {
    receipts.push(result.redrawResult.receipt)
    chromaStats.push(result.alphaResult)
    for (const element of result.batch.elements) {
      const generationBBox = result.sparse.generationBoxes[element.id]
      if (generationBBox) {
        redrawByElement.set(element.id, {
          image: result.alphaWithoutText,
          reference: result.sparse.image,
          generationBBox,
          origin: result.sparse.origin,
          depth: result.batch.depth,
        })
      }
    }
  }
  await writeJson(path.join(output, "provenance.json"), { calls: receipts })

  const inpaintResult = await options.imageEditor.edit({
    operation: "background-repair",
    image: repairCanvas,
    prompt: backgroundRepairPrompt(analysisResult.analysis.backgroundDescription),
    size,
    quality: options.quality ?? "medium",
    ...(options.signal ? { signal: options.signal } : {}),
  })
  receipts.push(inpaintResult.receipt)
  const inpaintNormalized = await normalizeModelOutput(
    inpaintResult.image,
    prepared.modelInput.width,
    prepared.modelInput.height,
  )
  await writeFile(
    path.join(output, "model/clean-background-padded.png"),
    inpaintNormalized.bytes,
  )
  await writeJson(path.join(output, "provenance.json"), { calls: receipts })

  const cleanBackground = await cropImage(inpaintNormalized, {
    x: 0,
    y: 0,
    width: prepared.original.width,
    height: prepared.original.height,
  })
  const backgroundRelativePath = "assets/clean-background.png"
  await writeFile(path.join(output, backgroundRelativePath), cleanBackground.bytes)

  const rasterAssets: Record<string, RasterImage> = {}
  const sceneElements: ProviderBackedSceneElement[] = []
  const warnings: string[] = [...hierarchyWarnings]
  if (backgroundElement) {
    warnings.push(`${backgroundElement.id}: promoted-to-editable-background`)
  }

  for (const element of workingElements) {
    if (element.kind === "text") {
      sceneElements.push({
        id: element.id,
        name: element.name,
        type: "text",
        role: element.role,
        sceneRole: element.sceneRole,
        parentId: element.parentId,
        decomposition: element.decomposition,
        editValue: element.editValue,
        fidelityRisk: element.fidelityRisk,
        zIndex: element.zIndex,
        logicalBBox: element.logicalBBox,
        text: {
          value: element.text,
          fontSize: element.fontSize,
          fontWeight: element.fontWeight,
          fill: element.fill,
          textAlign: element.textAlign,
        },
        confidence: element.confidence,
        warnings: element.confidence < 0.7 ? ["low-analysis-confidence"] : [],
      })
      continue
    }
    if (element.id === backgroundElement?.id) continue

    const redraw = redrawByElement.get(element.id)
    if (!redraw) {
      warnings.push(`${element.id}: missing-generation-bbox`)
      continue
    }
    const residualImage = await removeAlphaRegions(
      redraw.image,
      descendantsOfElement(element, workingElements).map((descendant) =>
        expandBBox(
          translateBBox(descendant.logicalBBox, redraw.origin, -1),
          3,
          redraw.image.width,
          redraw.image.height,
        ),
      ),
    )
    const detectedLocalBBox =
      (await detectAlphaBBox(
        residualImage,
        translateBBox(redraw.generationBBox, redraw.origin, -1),
      )) ??
      (await detectAlphaBBox(
        residualImage,
        detectionSearchBBox(
          translateBBox(redraw.generationBBox, redraw.origin, -1),
          residualImage.width,
          residualImage.height,
        ),
      ))
    const modelCandidate = detectedLocalBBox
      ? await modelRasterCandidate({
          element,
          redraw,
          residualImage,
          detectedLocalBBox,
          reference: redraw.reference,
        })
      : undefined
    const modelFailures = modelCandidate
      ? modelCandidate.qa.failures
      : ["redraw-not-detected"]
    const useSourceFallback = modelFailures.length > 0
    const sourceFallback = useSourceFallback
      ? await createSourcePreservingFallback(
          prepared.modelInput,
          element,
          workingElements,
          redraw.origin,
        )
      : undefined
    if (useSourceFallback && sourceFallback) {
      warnings.push(
        `${element.id}: source-preserving-fallback:${modelFailures.join(",")}`,
      )
    }
    if (!modelCandidate && !sourceFallback) {
      warnings.push(`${element.id}: redraw-not-detected`)
      sceneElements.push({
        id: element.id,
        name: element.name,
        type: "raster-layer",
        role: element.role,
        sceneRole: element.sceneRole,
        parentId: element.parentId,
        decomposition: element.decomposition,
        editValue: element.editValue,
        fidelityRisk: element.fidelityRisk,
        zIndex: element.zIndex,
        logicalBBox: element.logicalBBox,
        generationBBox: redraw.generationBBox,
        confidence: element.confidence,
        warnings: ["redraw-not-detected"],
      })
      continue
    }
    const asset = sourceFallback?.asset ?? modelCandidate!.asset
    const detectedBBox = sourceFallback?.detectedBBox ?? modelCandidate!.detectedBBox
    const cropBBox = sourceFallback?.cropBBox ?? modelCandidate!.cropBBox
    const placement = sourceFallback?.placement ?? modelCandidate!.placement
    const touchesGenerationBoundary = modelCandidate?.touchesGenerationBoundary ?? false
    rasterAssets[element.id] = asset
    const relativePath = `assets/elements/${element.id}.png`
    await writeFile(path.join(output, relativePath), asset.bytes)
    sceneElements.push({
      id: element.id,
      name: element.name,
      type: "raster-layer",
      role: element.role,
      sceneRole: element.sceneRole,
      parentId: element.parentId,
      decomposition: element.decomposition,
      editValue: element.editValue,
      fidelityRisk: element.fidelityRisk,
      zIndex: element.zIndex,
      logicalBBox: element.logicalBBox,
      generationBBox: redraw.generationBBox,
      detectedBBox,
      cropBBox: translateBBox(cropBBox, redraw.origin, 1),
      placementBBox: placement.box,
      aspectRatioDrift: placement.aspectRatioDrift,
      scaleDrift: modelCandidate?.scaleDrift ?? 0,
      assetMode: sourceFallback ? "source-preserving-fallback" : "model-redraw",
      asset: {
        path: relativePath,
        sha256: sha256(asset.bytes),
        width: asset.width,
        height: asset.height,
      },
      confidence: element.confidence,
      warnings: [
        ...(sourceFallback ? ["source-preserving-fallback"] : []),
        ...(element.fidelity === "critical" ? ["critical-fidelity-review"] : []),
        ...(modelFailures.length > 0
          ? modelFailures.map((failure) => `model-${failure}`)
          : []),
        ...(placement.aspectRatioDrift > 0.12 ? ["aspect-ratio-drift"] : []),
        ...((modelCandidate?.scaleDrift ?? 0) > 0.25 ? ["scale-drift"] : []),
        ...(touchesGenerationBoundary ? ["generation-boundary-touch"] : []),
      ],
    })
  }

  const transparentCoverage =
    chromaStats.length === 0
      ? 1
      : chromaStats.reduce(
          (sum, candidate) => sum + candidate.transparentCoverage,
          0,
        ) / chromaStats.length
  const detectedKey = chromaStats[0]?.detectedKey ?? DEFAULT_CHROMA_KEY
  if (chromaStats.some((candidate) => candidate.transparentCoverage < 0.5)) {
    warnings.push("chroma-background-coverage-below-expected")
  }
  const renderedRasterElements = Object.keys(rasterAssets).length
  if (renderedRasterElements < rasterElements.length) {
    warnings.push("one-or-more-raster-elements-missing-after-redraw")
  }
  if (sceneElements.some((element) => element.assetMode === "source-preserving-fallback")) {
    warnings.push("source-preserving-fallback-retains-source-text-under-covered-svg-text")
  }

  const svg = assembleEditableSvg({
    width: prepared.original.width,
    height: prepared.original.height,
    background: cleanBackground,
    analysisElements: workingElements,
    sceneElements,
    rasterAssets,
  })
  await writeFile(path.join(output, "editable.svg"), svg, "utf8")
  const previewBytes = await sharp(Buffer.from(svg)).png().toBuffer()
  await writeFile(path.join(output, "preview.png"), previewBytes)

  const qa = await buildQa({
    source: prepared.original,
    preview: {
      bytes: previewBytes,
      mimeType: "image/png",
      width: prepared.original.width,
      height: prepared.original.height,
    },
    textElements: workingElements.filter(
      (element) => element.kind === "text",
    ).length,
    rasterElements: rasterElements.length,
    renderedRasterElements,
    transparentCoverage,
    detectedKey,
    receipts,
    analysisElements: workingElements,
    sceneElements,
    rasterAssets,
  })
  await writeJson(path.join(output, "qa.json"), qa)

  const manifest: ProviderBackedSceneManifest = {
    schemaVersion: "1.0",
    capability: "image.to-editable.v1",
    qualityStatus: Object.values(qa.checks).every(Boolean) ? "passed" : "partial",
    source: {
      name: path.basename(options.inputPath),
      sha256: sourceSha256,
      width: prepared.original.width,
      height: prepared.original.height,
    },
    canvas: {
      width: prepared.original.width,
      height: prepared.original.height,
      colorSpace: "srgb",
    },
    background: {
      path: backgroundRelativePath,
      sha256: sha256(cleanBackground.bytes),
      ...(backgroundElement ? { sourceElementId: backgroundElement.id } : {}),
    },
    elements: sceneElements,
    exports: { svg: "editable.svg", preview: "preview.png" },
    provenance: { mode: "provider-backed-spike", calls: receipts },
    warnings,
  }
  await writeJson(path.join(output, "scene-manifest.json"), manifest)

  return { manifest, qa, outputDirectory: output }
}

function redrawPrompt(
  elements: readonly AnalyzedElement[],
  key: { readonly r: number; readonly g: number; readonly b: number },
  depth: number,
  origin: { readonly x: number; readonly y: number },
) {
  const inventory = elements
    .map(
      (element) =>
        `- ${element.id}: parent=${element.parentId ?? "root"}; global-bbox=${JSON.stringify(element.logicalBBox)}; local-bbox=${JSON.stringify(translateBBox(element.logicalBBox, origin, -1))}; sceneRole=${element.sceneRole ?? "legacy"}; strategy=${element.decomposition}; editValue=${element.editValue}; description=${element.description}; fidelity=${element.fidelity}`,
    )
    .join("\n")
  const keyHex = `#${[key.r, key.g, key.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`
  return `This image is a local sparse reconstruction canvas for hierarchy-depth ${depth}, offset from the source canvas by (${origin.x},${origin.y}). It contains only the listed raster elements as rectangular source crops at their local positions on a flat ${keyHex} chroma-key background.

For every listed crop, identify and faithfully redraw only its intended non-text foreground element. Parent crops have already had child regions replaced by chroma and must remain residual parent layers; do not recreate child content in a parent crop. Remove rectangular crop backgrounds, seams, and all text. Keep each element at the same global position, scale, shape, colors, and relative geometry. Do not merge elements, move them, add objects, recreate page text, or draw shadows outside the source element.

Return the same-size local image. Every pixel outside the redrawn foreground elements must be exactly one perfectly flat solid ${keyHex}, with no texture, gradient, lighting, noise, or shadow. Do not use ${keyHex} inside the elements unless it is indispensable source content. Preserve each element's original aspect ratio and full visible footprint; do not crop, stretch, rotate, merge, or substitute unrelated shapes. White or colored rectangular crop backgrounds are forbidden. Transparent-looking holes inside rings and charts must remain key-colored so the deterministic postprocessor can remove them.

Element inventory:\n${inventory}`
}

function selectBackgroundElement(
  elements: readonly AnalyzedElement[],
  width: number,
  height: number,
) {
  const candidates = elements.filter(
    (element) =>
      element.kind === "raster-layer" &&
      element.role === "background" &&
      element.parentId === null &&
      element.decomposition === "keep-whole" &&
      (element.sceneRole === "background-field" ||
        (element.sceneRole === undefined &&
          bboxArea(element.logicalBBox) / (width * height) >= 0.92)),
  )
  if (candidates.length > 0) {
    return candidates.sort(
      (left, right) => bboxArea(right.logicalBBox) - bboxArea(left.logicalBBox),
    )[0]
  }
  return elements.find(
    (element) =>
      element.kind === "raster-layer" &&
      element.parentId === null &&
      element.decomposition === "keep-whole" &&
      element.sceneRole === "background-field" &&
      bboxArea(element.logicalBBox) / (width * height) >= 0.8,
  )
}

function rasterRedrawBatches(
  rasterElements: readonly AnalyzedElement[],
  allElements: readonly AnalyzedElement[],
  source: RasterImage,
) {
  const byId = new Map(allElements.map((element) => [element.id, element]))
  const byDepth = new Map<number, AnalyzedElement[]>()
  for (const element of rasterElements) {
    const depth = hierarchyDepth(element, byId)
    const group = byDepth.get(depth) ?? []
    group.push(element)
    byDepth.set(depth, group)
  }
  const batches: Array<{
    readonly depth: number
    readonly elements: readonly AnalyzedElement[]
    readonly region: BoundingBoxV1
  }> = []
  for (const [depth, elements] of [...byDepth.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    const pending = elements.slice()
    while (pending.length > 0) {
      const seed = pending.shift()!
      const isolated =
        seed.fidelity === "critical" || seed.sceneRole === "bounded-artwork"
      const batch = [seed]
      if (!isolated) {
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const candidate = pending[index]!
          const sameParent =
            seed.parentId !== null && candidate.parentId === seed.parentId
          const sameContext =
            sameParent || boxesNear(candidate.logicalBBox, seed.logicalBBox, 20)
          if (sameContext && batch.length < 6) {
            batch.push(candidate)
            pending.splice(index, 1)
          }
        }
      }
      batches.push({
        depth,
        elements: batch,
        region: batch.some((element) => element.sceneRole)
          ? batchRegion(batch, source.width, source.height)
          : { x: 0, y: 0, width: source.width, height: source.height },
      })
    }
  }
  return batches
}

function batchRegion(
  elements: readonly AnalyzedElement[],
  width: number,
  height: number,
) {
  const union = elements.reduce<BoundingBoxV1 | undefined>((current, element) => {
    const box = expandBBox(element.logicalBBox, 18, width, height)
    if (!current) return box
    const right = Math.max(current.x + current.width, box.x + box.width)
    const bottom = Math.max(current.y + current.height, box.y + box.height)
    const x = Math.min(current.x, box.x)
    const y = Math.min(current.y, box.y)
    return { x, y, width: right - x, height: bottom - y }
  }, undefined)
  return union ?? { x: 0, y: 0, width, height }
}

function boxesNear(left: BoundingBoxV1, right: BoundingBoxV1, margin: number) {
  return !(
    left.x + left.width + margin < right.x ||
    right.x + right.width + margin < left.x ||
    left.y + left.height + margin < right.y ||
    right.y + right.height + margin < left.y
  )
}

function clampConcurrency(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(8, Math.floor(value)))
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      results[index] = await mapper(values[index]!, index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  )
  return results
}

/** Keep hierarchy depths ordered while allowing independent siblings to overlap. */
async function mapByDepth<T extends { readonly depth: number }, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results: R[] = []
  let start = 0
  while (start < values.length) {
    const depth = values[start]!.depth
    let end = start + 1
    while (end < values.length && values[end]!.depth === depth) end += 1
    const depthResults = await mapWithConcurrency(
      values.slice(start, end),
      concurrency,
      (value, offset) => mapper(value, start + offset),
    )
    results.push(...depthResults)
    start = end
  }
  return results
}

function touchesBBoxBoundary(inner: BoundingBoxV1, outer: BoundingBoxV1) {
  const tolerance = 1
  return (
    inner.x <= outer.x + tolerance ||
    inner.y <= outer.y + tolerance ||
    inner.x + inner.width >= outer.x + outer.width - tolerance ||
    inner.y + inner.height >= outer.y + outer.height - tolerance
  )
}

function hierarchyDepth(
  element: AnalyzedElement,
  byId: ReadonlyMap<string, AnalyzedElement>,
) {
  let depth = 0
  let current: AnalyzedElement | undefined = element
  const visited = new Set<string>()
  while (current.parentId) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    current = byId.get(current.parentId)
    if (!current) break
    depth += 1
  }
  return depth
}

function descendantsOfElement(
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

function calculatePlacementBBox(
  logicalBBox: BoundingBoxV1,
  detectedBBox: BoundingBoxV1,
  cropBBox: BoundingBoxV1,
): { readonly box: BoundingBoxV1; readonly aspectRatioDrift: number } {
  const scaleX = logicalBBox.width / detectedBBox.width
  const scaleY = logicalBBox.height / detectedBBox.height
  const aspectRatioDrift = Math.abs(Math.log(Math.max(0.0001, scaleX / scaleY)))
  if (aspectRatioDrift <= 0.12) {
    return {
      box: {
        x: round(logicalBBox.x - (detectedBBox.x - cropBBox.x) * scaleX, 4),
        y: round(logicalBBox.y - (detectedBBox.y - cropBBox.y) * scaleY, 4),
        width: round(cropBBox.width * scaleX, 4),
        height: round(cropBBox.height * scaleY, 4),
      },
      aspectRatioDrift,
    }
  }
  // Do not legalize a malformed model output by stretching it. Keep a uniform
  // scale and center the result in the logical slot; QA will fail the element
  // so the caller can retry it with a stricter redraw policy.
  const scale = Math.min(scaleX, scaleY)
  const width = cropBBox.width * scale
  const height = cropBBox.height * scale
  return {
    box: {
      x: round(logicalBBox.x + (logicalBBox.width - width) / 2, 4),
      y: round(logicalBBox.y + (logicalBBox.height - height) / 2, 4),
      width: round(width, 4),
      height: round(height, 4),
    },
    aspectRatioDrift,
  }
}

type ModelRasterCandidate = {
  readonly asset: RasterImage
  readonly detectedBBox: BoundingBoxV1
  readonly cropBBox: BoundingBoxV1
  readonly placement: {
    readonly box: BoundingBoxV1
    readonly aspectRatioDrift: number
  }
  readonly scaleDrift: number
  readonly touchesGenerationBoundary: boolean
  readonly qa: Awaited<ReturnType<typeof analyzeRasterAsset>>
}

async function modelRasterCandidate(input: {
  element: AnalyzedElement
  redraw: {
    readonly generationBBox: BoundingBoxV1
    readonly origin: { readonly x: number; readonly y: number }
  }
  residualImage: RasterImage
  detectedLocalBBox: BoundingBoxV1
  reference: RasterImage
}): Promise<ModelRasterCandidate> {
  const detectedBBox = translateBBox(input.detectedLocalBBox, input.redraw.origin, 1)
  const touchesGenerationBoundary = touchesBBoxBoundary(
    detectedBBox,
    input.redraw.generationBBox,
  )
  const cropBBox = expandBBox(
    input.detectedLocalBBox,
    2,
    input.residualImage.width,
    input.residualImage.height,
  )
  const asset = await cropImage(input.residualImage, cropBBox)
  const placement = calculatePlacementBBox(
    input.element.logicalBBox,
    detectedBBox,
    translateBBox(cropBBox, input.redraw.origin, 1),
  )
  const scaleDrift = calculateScaleDrift(
    input.element.logicalBBox,
    detectedBBox,
  )
  const referenceCrop = await cropImage(
    await chromaKeyToAlpha({
      image: await cropImage(
        input.reference,
        translateBBox(input.redraw.generationBBox, input.redraw.origin, -1),
      ),
      expectedKey: DEFAULT_CHROMA_KEY,
    }).then((result) => result.image),
    {
      x: 0,
      y: 0,
      width: Math.min(
        input.reference.width,
        input.redraw.generationBBox.width,
      ),
      height: Math.min(
        input.reference.height,
        input.redraw.generationBBox.height,
      ),
    },
  )
  const sourceVisualSimilarity = await compareRasterAppearance(
    referenceCrop,
    asset,
  )
  const qa = await analyzeRasterAsset({
    id: input.element.id,
    sceneRole: input.element.sceneRole,
    critical: input.element.fidelity === "critical",
    aspectRatioDrift: placement.aspectRatioDrift,
    touchesGenerationBoundary,
    asset,
    key: DEFAULT_CHROMA_KEY,
    sourceVisualSimilarity,
    scaleDrift,
  })
  return {
    asset,
    detectedBBox,
    cropBBox,
    placement,
    scaleDrift,
    touchesGenerationBoundary,
    qa,
  }
}

async function createSourcePreservingFallback(
  source: RasterImage,
  element: AnalyzedElement,
  elements: readonly AnalyzedElement[],
  origin: { readonly x: number; readonly y: number },
) {
  const region = expandBBox(element.logicalBBox, 0, source.width, source.height)
  const sparse = await createSparseElementCanvas({
    source,
    elements,
    activeElementIds: new Set([element.id]),
    maskText: false,
    maskDescendants: false,
    region,
  })
  const keyed = await chromaKeyToAlpha({
    // Keep the exact source crop in this emergency path. Covered SVG text is
    // hidden by the assembler, so approximate glyph removal would create
    // outlines and halos on anti-aliased Chinese text.
    image: sparse.image,
    expectedKey: DEFAULT_CHROMA_KEY,
  })
  const placementBox = {
    x: sparse.origin.x,
    y: sparse.origin.y,
    width: sparse.image.width,
    height: sparse.image.height,
  }
  return {
    asset: keyed.image,
    detectedBBox: element.logicalBBox,
    // This is local to the redraw region; the caller translates it back to
    // global canvas coordinates when serializing the scene manifest.
    cropBBox: {
      x: sparse.origin.x - origin.x,
      y: sparse.origin.y - origin.y,
      width: sparse.image.width,
      height: sparse.image.height,
    },
    placement: { box: placementBox, aspectRatioDrift: 0 },
  }
}

function detectionSearchBBox(
  generationBBox: BoundingBoxV1,
  width: number,
  height: number,
) {
  const margin = Math.max(
    24,
    Math.min(64, Math.ceil(Math.max(generationBBox.width, generationBBox.height) * 0.08)),
  )
  return expandBBox(generationBBox, margin, width, height)
}

function translateBBox(
  box: BoundingBoxV1,
  origin: { readonly x: number; readonly y: number },
  direction: 1 | -1,
): BoundingBoxV1 {
  return {
    x: box.x + direction * origin.x,
    y: box.y + direction * origin.y,
    width: box.width,
    height: box.height,
  }
}

function translateElement(
  element: AnalyzedElement,
  origin: { readonly x: number; readonly y: number },
  direction: 1 | -1,
): AnalyzedElement {
  return {
    ...element,
    logicalBBox: translateBBox(element.logicalBBox, origin, direction),
  }
}

function bboxArea(box: BoundingBoxV1) {
  return box.width * box.height
}

function backgroundRepairPrompt(backgroundDescription: string) {
  return `This is an Edit-only background repair request. The input image contains flat #ff00ff rectangles where editable text and foreground visual elements were locally removed. Repair only those #ff00ff regions so that the surrounding background continues naturally. Remove every trace of #ff00ff and do not add replacement words, icons, charts, illustrations, buildings, waves, decorative lines, or frames.

Preserve every unmarked pixel and the exact canvas geometry. Do not invent new objects. Background guidance: ${backgroundDescription}`
}

function validateHierarchy(elements: readonly AnalyzedElement[]) {
  const ids = new Set(elements.map((element) => element.id))
  const warnings: string[] = []
  const backgroundElements = elements.filter(
    (element) => element.role === "background",
  )
  if (backgroundElements.length > 1) {
    warnings.push("multiple-background-elements-detected")
  }
  for (const element of elements) {
    if (element.role === "background" && element.kind !== "raster-layer") {
      warnings.push(`${element.id}: non-raster-background-rejected`)
    }
    if (element.role === "background" && element.parentId) {
      warnings.push(`${element.id}: nested-background-rejected`)
    }
    if (
      element.role === "background" &&
      element.decomposition !== "keep-whole"
    ) {
      warnings.push(`${element.id}: split-background-rejected`)
    }
    if (element.sceneRole === "background-field" && element.role !== "background") {
      warnings.push(`${element.id}: background-field-with-foreground-role`)
    }
    if (element.role === "background" && element.sceneRole === "bounded-artwork") {
      warnings.push(`${element.id}: bounded-artwork-promoted-to-foreground`)
    }
    if (!element.parentId) continue
    if (!ids.has(element.parentId)) warnings.push(`${element.id}: parent-not-found`)
    if (element.parentId === element.id) warnings.push(`${element.id}: self-parent-rejected`)
  }
  return warnings
}

async function buildQa(input: {
  source: RasterImage
  preview: RasterImage
  textElements: number
  rasterElements: number
  renderedRasterElements: number
  transparentCoverage: number
  detectedKey: { readonly r: number; readonly g: number; readonly b: number }
  receipts: readonly ProviderCallReceipt[]
  analysisElements: readonly AnalyzedElement[]
  sceneElements: readonly ProviderBackedSceneElement[]
  rasterAssets: Readonly<Record<string, RasterImage>>
}): Promise<ReconstructionQa> {
  const sourceRaw = await sharp(input.source.bytes)
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer()
  const previewRaw = await sharp(input.preview.bytes)
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer()
  let difference = 0
  let nonBlank = false
  for (let index = 0; index < sourceRaw.length; index += 1) {
    difference += Math.abs((sourceRaw[index] ?? 0) - (previewRaw[index] ?? 0))
    if ((previewRaw[index] ?? 255) < 250) nonBlank = true
  }
  const meanAbsoluteError = difference / Math.max(1, sourceRaw.length)
  const operations = new Set(input.receipts.map((receipt) => receipt.operation))
  const analysisById = new Map(input.analysisElements.map((element) => [element.id, element]))
  const elementQa = await Promise.all(
    input.sceneElements
      .filter((element) => element.type === "raster-layer")
      .map(async (element) => {
        const asset = input.rasterAssets[element.id]
        const analysis = analysisById.get(element.id)
        if (!asset) {
          return {
            id: element.id,
            sceneRole: element.sceneRole,
            critical: analysis?.fidelity === "critical",
            aspectRatioDrift: element.aspectRatioDrift ?? 1,
            keyLeakage: 1,
            opaqueEdgeCoverage: 1,
            touchesGenerationBoundary: true,
            status: "failed" as const,
            failures: ["missing-asset"],
          }
        }
        return analyzeRasterAsset({
          id: element.id,
          sceneRole: element.sceneRole,
          critical: analysis?.fidelity === "critical",
          aspectRatioDrift: element.aspectRatioDrift ?? 0,
          ...(element.scaleDrift !== undefined
            ? { scaleDrift: element.scaleDrift }
            : {}),
          touchesGenerationBoundary: Boolean(
            element.generationBBox &&
              element.detectedBBox &&
              touchesBBoxBoundary(element.detectedBBox, element.generationBBox),
          ),
          asset,
          key: input.detectedKey,
        })
      }),
  )
  const elementQualityPassed = elementQa.every((element) => element.status === "passed")
  const sourceFallbacks = input.sceneElements.filter(
    (element) => element.assetMode === "source-preserving-fallback",
  )
  const visibleTextElements = input.analysisElements.filter(
    (element) =>
      element.kind === "text" &&
      !sourceFallbacks.some((fallback) =>
        boxesOverlap(fallback.placementBBox ?? fallback.logicalBBox, element.logicalBBox),
      ),
  ).length
  const boundedArtworkWasBackground = input.analysisElements.some(
    (element) => element.sceneRole === "bounded-artwork" && element.role === "background",
  )
  return {
    schemaVersion: "1.0",
    source: { width: input.source.width, height: input.source.height },
    rendered: { width: input.preview.width, height: input.preview.height },
    structure: {
      textElements: input.textElements,
      visibleTextElements,
      rasterElements: input.rasterElements,
      renderedRasterElements: input.renderedRasterElements,
    },
    pixels: {
      nonBlank,
      meanAbsoluteError: round(meanAbsoluteError, 4),
      similarity: round(Math.max(0, 1 - meanAbsoluteError / 255), 4),
    },
    chroma: {
      detectedKey: input.detectedKey,
      transparentCoverage: round(input.transparentCoverage, 4),
    },
    elements: elementQa,
    checks: {
      sameCanvasSize:
        input.source.width === input.preview.width &&
        input.source.height === input.preview.height,
      nonBlank,
      hasEditableText: input.textElements > 0,
      editableTextVisible: visibleTextElements > 0,
      hasRasterLayers: input.rasterElements > 0,
      detectedRasterLayers: input.renderedRasterElements > 0,
      hasRequiredProviderStages:
        operations.has("vision-analysis") &&
        operations.has("background-repair") &&
        (input.rasterElements === 0 || operations.has("element-redraw")),
      providerRequestIdsCaptured: input.receipts.every(
        (receipt) => receipt.requestId && receipt.requestId !== "unknown",
      ),
      renderSimilarityFloor: Math.round(Math.max(0, 1 - meanAbsoluteError / 255) * 10000) / 10000 >= 0.85,
      elementQualityPassed,
      criticalElementsPassed: elementQa
        .filter((element) => element.critical)
        .every((element) => element.status === "passed"),
      boundedArtworkNotSwallowedByBackground: !boundedArtworkWasBackground,
    },
  }
}

async function analyzeRasterAsset(input: {
  id: string
  sceneRole?: AnalyzedElement["sceneRole"]
  critical: boolean
  aspectRatioDrift: number
  scaleDrift?: number
  touchesGenerationBoundary: boolean
  asset: RasterImage
  key: { readonly r: number; readonly g: number; readonly b: number }
  sourceVisualSimilarity?: number
}) {
  const decoded = await sharp(input.asset.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const channels = decoded.info.channels
  const width = decoded.info.width
  const height = decoded.info.height
  const borderPixels: number[] = []
  let visible = 0
  let keyPixels = 0
  let opaqueBorder = 0
  const isBorder = (x: number, y: number) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels
      const alpha = decoded.data[offset + 3] ?? 0
      if (alpha <= 16) continue
      visible += 1
      const distance = Math.sqrt(
        ((decoded.data[offset] ?? 0) - input.key.r) ** 2 +
          ((decoded.data[offset + 1] ?? 0) - input.key.g) ** 2 +
          ((decoded.data[offset + 2] ?? 0) - input.key.b) ** 2,
      )
      if (distance < 72) keyPixels += 1
      if (isBorder(x, y)) {
        borderPixels.push(alpha)
        if (alpha >= 245) opaqueBorder += 1
      }
    }
  }
  const keyLeakage = keyPixels / Math.max(1, visible)
  const opaqueEdgeCoverage = opaqueBorder / Math.max(1, borderPixels.length)
  const failures: string[] = []
  if (visible === 0) failures.push("empty-alpha")
  if (keyLeakage > 0.01) failures.push("chroma-key-leakage")
  if (input.aspectRatioDrift > 0.12) failures.push("aspect-ratio-drift")
  if ((input.scaleDrift ?? 0) > 0.25) failures.push("scale-drift")
  if (input.touchesGenerationBoundary) failures.push("generation-boundary-touch")
  if (
    input.sourceVisualSimilarity !== undefined &&
    input.sourceVisualSimilarity < 0.55
  ) {
    failures.push("source-visual-drift")
  }
  if (opaqueEdgeCoverage > 0.995 && input.sceneRole !== "container") {
    failures.push("opaque-rectangular-background")
  }
  return {
    id: input.id,
    sceneRole: input.sceneRole,
    critical: input.critical,
    aspectRatioDrift: round(input.aspectRatioDrift, 4),
    ...(input.scaleDrift !== undefined
      ? { scaleDrift: round(input.scaleDrift, 4) }
      : {}),
    keyLeakage: round(keyLeakage, 4),
    opaqueEdgeCoverage: round(opaqueEdgeCoverage, 4),
    ...(input.sourceVisualSimilarity !== undefined
      ? { sourceVisualSimilarity: round(input.sourceVisualSimilarity, 4) }
      : {}),
    touchesGenerationBoundary: input.touchesGenerationBoundary,
    status: failures.length === 0 ? ("passed" as const) : ("failed" as const),
    failures,
  }
}

async function compareRasterAppearance(
  reference: RasterImage,
  candidate: RasterImage,
) {
  const targetSize = 64
  const [referenceRaw, candidateRaw] = await Promise.all([
    sharp(reference.bytes)
      .flatten({ background: "#ffffff" })
      .resize(targetSize, targetSize, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer(),
    sharp(candidate.bytes)
      .flatten({ background: "#ffffff" })
      .resize(targetSize, targetSize, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer(),
  ])
  let difference = 0
  for (let index = 0; index < referenceRaw.length; index += 1) {
    difference += Math.abs((referenceRaw[index] ?? 0) - (candidateRaw[index] ?? 0))
  }
  return Math.max(0, 1 - difference / Math.max(1, referenceRaw.length * 255))
}

function calculateScaleDrift(
  logicalBBox: BoundingBoxV1,
  detectedBBox: BoundingBoxV1,
) {
  const scaleX = logicalBBox.width / Math.max(1, detectedBBox.width)
  const scaleY = logicalBBox.height / Math.max(1, detectedBBox.height)
  return Math.abs(Math.log(Math.sqrt(Math.max(0.0001, scaleX * scaleY))))
}

function boxesOverlap(left: BoundingBoxV1, right: BoundingBoxV1) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}

async function createOutputDirectories(output: string) {
  await Promise.all(
    ["inputs", "analysis-tiles", "model", "assets/elements"].map((directory) =>
      mkdir(path.join(output, directory), { recursive: true }),
    ),
  )
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function exists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false
    throw error
  }
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function round(value: number, decimals: number) {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
