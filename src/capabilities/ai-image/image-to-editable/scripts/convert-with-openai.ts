import process from "node:process"
import path from "node:path"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

import {
  OpenAiImageEditor,
  OpenAiVisionAnalyzer,
  normalizeSceneHierarchy,
  resolveOpenAiImageToEditableConfig,
} from "../../src/openai-provider.js"
import { convertImageToEditable } from "../../src/provider-pipeline.js"
import { prepareSourceImage } from "../../src/raster-processor.js"
import type {
  ImageEditPort,
  ImageStructureAnalysis,
  ProviderCallReceipt,
  RasterImage,
  VisionAnalyzerPort,
} from "../../src/pipeline-contracts.js"

const options = parseArguments(process.argv.slice(2))
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
)
const outputDirectory = path.isAbsolute(options.output)
  ? options.output
  : path.resolve(repositoryRoot, options.output)
const execution = options.resume
  ? await checkpointPorts(outputDirectory)
  : options.analysisCheckpoint
    ? await portsFromAnalysisCheckpoint(options.analysisCheckpoint)
  : liveProviderPorts()

if (options.analysisOnly) {
  const source = await prepareSourceImage(await readFile(resolveRepositoryPath(options.input)))
  const result = await execution.visionAnalyzer.analyze({
    image: source.original,
    signal: AbortSignal.timeout(20 * 60 * 1000),
  })
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    path.join(outputDirectory, "analysis-only.json"),
    `${JSON.stringify({ schemaVersion: "1.0", ...result }, null, 2)}\n`,
    "utf8",
  )
  process.stdout.write(
    `${JSON.stringify(
      {
        outputDirectory,
        textElements: result.analysis.elements.filter((element) => element.kind === "text").length,
        rasterElements: result.analysis.elements.filter((element) => element.kind === "raster-layer").length,
        strategies: countBy(result.analysis.elements, (element) => element.decomposition),
        editValues: countBy(result.analysis.elements, (element) => element.editValue),
        sceneRoles: countBy(result.analysis.elements, (element) => element.sceneRole ?? "legacy"),
        roots: result.analysis.elements.filter((element) => !element.parentId).map((element) => ({
          id: element.id,
          kind: element.kind,
          strategy: element.decomposition,
          editValue: element.editValue,
          sceneRole: element.sceneRole,
          bbox: element.logicalBBox,
          description: element.name,
        })),
        providerCalls: result.receipts,
      },
      null,
      2,
    )}\n`,
  )
} else {
  const result = await convertImageToEditable({
    inputPath: resolveRepositoryPath(options.input),
    outputDirectory,
    visionAnalyzer: execution.visionAnalyzer,
    imageEditor: execution.imageEditor,
    quality: options.quality,
    redrawConcurrency: options.redrawConcurrency,
    force: options.force,
    signal: AbortSignal.timeout(20 * 60 * 1000),
  })

  process.stdout.write(
    `${JSON.stringify(
      {
        outputDirectory: result.outputDirectory,
        qualityStatus: result.manifest.qualityStatus,
        textElements: result.qa.structure.textElements,
        rasterElements: result.qa.structure.rasterElements,
        renderedRasterElements: result.qa.structure.renderedRasterElements,
        similarity: result.qa.pixels.similarity,
        providerCalls: result.manifest.provenance.calls.map((call) => ({
          operation: call.operation,
          requestId: call.requestId,
          model: call.model,
          durationMs: call.durationMs,
        })),
        warnings: result.manifest.warnings,
      },
      null,
      2,
    )}\n`,
  )
}

function parseArguments(arguments_: string[]) {
  let input = ""
  let output = ""
  let quality: "low" | "medium" | "high" | "auto" = "medium"
  let force = false
  let resume = false
  let analysisOnly = false
  let analysisCheckpoint = ""
  let redrawConcurrency = 3
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === "--") continue
    if (argument === "--input") input = arguments_[++index] ?? ""
    else if (argument === "--output") output = arguments_[++index] ?? ""
    else if (argument === "--force") force = true
    else if (argument === "--resume") resume = true
    else if (argument === "--analysis-only") analysisOnly = true
    else if (argument === "--analysis-checkpoint") {
      analysisCheckpoint = arguments_[++index] ?? ""
    }
    else if (argument === "--quality") {
      const value = arguments_[++index]
      if (value !== "low" && value !== "medium" && value !== "high" && value !== "auto") {
        throw new Error(`Invalid --quality value: ${String(value)}`)
      }
      quality = value
    } else if (argument === "--redraw-concurrency") {
      const value = Number(arguments_[++index])
      if (!Number.isInteger(value) || value < 1 || value > 8) {
        throw new Error("--redraw-concurrency must be an integer between 1 and 8")
      }
      redrawConcurrency = value
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`)
    }
  }
  if (!input || !output) {
    throw new Error(
      "Usage: convert-with-openai --input <image> --output <directory> [--quality medium] [--redraw-concurrency 3] [--analysis-only] [--analysis-checkpoint <file>] [--resume] [--force]",
    )
  }
  if (resume && analysisCheckpoint) {
    throw new Error("--resume and --analysis-checkpoint are mutually exclusive.")
  }
  return {
    input,
    output,
    quality,
    force,
    resume,
    analysisOnly,
    analysisCheckpoint,
    redrawConcurrency,
  }
}

function resolveRepositoryPath(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value)
}

function countBy<T>(values: readonly T[], selector: (value: T) => string) {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = selector(value)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function liveProviderPorts() {
  const provider = resolveOpenAiImageToEditableConfig()
  if (!provider) {
    throw new Error(
      "OPENAI_API_KEY is required for the provider-backed image-to-editable spike.",
    )
  }
  return {
    visionAnalyzer: new OpenAiVisionAnalyzer(provider.vision) as VisionAnalyzerPort,
    imageEditor: new OpenAiImageEditor(provider.image) as ImageEditPort,
  }
}

async function portsFromAnalysisCheckpoint(filePath: string) {
  const live = liveProviderPorts()
  const checkpointPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(repositoryRoot, filePath)
  const payload = JSON.parse(await readFile(checkpointPath, "utf8")) as {
    analysis: ImageStructureAnalysis
    receipts: ProviderCallReceipt[]
  }
  const visionReceipt = payload.receipts.find(
    (receipt) => receipt.operation === "vision-analysis",
  )
  if (!visionReceipt) {
    throw new Error("Analysis checkpoint is missing the vision receipt.")
  }
  return {
    visionAnalyzer: replayVisionAnalyzer(
      {
        ...payload.analysis,
        elements: normalizeSceneHierarchy(payload.analysis.elements),
      },
      visionReceipt,
    ),
    imageEditor: live.imageEditor,
  }
}

async function checkpointPorts(outputDirectory: string) {
  const analysisPayload = JSON.parse(
    await readFile(path.join(outputDirectory, "analysis.json"), "utf8"),
  ) as {
    analysis: ImageStructureAnalysis
    receipts: ProviderCallReceipt[]
  }
  const provenance = JSON.parse(
    await readFile(path.join(outputDirectory, "provenance.json"), "utf8"),
  ) as { calls: ProviderCallReceipt[] }
  const visionReceipt = provenance.calls.find(
    (receipt) => receipt.operation === "vision-analysis",
  )
  if (!visionReceipt) throw new Error("Checkpoint is missing the vision receipt.")

  const modelDirectory = path.join(outputDirectory, "model")
  const redrawFiles = (await readdir(modelDirectory))
    .filter((name) => /^element-redraw-depth-\d+(?:-batch-\d+)?-chroma\.png$/.test(name))
    .sort()
  const redrawImages = await Promise.all(
    redrawFiles.map((name) => loadRaster(path.join(modelDirectory, name))),
  )
  if (redrawImages.length === 0) {
    throw new Error("Checkpoint has no hierarchy-depth element redraw outputs.")
  }
  const backgroundImage = await loadRaster(
    path.join(modelDirectory, "clean-background-padded.png"),
  )
  const visionAnalyzer = replayVisionAnalyzer(
    {
      ...analysisPayload.analysis,
      elements: normalizeSceneHierarchy(analysisPayload.analysis.elements),
    },
    visionReceipt,
  )
  let redrawIndex = 0
  const imageEditor: ImageEditPort = {
    edit: async (request) => {
      const operationReceipts = provenance.calls.filter(
        (candidate) => candidate.operation === request.operation,
      )
      const receipt =
        request.operation === "element-redraw"
          ? operationReceipts[redrawIndex]
          : operationReceipts[0]
      if (!receipt) {
        throw new Error(`Checkpoint is missing ${request.operation} receipt.`)
      }
      if (request.operation === "background-repair") {
        return { image: backgroundImage, receipt }
      }
      const image = redrawImages[redrawIndex]
      redrawIndex += 1
      if (!image) throw new Error("Checkpoint has fewer redraw images than batches.")
      return { image, receipt }
    },
  }
  return { visionAnalyzer, imageEditor }
}

function replayVisionAnalyzer(
  analysis: ImageStructureAnalysis,
  receipt: ProviderCallReceipt,
): VisionAnalyzerPort {
  return {
    analyze: async (request) => {
      if (request.onPartialResult) {
        await request.onPartialResult({
          analysis,
          receipt,
          tile: {
            x: 0,
            y: 0,
            width: request.image.width,
            height: request.image.height,
          },
        })
      }
      return { analysis, receipts: [receipt] }
    },
  }
}

async function loadRaster(filePath: string): Promise<RasterImage> {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error(`Checkpoint image is invalid: ${filePath}`)
  }
  return {
    bytes,
    mimeType: "image/png",
    width: metadata.width,
    height: metadata.height,
  }
}
