import { describe, expect, it } from "vitest"

import type { CreativeCanvasItem } from "@muses/domain"

import { nextCreativeCanvasItemPosition } from "./creative-canvas-placement"

const portraitSize = { width: 320, height: 480 }

describe("nextCreativeCanvasItemPosition", () => {
  it("uses the stable canvas origin for the first result", () => {
    expect(nextCreativeCanvasItemPosition([], portraitSize)).toEqual({
      x: 120,
      y: 120,
    })
  })

  it("places a follow-up result beside the latest moved asset", () => {
    const previous = item({ x: 194, y: 157 })

    expect(nextCreativeCanvasItemPosition([previous], portraitSize)).toEqual({
      x: 578,
      y: 157,
    })
  })

  it("continues the comparison row without overlapping prior results", () => {
    const first = item({ x: 120, y: 120 }, "first")
    const second = item({ x: 504, y: 120 }, "second")

    expect(
      nextCreativeCanvasItemPosition([first, second], portraitSize)
    ).toEqual({ x: 888, y: 120 })
  })
})

function item(
  position: { x: number; y: number },
  id = "previous"
): CreativeCanvasItem {
  return {
    id,
    kind: "asset",
    refId: `image-${id}`,
    title: id,
    position,
    size: portraitSize,
  }
}
