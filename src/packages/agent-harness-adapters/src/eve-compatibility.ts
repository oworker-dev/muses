export type EveRuntimeCompatibilityInput = {
  readonly nodeVersion: string;
  readonly musesWorkflowMajor: number;
  readonly eveWorkflowProtocol: "5.0.0-beta";
  readonly sandboxBoundary: "session" | "run";
};

export type EveRuntimeCompatibility = {
  readonly compatible: boolean;
  readonly reasons: readonly string[];
};

export function evaluateEveRuntimeCompatibility(
  input: EveRuntimeCompatibilityInput,
): EveRuntimeCompatibility {
  const reasons: string[] = [];
  const nodeMajor = parseMajor(input.nodeVersion);
  if (nodeMajor === null || nodeMajor < 24) {
    reasons.push("Eve 0.27.8 requires Node.js 24 or newer.");
  }
  if (input.musesWorkflowMajor !== 5) {
    reasons.push(
      "Eve 0.27.8 uses the Workflow SDK 5.0.0-beta protocol and cannot share the Muses Workflow SDK 4 world.",
    );
  }
  if (input.sandboxBoundary !== "run") {
    reasons.push(
      "Eve's session sandbox does not satisfy the Muses per-AgentRun isolation contract.",
    );
  }
  return { compatible: reasons.length === 0, reasons };
}

function parseMajor(version: string) {
  const match = version.trim().replace(/^v/, "").match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}
