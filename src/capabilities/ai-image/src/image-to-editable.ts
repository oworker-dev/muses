export const EDITABLE_SCENE_SCHEMA_VERSION = "1.0" as const

export type BoundingBox = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type SceneAsset = {
  readonly id: string
  readonly path: string
  readonly mimeType: "image/png" | "image/svg+xml"
  readonly width: number
  readonly height: number
  readonly sha256: string
  readonly role: "source" | "raster-layer" | "preview" | "svg"
}

export type SceneLayer = {
  readonly id: string
  readonly name: string
  readonly type: "background" | "text" | "shape" | "raster-layer" | "group"
  readonly zIndex: number
  readonly editable: boolean
  readonly logicalBBox: BoundingBox
  readonly assetId?: string
  readonly notes?: readonly string[]
}

export type EditableSceneManifest = {
  readonly schemaVersion: typeof EDITABLE_SCENE_SCHEMA_VERSION
  readonly capability: "image.to-editable.v1"
  readonly fixture: {
    readonly id: "corporate-report-2024"
    readonly sourceName: string
    readonly sourceSha256: string
  }
  readonly canvas: {
    readonly width: 1672
    readonly height: 941
    readonly colorSpace: "srgb"
  }
  readonly assets: readonly SceneAsset[]
  readonly layers: readonly SceneLayer[]
  readonly exports: {
    readonly svg: string
    readonly preview: string
  }
  readonly structuralSummary: {
    readonly nativeTextElements: number
    readonly vectorShapeElements: number
    readonly rasterLayerElements: number
    readonly embedsFullSourceImage: false
  }
  readonly limitations: readonly string[]
}

export type ReconstructionQa = {
  readonly schemaVersion: "1.0"
  readonly source: { readonly width: number; readonly height: number }
  readonly rendered: { readonly width: number; readonly height: number }
  readonly structural: EditableSceneManifest["structuralSummary"]
  readonly pixels: {
    readonly nonBlank: boolean
    readonly meanAbsoluteError: number
    readonly similarity: number
  }
  readonly checks: Readonly<Record<string, boolean>>
}
