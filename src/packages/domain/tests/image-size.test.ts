import { describe, expect, it } from "vitest";

import {
  resolveImageOutputSize,
  type ImageCapabilityProfileSpec,
} from "../src";

const continuousProfile: ImageCapabilityProfileSpec = {
  kind: "image-generation",
  inputModes: ["text-to-image", "image-to-image"],
  referenceImages: {
    maxCount: 16,
    mimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: 52_428_800,
  },
  aspectRatios: ["1:1", "16:9", "9:16"],
  resolutionPresets: [
    { id: "1k", label: "1K", longEdge: 1024 },
    { id: "2k", label: "2K", longEdge: 2048 },
    { id: "4k", label: "4K", longEdge: 3840 },
  ],
  customSize: { enabled: true },
  sizeConstraints: {
    strategy: "continuous-grid",
    dimensionMultiple: 16,
    maxEdge: 3840,
    minPixels: 655_360,
    maxPixels: 8_294_400,
    maxAspectRatio: 3,
    legalization: "nearest",
  },
  outputCounts: [1, 2, 3, 4],
  parameters: {
    quality: {
      type: "enum",
      values: ["low", "medium", "high"],
      default: "medium",
    },
  },
};

const discreteProfile: ImageCapabilityProfileSpec = {
  ...continuousProfile,
  aspectRatios: ["1:1", "3:2", "2:3"],
  resolutionPresets: [{ id: "1k", label: "1K", longEdge: 1536 }],
  customSize: { enabled: false },
  sizeConstraints: {
    strategy: "discrete",
    sizes: [
      { presetId: "1k", aspectRatio: "1:1", width: 1024, height: 1024 },
      { presetId: "1k", aspectRatio: "3:2", width: 1536, height: 1024 },
      { presetId: "1k", aspectRatio: "2:3", width: 1024, height: 1536 },
    ],
  },
};

describe("image output size resolution", () => {
  it("keeps an already legal custom size unchanged", () => {
    expect(
      resolveImageOutputSize(
        { mode: "custom", width: 2048, height: 1152 },
        continuousProfile,
      ),
    ).toEqual({
      ok: true,
      value: {
        requested: { width: 2048, height: 1152 },
        width: 2048,
        height: 1152,
        providerSize: "2048x1152",
        adjusted: false,
        adjustments: [],
      },
    });
  });

  it("legalizes non-multiple custom dimensions to the nearest valid grid", () => {
    const result = resolveImageOutputSize(
      { mode: "custom", width: 1001, height: 777 },
      continuousProfile,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.width % 16).toBe(0);
    expect(result.value.height % 16).toBe(0);
    expect(result.value.adjusted).toBe(true);
    expect(result.value.adjustments).toContain("dimension-multiple");
  });

  it("makes 1K wide presets legal without hiding the pixel-floor adjustment", () => {
    const result = resolveImageOutputSize(
      { mode: "preset", presetId: "1k", aspectRatio: "16:9" },
      continuousProfile,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.width * result.value.height).toBeGreaterThanOrEqual(
      655_360,
    );
    expect(result.value.adjustments).toContain("pixel-range");
  });

  it("does not present custom sizes for a discrete model", () => {
    expect(
      resolveImageOutputSize(
        { mode: "custom", width: 1000, height: 1000 },
        discreteProfile,
      ),
    ).toMatchObject({ ok: false, code: "custom-size-unsupported" });
  });

  it("maps a discrete preset to the provider-supported dimensions", () => {
    expect(
      resolveImageOutputSize(
        { mode: "preset", presetId: "1k", aspectRatio: "3:2" },
        discreteProfile,
      ),
    ).toMatchObject({
      ok: true,
      value: { width: 1536, height: 1024, providerSize: "1536x1024" },
    });
  });
});
