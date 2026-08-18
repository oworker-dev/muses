import type {
  AnalyzedElement,
  BoundingBoxV1,
  ProviderBackedSceneElement,
  RasterImage,
} from "./pipeline-contracts.js"

export function assembleEditableSvg(input: {
  readonly width: number
  readonly height: number
  readonly background: RasterImage
  readonly analysisElements: readonly AnalyzedElement[]
  readonly sceneElements: readonly ProviderBackedSceneElement[]
  readonly rasterAssets: Readonly<Record<string, RasterImage>>
}) {
  const sceneById = new Map(input.sceneElements.map((element) => [element.id, element]))
  const sourceFallbacks = input.sceneElements.filter(
    (element) => element.assetMode === "source-preserving-fallback",
  )
  const layers = input.analysisElements
    .slice()
    .sort((left, right) => left.zIndex - right.zIndex)
    .flatMap((element) => {
      const scene = sceneById.get(element.id)
      if (!scene) return []
      if (element.kind === "text") {
        const sourcePreserved = sourceFallbacks.some((fallback) =>
          intersects(
            fallback.placementBBox ?? fallback.logicalBBox,
            element.logicalBBox,
          ),
        )
        return [textElement(element, sourcePreserved)]
      }
      const asset = input.rasterAssets[element.id]
      return asset ? [imageElement(element, scene, asset)] : []
    })

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" role="img" aria-label="Editable reconstruction">`,
    `<image id="clean-background" data-layer-type="raster-background" x="0" y="0" width="${input.width}" height="${input.height}" href="${dataUrl(input.background)}"/>`,
    ...layers,
    "</svg>",
  ].join("\n")
}

function imageElement(
  element: AnalyzedElement,
  scene: ProviderBackedSceneElement,
  asset: RasterImage,
) {
  const box = scene.placementBBox ?? element.logicalBBox
  const transform = rotation(element)
  const sceneRole = scene.sceneRole
    ? ` data-scene-role="${attribute(scene.sceneRole)}"`
    : ""
  return `<image id="${attribute(element.id)}" data-layer-type="raster-layer"${sceneRole} x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="none" href="${dataUrl(asset)}"${transform}/>`
}

function textElement(element: AnalyzedElement, sourcePreserved: boolean) {
  const box = element.logicalBBox
  const x =
    element.textAlign === "middle"
      ? box.x + box.width / 2
      : element.textAlign === "end"
        ? box.x + box.width
        : box.x
  const lines = element.text.split(/\r?\n/)
  const lineHeight = Math.max(element.fontSize * 1.15, box.height / Math.max(1, lines.length))
  const startY = box.y + Math.min(element.fontSize, lineHeight * 0.9)
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${round(x)}" y="${round(startY + index * lineHeight)}" textLength="${round(box.width)}" lengthAdjust="spacingAndGlyphs">${text(line)}</tspan>`,
    )
    .join("")
  const sourceMode = sourcePreserved
    ? ' data-text-render-mode="source-preserved" opacity="0"'
    : ""
  return `<text id="${attribute(element.id)}" data-layer-type="text"${sourceMode} font-family="Arial, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${round(element.fontSize)}" font-weight="${element.fontWeight}" fill="${attribute(element.fill)}" text-anchor="${element.textAlign}" dominant-baseline="alphabetic"${rotation(element)}>${tspans}</text>`
}

function intersects(left: BoundingBoxV1, right: BoundingBoxV1) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}

function rotation(element: AnalyzedElement) {
  if (Math.abs(element.rotationDegrees) < 0.01) return ""
  const centerX = element.logicalBBox.x + element.logicalBBox.width / 2
  const centerY = element.logicalBBox.y + element.logicalBBox.height / 2
  return ` transform="rotate(${round(element.rotationDegrees)} ${round(centerX)} ${round(centerY)})"`
}

function dataUrl(image: RasterImage) {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`
}

function text(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function attribute(value: string) {
  return text(value).replace(/"/g, "&quot;")
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
