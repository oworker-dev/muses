export const MODEL_CATALOG_SCHEMA_VERSION = "0.1.0";

export const DEFAULT_IMAGE_MODEL_REF = "openai/gpt-image-2@2026-07-28" as const;

export type ImageGenerationMode = "text-to-image" | "image-to-image";

export type ImageReferenceImageSpec = {
  readonly maxCount: number;
  readonly mimeTypes: readonly (
    | "image/png"
    | "image/jpeg"
    | "image/webp"
  )[];
  readonly maxBytes: number;
};

export type ImageResolutionPresetSpec = {
  readonly id: string;
  readonly label: string;
  readonly longEdge: number;
};

export type ImageContinuousSizeConstraints = {
  readonly strategy: "continuous-grid";
  readonly dimensionMultiple: number;
  readonly maxEdge: number;
  readonly minPixels: number;
  readonly maxPixels: number;
  readonly maxAspectRatio: number;
  readonly legalization: "nearest";
};

export type ImageDiscreteSizeConstraints = {
  readonly strategy: "discrete";
  readonly sizes: readonly {
    readonly presetId: string;
    readonly aspectRatio: string;
    readonly width: number;
    readonly height: number;
  }[];
};

export type ImageSizeConstraints =
  | ImageContinuousSizeConstraints
  | ImageDiscreteSizeConstraints;

export type ImageCapabilityProfileSpec = {
  readonly kind: "image-generation";
  readonly inputModes: readonly ImageGenerationMode[];
  readonly referenceImages: ImageReferenceImageSpec;
  readonly aspectRatios: readonly string[];
  readonly resolutionPresets: readonly ImageResolutionPresetSpec[];
  readonly customSize: {
    readonly enabled: boolean;
  };
  readonly sizeConstraints: ImageSizeConstraints;
  readonly outputCounts: readonly number[];
  readonly parameters: {
    readonly quality: {
      readonly type: "enum";
      readonly values: readonly string[];
      readonly default: string;
    };
  };
};

export type ModelCatalogOffering = {
  readonly id: string;
  readonly modelRef: string;
  readonly displayName: string;
  readonly provider: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly capability: {
    readonly id: string;
    readonly profileId: string;
    readonly profileVersion: string;
    readonly specification: ImageCapabilityProfileSpec;
  };
  readonly price: {
    readonly entryId: string;
    readonly priceBookVersion: string;
    readonly billingUnit: "image-output";
    readonly unitCreditMicros: string;
  };
};

export type ModelCatalogProjection = {
  readonly schemaVersion: typeof MODEL_CATALOG_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly offerings: readonly ModelCatalogOffering[];
};

export function isVersionedModelRef(value: string) {
  return /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/i.test(
    value,
  );
}

export function isImageCapabilityProfileSpec(
  value: unknown,
): value is ImageCapabilityProfileSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ImageCapabilityProfileSpec>;
  const quality = candidate.parameters?.quality;
  const references = candidate.referenceImages;
  const constraints = candidate.sizeConstraints;
  return (
    candidate.kind === "image-generation" &&
    Array.isArray(candidate.inputModes) &&
    candidate.inputModes.every(
      (mode) => mode === "text-to-image" || mode === "image-to-image",
    ) &&
    Array.isArray(candidate.aspectRatios) &&
    candidate.aspectRatios.length > 0 &&
    candidate.aspectRatios.every((ratio) => typeof ratio === "string") &&
    isReferenceImageSpec(references) &&
    Array.isArray(candidate.resolutionPresets) &&
    candidate.resolutionPresets.length > 0 &&
    candidate.resolutionPresets.every(isResolutionPreset) &&
    typeof candidate.customSize?.enabled === "boolean" &&
    isImageSizeConstraints(constraints, candidate) &&
    Array.isArray(candidate.outputCounts) &&
    candidate.outputCounts.every(
      (count) => Number.isSafeInteger(count) && count > 0,
    ) &&
    quality?.type === "enum" &&
    Array.isArray(quality.values) &&
    quality.values.length > 0 &&
    quality.values.every((option) => typeof option === "string") &&
    typeof quality.default === "string" &&
    quality.values.includes(quality.default)
  );
}

function isReferenceImageSpec(
  value: ImageReferenceImageSpec | undefined,
): value is ImageReferenceImageSpec {
  return Boolean(
    value &&
      Number.isSafeInteger(value.maxCount) &&
      value.maxCount > 0 &&
      Number.isSafeInteger(value.maxBytes) &&
      value.maxBytes > 0 &&
      Array.isArray(value.mimeTypes) &&
      value.mimeTypes.length > 0 &&
      value.mimeTypes.every(
        (mimeType) =>
          mimeType === "image/png" ||
          mimeType === "image/jpeg" ||
          mimeType === "image/webp",
      ),
  );
}

function isResolutionPreset(value: ImageResolutionPresetSpec) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    Number.isSafeInteger(value.longEdge) &&
    value.longEdge > 0
  );
}

function isImageSizeConstraints(
  value: ImageSizeConstraints | undefined,
  profile: Partial<ImageCapabilityProfileSpec>,
): value is ImageSizeConstraints {
  if (!value || typeof value !== "object") return false;
  if (value.strategy === "continuous-grid") {
    return (
      profile.customSize?.enabled === true &&
      Number.isSafeInteger(value.dimensionMultiple) &&
      value.dimensionMultiple > 0 &&
      Number.isSafeInteger(value.maxEdge) &&
      value.maxEdge > 0 &&
      Number.isSafeInteger(value.minPixels) &&
      value.minPixels > 0 &&
      Number.isSafeInteger(value.maxPixels) &&
      value.maxPixels >= value.minPixels &&
      Number.isFinite(value.maxAspectRatio) &&
      value.maxAspectRatio >= 1 &&
      value.legalization === "nearest"
    );
  }
  if (value.strategy !== "discrete" || !Array.isArray(value.sizes)) {
    return false;
  }
  const presetIds = new Set(
    profile.resolutionPresets?.map((preset) => preset.id) || [],
  );
  const aspectRatios = new Set(profile.aspectRatios || []);
  return (
    value.sizes.length > 0 &&
    value.sizes.every(
      (size) =>
        presetIds.has(size.presetId) &&
        aspectRatios.has(size.aspectRatio) &&
        Number.isSafeInteger(size.width) &&
        size.width > 0 &&
        Number.isSafeInteger(size.height) &&
        size.height > 0,
    )
  );
}
