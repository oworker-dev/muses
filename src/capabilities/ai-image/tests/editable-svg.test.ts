import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type {
  EditableSceneManifest,
  ReconstructionQa,
} from "../src/image-to-editable.js"

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const repositoryRoot = path.resolve(packageRoot, "../../..")
const evidenceRoot = path.join(
  repositoryRoot,
  "delivery/evidence/image-to-editable/corporate-report",
)

describe("corporate report editable SVG evidence", () => {
  it("publishes a host-neutral scene manifest with bounded raster layers", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(evidenceRoot, "scene-manifest.json"), "utf8"),
    ) as EditableSceneManifest

    assert.equal(manifest.schemaVersion, "1.0")
    assert.equal(manifest.capability, "image.to-editable.v1")
    assert.deepEqual(manifest.canvas, {
      width: 1672,
      height: 941,
      colorSpace: "srgb",
    })
    assert.equal(manifest.structuralSummary.embedsFullSourceImage, false)
    assert.equal(manifest.structuralSummary.rasterLayerElements, 3)
    assert.ok(manifest.structuralSummary.nativeTextElements >= 150)
    assert.ok(manifest.structuralSummary.vectorShapeElements >= 100)
    assert.equal(
      manifest.layers.filter((layer) => layer.type === "raster-layer").length,
      3,
    )
    assert.ok(manifest.layers.every((layer) => layer.editable))
  })

  it("keeps copy and charts native while embedding only extracted assets", async () => {
    const svg = await readFile(path.join(evidenceRoot, "editable.svg"), "utf8")

    assert.match(svg, /<text\b[^>]*id="hero-title-1"/)
    assert.match(svg, /<circle\b[^>]*id="donut-segment-0"/)
    assert.match(svg, /<polyline\b[^>]*id="margin-line"/)
    assert.match(svg, /<rect\b[^>]*id="year-3"|<g\b[^>]*id="year-3"/)
    assert.equal((svg.match(/<image\b/g) ?? []).length, 3)
    assert.equal((svg.match(/data:image\/png;base64,/g) ?? []).length, 3)
    assert.doesNotMatch(svg, /\/root\/a\.png/)
    assert.doesNotMatch(svg, /data-asset-path="[^"]*source/i)
  })

  it("renders a nonblank same-size preview above the fixture quality floor", async () => {
    const qa = JSON.parse(
      await readFile(path.join(evidenceRoot, "qa.json"), "utf8"),
    ) as ReconstructionQa

    assert.deepEqual(qa.source, qa.rendered)
    assert.equal(qa.pixels.nonBlank, true)
    assert.ok(qa.pixels.similarity >= 0.9)
    assert.ok(Object.values(qa.checks).every(Boolean))
  })
})
