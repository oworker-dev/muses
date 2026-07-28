import type { CreativeCanvasItem } from "@muses/domain"

const DEFAULT_ORIGIN = { x: 120, y: 120 }
const DEFAULT_SIZE = { width: 320, height: 220 }
const ITEM_GAP = 64

export function nextCreativeCanvasItemPosition(
  items: readonly CreativeCanvasItem[],
  size: { width: number; height: number }
) {
  if (items.length === 0) return DEFAULT_ORIGIN

  const candidates = [
    ...[...items].reverse().flatMap((item) => {
      const itemSize = item.size || DEFAULT_SIZE
      return [
        {
          x: item.position.x + itemSize.width + ITEM_GAP,
          y: item.position.y,
        },
        {
          x: item.position.x,
          y: item.position.y + itemSize.height + ITEM_GAP,
        },
      ]
    }),
    DEFAULT_ORIGIN,
  ]

  return (
    candidates.find((candidate) =>
      items.every((item) => !overlaps(candidate, size, item))
    ) || {
      x:
        Math.max(
          DEFAULT_ORIGIN.x,
          ...items.map(
            (item) =>
              item.position.x + (item.size || DEFAULT_SIZE).width + ITEM_GAP
          )
        ),
      y: DEFAULT_ORIGIN.y,
    }
  )
}

function overlaps(
  position: { x: number; y: number },
  size: { width: number; height: number },
  item: CreativeCanvasItem
) {
  const itemSize = item.size || DEFAULT_SIZE
  return !(
    position.x >= item.position.x + itemSize.width + ITEM_GAP ||
    position.x + size.width + ITEM_GAP <= item.position.x ||
    position.y >= item.position.y + itemSize.height + ITEM_GAP ||
    position.y + size.height + ITEM_GAP <= item.position.y
  )
}
