import type {
  AssetDraft,
  JobDraft,
  MusesCommandPayload,
  MusesWorkspaceDraft,
  WorkflowEdgeDraft,
  WorkflowNodeDraft,
} from "./model";

const palettes = [
  ["#19173a", "#6658e8", "#ff8f70"],
  ["#0a2230", "#18a999", "#f4d35e"],
  ["#27152e", "#d55672", "#f6c177"],
] as const;

export function createDeterministicImageRun(
  workspace: MusesWorkspaceDraft,
  generatorNodeId: string,
  selectorNodeId: string,
): MusesCommandPayload {
  const prompt = resolveGeneratorPrompt(workspace, generatorNodeId);
  const runNumber = workspace.workflow.revision + 1;
  const jobId = `image-job-${runNumber}`;
  const completedAt = new Date();
  const createdAt = new Date(completedAt.getTime() - 1800).toISOString();
  const assets: AssetDraft[] = palettes.map((palette, index) => ({
    id: `image-asset-${runNumber}-${index + 1}`,
    kind: "image",
    mimeType: "image/svg+xml",
    width: 960,
    height: 540,
    dataUri: createSvgDataUri(prompt, palette, index),
    prompt,
    createdByJobId: jobId,
    provenance: {
      capabilityId: "deterministic.image.generate.v1",
      sourceNodeIds: [generatorNodeId],
    },
  }));
  const resultNodes: WorkflowNodeDraft[] = assets.map((asset, index) => ({
    id: `image-result-${runNumber}-${index + 1}`,
    kind: "image-result",
    title: `Direction ${index + 1}`,
    position: { x: 740, y: 70 + index * 250 },
    inputPorts: [
      {
        id: "source",
        label: "Source",
        direction: "input",
        valueType: "image",
        accepts: ["image"],
      },
    ],
    outputPorts: [
      {
        id: "image",
        label: "Image",
        direction: "output",
        valueType: "image",
      },
    ],
    data: {
      kind: "image-result",
      assetId: asset.id,
      generatorNodeId,
      selected: false,
      variantLabel: ["Editorial glow", "Systemic calm", "Kinetic launch"][
        index
      ],
    },
  }));
  const resultEdges: WorkflowEdgeDraft[] = resultNodes.flatMap(
    (node, index) => [
      {
        id: `edge-generator-${node.id}`,
        sourceNodeId: generatorNodeId,
        sourcePortId: "image",
        targetNodeId: node.id,
        targetPortId: "source",
        kind: "provenance" as const,
      },
      {
        id: `edge-${node.id}-selector`,
        sourceNodeId: node.id,
        sourcePortId: "image",
        targetNodeId: selectorNodeId,
        targetPortId: "candidates",
        kind: "dataflow" as const,
      },
    ],
  );
  const job: JobDraft = {
    id: jobId,
    capabilityId: "deterministic.image.generate.v1",
    status: "succeeded",
    inputNodeIds: [generatorNodeId],
    outputAssetIds: assets.map((asset) => asset.id),
    costCredits: 0,
    createdAt,
    completedAt: completedAt.toISOString(),
  };

  return {
    type: "workflow.capability.completed",
    generatorNodeId,
    selectorNodeId,
    resultNodes,
    resultEdges,
    assets,
    job,
  };
}

function resolveGeneratorPrompt(
  workspace: MusesWorkspaceDraft,
  generatorNodeId: string,
) {
  const promptEdge = workspace.workflow.edges.find(
    (edge) =>
      edge.targetNodeId === generatorNodeId && edge.targetPortId === "prompt",
  );
  const source = promptEdge
    ? workspace.workflow.nodes.find(
        (node) => node.id === promptEdge.sourceNodeId,
      )
    : undefined;
  if (source?.data.kind === "start") {
    const promptVariable = source.data.variables.find(
      (variable) => variable.id === "prompt",
    );
    if (typeof promptVariable?.defaultValue === "string") {
      return (
        promptVariable.defaultValue.trim() || "Untitled creative direction"
      );
    }
  }
  return "Untitled creative direction";
}

function createSvgDataUri(
  prompt: string,
  palette: readonly [string, string, string],
  variant: number,
) {
  const rotation = 18 + variant * 34;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset="0.52" stop-color="${palette[1]}"/><stop offset="1" stop-color="${palette[2]}"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="38"/></filter></defs><rect width="960" height="540" fill="url(#g)"/><g opacity=".72" filter="url(#blur)" transform="rotate(${rotation} 480 270)"><circle cx="280" cy="180" r="154" fill="${palette[2]}"/><rect x="460" y="72" width="330" height="330" rx="92" fill="${palette[1]}"/></g><path d="M80 438 C260 310 510 520 880 294" fill="none" stroke="white" stroke-opacity=".56" stroke-width="2"/><text x="64" y="76" fill="white" fill-opacity=".72" font-family="Arial,sans-serif" font-size="18" letter-spacing="4">MUSES / DIRECTION 0${variant + 1}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
