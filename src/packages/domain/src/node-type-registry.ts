import type { PortValueType } from "./model";

export const NODE_TYPE_REGISTRY_SCHEMA_VERSION = "0.1.0-draft";

export type NodeTypeCategory =
  | "input"
  | "output"
  | "model"
  | "agent"
  | "media"
  | "human"
  | "workflow";

export type NodeTypePortDefinition = {
  readonly id: string;
  readonly label: string;
  readonly valueType: PortValueType | "json" | "asset";
  readonly required: boolean;
  readonly allowsMultiple: boolean;
};

export type NodeTypeDefinition = {
  readonly schemaVersion: typeof NODE_TYPE_REGISTRY_SCHEMA_VERSION;
  readonly type: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly category: NodeTypeCategory;
  readonly configSchema: Readonly<Record<string, unknown>>;
  readonly inputPorts: readonly NodeTypePortDefinition[];
  readonly outputPorts: readonly NodeTypePortDefinition[];
  readonly executorRef: string;
  readonly requiredCapabilities: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly creationPolicy: {
    readonly user: boolean;
    readonly agent: boolean;
  };
  readonly costModelRef?: string;
  readonly uiExtensionRef?: string;
};

export type NodeTypeRegistry = {
  readonly schemaVersion: typeof NODE_TYPE_REGISTRY_SCHEMA_VERSION;
  readonly definitions: readonly NodeTypeDefinition[];
};

export type NodeTypeRegistryIssue = {
  readonly code:
    | "identity-required"
    | "duplicate-definition"
    | "duplicate-port"
    | "executor-required";
  readonly message: string;
  readonly nodeType?: string;
};

export type CreateNodeTypeRegistryResult =
  | { readonly ok: true; readonly registry: NodeTypeRegistry }
  | { readonly ok: false; readonly issues: readonly NodeTypeRegistryIssue[] };

export function createNodeTypeRegistry(
  definitions: readonly NodeTypeDefinition[],
): CreateNodeTypeRegistryResult {
  const issues: NodeTypeRegistryIssue[] = [];
  const definitionKeys = new Set<string>();

  for (const definition of definitions) {
    const key = getNodeTypeDefinitionKey(definition.type, definition.version);
    if (definition.type.trim().length === 0 || definition.version.trim().length === 0) {
      issues.push({
        code: "identity-required",
        message: "Node type and version are required.",
        nodeType: definition.type,
      });
    }
    if (definitionKeys.has(key)) {
      issues.push({
        code: "duplicate-definition",
        message: `Node type definition "${key}" is duplicated.`,
        nodeType: definition.type,
      });
    }
    definitionKeys.add(key);
    if (definition.executorRef.trim().length === 0) {
      issues.push({
        code: "executor-required",
        message: `Node type definition "${key}" requires an executor reference.`,
        nodeType: definition.type,
      });
    }

    const portIds = new Set<string>();
    for (const port of [...definition.inputPorts, ...definition.outputPorts]) {
      if (portIds.has(port.id)) {
        issues.push({
          code: "duplicate-port",
          message: `Node type definition "${key}" duplicates port "${port.id}".`,
          nodeType: definition.type,
        });
      }
      portIds.add(port.id);
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    registry: {
      schemaVersion: NODE_TYPE_REGISTRY_SCHEMA_VERSION,
      definitions: definitions.map(cloneNodeTypeDefinition),
    },
  };
}

export function getNodeTypeDefinition(
  registry: NodeTypeRegistry,
  type: string,
  version: string,
): NodeTypeDefinition | undefined {
  return registry.definitions.find(
    (definition) => definition.type === type && definition.version === version,
  );
}

export function listAgentCreatableNodeTypes(
  registry: NodeTypeRegistry,
): readonly NodeTypeDefinition[] {
  return registry.definitions.filter(
    (definition) => definition.creationPolicy.agent,
  );
}

export function getNodeTypeDefinitionKey(type: string, version: string) {
  return `${type}@${version}`;
}

function cloneNodeTypeDefinition(
  definition: NodeTypeDefinition,
): NodeTypeDefinition {
  return {
    ...definition,
    configSchema: structuredClone(definition.configSchema),
    inputPorts: definition.inputPorts.map((port) => ({ ...port })),
    outputPorts: definition.outputPorts.map((port) => ({ ...port })),
    requiredCapabilities: [...definition.requiredCapabilities],
    requiredPermissions: [...definition.requiredPermissions],
    creationPolicy: { ...definition.creationPolicy },
  };
}
