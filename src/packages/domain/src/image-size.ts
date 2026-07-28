import type {
  ImageCapabilityProfileSpec,
  ImageContinuousSizeConstraints,
} from "./model-catalog";
import type { ImageOutputSizeIntent } from "./model";

export type ImageSizeAdjustment =
  | "model-size"
  | "dimension-multiple"
  | "max-edge"
  | "pixel-range"
  | "aspect-ratio";

export type ResolvedImageOutputSize = {
  readonly requested: {
    readonly width: number;
    readonly height: number;
  };
  readonly width: number;
  readonly height: number;
  readonly providerSize: `${number}x${number}`;
  readonly adjusted: boolean;
  readonly adjustments: readonly ImageSizeAdjustment[];
};

export type ResolveImageOutputSizeResult =
  | { readonly ok: true; readonly value: ResolvedImageOutputSize }
  | {
      readonly ok: false;
      readonly code:
        | "preset-unsupported"
        | "aspect-ratio-unsupported"
        | "custom-size-unsupported"
        | "custom-size-invalid"
        | "model-size-unavailable";
      readonly message: string;
    };

export function resolveImageOutputSize(
  intent: ImageOutputSizeIntent,
  profile: ImageCapabilityProfileSpec,
): ResolveImageOutputSizeResult {
  const requested = requestedDimensions(intent, profile);
  if (!requested.ok) return requested;

  const constraints = profile.sizeConstraints;
  if (constraints.strategy === "discrete") {
    const candidates = constraints.sizes.filter((size) =>
      intent.mode === "preset" ? size.presetId === intent.presetId : true,
    );
    if (candidates.length === 0) {
      return {
        ok: false,
        code: "model-size-unavailable",
        message: "The model has no output size for this request.",
      };
    }
    const closest = candidates.reduce((best, candidate) =>
      sizeDistance(candidate, requested.value) <
      sizeDistance(best, requested.value)
        ? candidate
        : best,
    );
    return resolved(requested.value, closest.width, closest.height, [
      ...(closest.width !== requested.value.width ||
      closest.height !== requested.value.height
        ? (["model-size"] as const)
        : []),
    ]);
  }

  const closest = closestContinuousSize(requested.value, constraints);
  if (!closest) {
    return {
      ok: false,
      code: "model-size-unavailable",
      message: "The model has no legal output size for this request.",
    };
  }
  return resolved(
    requested.value,
    closest.width,
    closest.height,
    continuousAdjustments(requested.value, constraints),
  );
}

function requestedDimensions(
  intent: ImageOutputSizeIntent,
  profile: ImageCapabilityProfileSpec,
):
  | { readonly ok: true; readonly value: { width: number; height: number } }
  | Exclude<ResolveImageOutputSizeResult, { ok: true }> {
  if (intent.mode === "custom") {
    if (!profile.customSize.enabled) {
      return {
        ok: false,
        code: "custom-size-unsupported",
        message: "This model does not support custom output sizes.",
      };
    }
    if (
      !Number.isSafeInteger(intent.width) ||
      !Number.isSafeInteger(intent.height) ||
      intent.width <= 0 ||
      intent.height <= 0
    ) {
      return {
        ok: false,
        code: "custom-size-invalid",
        message: "Custom width and height must be positive integers.",
      };
    }
    return { ok: true, value: { width: intent.width, height: intent.height } };
  }

  const preset = profile.resolutionPresets.find(
    (candidate) => candidate.id === intent.presetId,
  );
  if (!preset) {
    return {
      ok: false,
      code: "preset-unsupported",
      message: `Resolution preset "${intent.presetId}" is not supported.`,
    };
  }
  if (!profile.aspectRatios.includes(intent.aspectRatio)) {
    return {
      ok: false,
      code: "aspect-ratio-unsupported",
      message: `Aspect ratio "${intent.aspectRatio}" is not supported.`,
    };
  }
  const ratio = parseAspectRatio(intent.aspectRatio);
  if (!ratio) {
    return {
      ok: false,
      code: "aspect-ratio-unsupported",
      message: `Aspect ratio "${intent.aspectRatio}" is invalid.`,
    };
  }
  return ratio.width >= ratio.height
    ? {
        ok: true,
        value: {
          width: preset.longEdge,
          height: Math.round((preset.longEdge * ratio.height) / ratio.width),
        },
      }
    : {
        ok: true,
        value: {
          width: Math.round((preset.longEdge * ratio.width) / ratio.height),
          height: preset.longEdge,
        },
      };
}

function closestContinuousSize(
  requested: { width: number; height: number },
  constraints: ImageContinuousSizeConstraints,
) {
  const step = constraints.dimensionMultiple;
  let best: { width: number; height: number; distance: number } | undefined;
  for (let width = step; width <= constraints.maxEdge; width += step) {
    for (let height = step; height <= constraints.maxEdge; height += step) {
      const pixels = width * height;
      const aspect = Math.max(width / height, height / width);
      if (
        pixels < constraints.minPixels ||
        pixels > constraints.maxPixels ||
        aspect > constraints.maxAspectRatio
      ) {
        continue;
      }
      const distance = sizeDistance({ width, height }, requested);
      if (!best || distance < best.distance) {
        best = { width, height, distance };
      }
    }
  }
  return best;
}

function sizeDistance(
  candidate: { width: number; height: number },
  requested: { width: number; height: number },
) {
  const widthDelta = (candidate.width - requested.width) / requested.width;
  const heightDelta = (candidate.height - requested.height) / requested.height;
  return widthDelta * widthDelta + heightDelta * heightDelta;
}

function continuousAdjustments(
  requested: { width: number; height: number },
  constraints: ImageContinuousSizeConstraints,
): ImageSizeAdjustment[] {
  const adjustments: ImageSizeAdjustment[] = [];
  if (
    requested.width % constraints.dimensionMultiple !== 0 ||
    requested.height % constraints.dimensionMultiple !== 0
  ) {
    adjustments.push("dimension-multiple");
  }
  if (Math.max(requested.width, requested.height) > constraints.maxEdge) {
    adjustments.push("max-edge");
  }
  const pixels = requested.width * requested.height;
  if (pixels < constraints.minPixels || pixels > constraints.maxPixels) {
    adjustments.push("pixel-range");
  }
  if (
    Math.max(
      requested.width / requested.height,
      requested.height / requested.width,
    ) > constraints.maxAspectRatio
  ) {
    adjustments.push("aspect-ratio");
  }
  return adjustments;
}

function resolved(
  requested: { width: number; height: number },
  width: number,
  height: number,
  adjustments: readonly ImageSizeAdjustment[],
): ResolveImageOutputSizeResult {
  const adjusted = requested.width !== width || requested.height !== height;
  return {
    ok: true,
    value: {
      requested,
      width,
      height,
      providerSize: `${width}x${height}`,
      adjusted,
      adjustments:
        adjusted && adjustments.length === 0 ? ["model-size"] : adjustments,
    },
  };
}

function parseAspectRatio(value: string) {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}
