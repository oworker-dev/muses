export type BoundingBoxV1 = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type RasterImage = {
  readonly bytes: Uint8Array
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp"
  readonly width: number
  readonly height: number
}

export type AnalyzedElement = {
  readonly id: string
  readonly name: string
  readonly kind: "text" | "raster-layer"
  readonly role: "background" | "foreground"
  /**
   * Scene-layer classification used to decide whether an element belongs in
   * the repaired base image or remains an independently replaceable layer.
   */
  readonly sceneRole?:
    | "background-field"
    | "bounded-artwork"
    | "container"
    | "leaf"
    | "native-text"
  readonly parentId: string | null
  readonly decomposition: "keep-whole" | "split-group" | "split-leaf" | "native-text"
  readonly editValue: "high" | "medium" | "low"
  readonly fidelityRisk: "low" | "medium" | "high"
  readonly zIndex: number
  readonly logicalBBox: BoundingBoxV1
  readonly text: string
  readonly fontSize: number
  readonly fontWeight: number
  readonly fill: string
  readonly textAlign: "start" | "middle" | "end"
  readonly rotationDegrees: number
  readonly confidence: number
  readonly description: string
  readonly fidelity: "standard" | "critical"
}

export type ImageStructureAnalysis = {
  readonly canvasSummary: string
  readonly backgroundDescription: string
  readonly elements: readonly AnalyzedElement[]
}

export type ProviderUsage = {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly inputImageTokens?: number
  readonly inputTextTokens?: number
}

export type ProviderCallReceipt = {
  readonly requestId: string
  readonly provider: string
  readonly model: string
  readonly operation: "vision-analysis" | "element-redraw" | "background-repair"
  readonly createdAt: string
  readonly durationMs: number
  readonly usage: ProviderUsage
}

export type VisionAnalysisRequest = {
  readonly image: RasterImage
  readonly signal?: AbortSignal
  readonly onPartialResult?: (partial: {
    readonly analysis: ImageStructureAnalysis
    readonly receipt: ProviderCallReceipt
    readonly tile: BoundingBoxV1
  }) => Promise<void>
}

export type VisionAnalysisResult = {
  readonly analysis: ImageStructureAnalysis
  readonly receipts: readonly ProviderCallReceipt[]
}

export interface VisionAnalyzerPort {
  analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResult>
}

export type ImageEditRequest = {
  readonly operation: "element-redraw" | "background-repair"
  readonly image: RasterImage
  readonly prompt: string
  readonly size: `${number}x${number}`
  readonly quality: "low" | "medium" | "high" | "auto"
  readonly signal?: AbortSignal
}

export type ImageEditResult = {
  readonly image: RasterImage
  readonly receipt: ProviderCallReceipt
}

export interface ImageEditPort {
  edit(request: ImageEditRequest): Promise<ImageEditResult>
}

export type ProviderBackedSceneManifest = {
  readonly schemaVersion: "1.0"
  readonly capability: "image.to-editable.v1"
  readonly qualityStatus: "passed" | "partial"
  readonly source: {
    readonly name: string
    readonly sha256: string
    readonly width: number
    readonly height: number
  }
  readonly canvas: {
    readonly width: number
    readonly height: number
    readonly colorSpace: "srgb"
  }
  readonly background: {
    readonly path: string
    readonly sha256: string
    readonly sourceElementId?: string
  }
  readonly elements: readonly ProviderBackedSceneElement[]
  readonly exports: {
    readonly svg: string
    readonly preview: string
  }
  readonly provenance: {
    readonly mode: "provider-backed-spike"
    readonly calls: readonly ProviderCallReceipt[]
  }
  readonly warnings: readonly string[]
}

export type ProviderBackedSceneElement = {
  readonly id: string
  readonly name: string
  readonly type: "text" | "raster-layer"
  readonly role: AnalyzedElement["role"]
  readonly sceneRole?: AnalyzedElement["sceneRole"]
  readonly parentId: string | null
  readonly decomposition: AnalyzedElement["decomposition"]
  readonly editValue: AnalyzedElement["editValue"]
  readonly fidelityRisk: AnalyzedElement["fidelityRisk"]
  readonly zIndex: number
  readonly logicalBBox: BoundingBoxV1
  readonly generationBBox?: BoundingBoxV1
  readonly detectedBBox?: BoundingBoxV1
  readonly cropBBox?: BoundingBoxV1
  readonly placementBBox?: BoundingBoxV1
  readonly aspectRatioDrift?: number
  readonly scaleDrift?: number
  readonly asset?: {
    readonly path: string
    readonly sha256: string
    readonly width: number
    readonly height: number
  }
  /** How the raster asset was obtained. A source fallback is intentionally
   * visible to downstream QA and must not be treated as a successful redraw. */
  readonly assetMode?: "model-redraw" | "source-preserving-fallback"
  readonly text?: {
    readonly value: string
    readonly fontSize: number
    readonly fontWeight: number
    readonly fill: string
    readonly textAlign: "start" | "middle" | "end"
  }
  readonly confidence: number
  readonly warnings: readonly string[]
}
