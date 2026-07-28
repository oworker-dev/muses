import type {
  DesignDocumentDraft,
  Point,
  PortValueType,
  WorkflowInputVariableDefinition,
  WorkflowNodeDraft,
  WorkflowNodeKind,
} from "./model";
import { WORKSPACE_SCHEMA_VERSION } from "./model";
import { DEFAULT_IMAGE_MODEL_REF } from "./model-catalog";

export function createNodeDraft(
  kind: Exclude<WorkflowNodeKind, "image-result">,
  id: string,
  position: Point,
): WorkflowNodeDraft {
  switch (kind) {
    case "start": {
      const variables: WorkflowInputVariableDefinition[] = [
        {
          id: "prompt",
          name: "prompt",
          valueType: "text",
          required: true,
          defaultValue:
            "A cinematic launch visual for an open AI creation platform, sculptural light, midnight indigo and warm coral accents",
        },
      ];
      return {
        id,
        kind,
        title: "Start",
        position,
        inputPorts: [],
        outputPorts: createStartOutputPorts(variables),
        data: {
          kind,
          variables,
        },
      };
    }
    case "image-generator":
      return {
        id,
        kind,
        title: "Generate image",
        position,
        inputPorts: [
          input("prompt", "Prompt", "text", true),
          input("referenceImages", "Reference images", "image"),
        ],
        outputPorts: [output("image", "Images", "image")],
        data: {
          kind,
          capabilityId: "image.generate.v1",
          modelRef: DEFAULT_IMAGE_MODEL_REF,
          inputs: {
            prompt: { mode: "variable" },
            referenceImages: { mode: "fixed", assetIds: [] },
          },
          output: {
            size: {
              mode: "preset",
              presetId: "1k",
              aspectRatio: "1:1",
            },
            count: 1,
          },
          quality: "medium",
          status: "idle",
        },
      };
    case "selector":
      return {
        id,
        kind,
        title: "Choose direction",
        position,
        inputPorts: [input("candidates", "Candidates", "image", true, true)],
        outputPorts: [output("selected", "Selected", "image")],
        data: {
          kind,
          sourceGeneratorNodeId: "image-generator-1",
          candidateNodeIds: [],
        },
      };
    case "design-document": {
      const documentId = `${id}-document`;
      return {
        id,
        kind,
        title: "Design canvas",
        position,
        inputPorts: [input("image", "Image", "image", true)],
        outputPorts: [output("document", "Document", "design-document")],
        data: {
          kind,
          documentId,
        },
      };
    }
    case "end":
      return {
        id,
        kind,
        title: "End",
        position,
        inputPorts: [input("image", "Image", "image", true)],
        outputPorts: [],
        data: { kind },
      };
  }
}

export function createStartOutputPorts(
  variables: WorkflowInputVariableDefinition[],
) {
  return variables.map((variable) =>
    output(variable.id, variable.name, variable.valueType),
  );
}

export function validateWorkflowInputVariables(
  variables: WorkflowInputVariableDefinition[],
) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const variable of variables) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(variable.id)) {
      return `Variable id "${variable.id}" must start with a letter and contain only letters, numbers, underscores, or hyphens.`;
    }
    const normalizedName = variable.name.trim();
    if (!normalizedName) return "Variable names cannot be empty.";
    if (ids.has(variable.id))
      return `Variable id "${variable.id}" is duplicated.`;
    if (names.has(normalizedName)) {
      return `Variable name "${normalizedName}" is duplicated.`;
    }
    if (
      variable.defaultValue !== undefined &&
      typeof variable.defaultValue !==
        (variable.valueType === "text" ? "string" : variable.valueType)
    ) {
      return `Variable "${normalizedName}" has a default value that does not match ${variable.valueType}.`;
    }
    ids.add(variable.id);
    names.add(normalizedName);
  }
  return null;
}

export function createDesignDocument(
  id: string,
  title = "Launch composition",
): DesignDocumentDraft {
  return {
    id,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    revision: 0,
    title,
    width: 960,
    height: 540,
    elements: [
      {
        id: "accent-panel",
        kind: "shape",
        shape: "rect",
        x: 54,
        y: 354,
        width: 430,
        height: 122,
        fill: "#101322cc",
        cornerRadius: 28,
      },
      {
        id: "headline",
        kind: "text",
        text: "Ideas, orchestrated.",
        x: 84,
        y: 378,
        width: 700,
        fontSize: 48,
        fill: "#ffffff",
        fontWeight: "bold",
      },
      {
        id: "subhead",
        kind: "text",
        text: "Muses turns creative intent into editable systems.",
        x: 88,
        y: 438,
        width: 720,
        fontSize: 22,
        fill: "#d9dcef",
        fontWeight: "normal",
      },
    ],
    publishedPorts: [output("document", "Document", "design-document")],
  };
}

function input(
  id: string,
  label: string,
  valueType: PortValueType,
  required = false,
  allowsMultiple = false,
) {
  return {
    id,
    label,
    direction: "input" as const,
    valueType,
    accepts: [valueType],
    required,
    allowsMultiple,
  };
}

function output(id: string, label: string, valueType: PortValueType) {
  return {
    id,
    label,
    direction: "output" as const,
    valueType,
  };
}
