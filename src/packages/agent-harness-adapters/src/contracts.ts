export const AGENT_HARNESS_SPIKE_VERSION = "0.1.0" as const;

export type AgentHarnessCandidateId = "muses-headless" | "pi" | "eve";

export type AgentHarnessCapability =
  | "tool-loop"
  | "steering-follow-up"
  | "durable-recovery"
  | "human-approval"
  | "skills"
  | "mcp"
  | "run-sandbox"
  | "self-hosting"
  | "muses-authority";

export type AgentHarnessCapabilitySupport =
  | "native"
  | "muses-adapter"
  | "blocked";

export type AgentHarnessCandidateAssessment = {
  readonly id: AgentHarnessCandidateId;
  readonly packageName: string;
  readonly version: string;
  readonly license: "MIT" | "Apache-2.0" | "Muses-owned";
  readonly runtimeRequirement: string;
  readonly workflowProtocol: string | null;
  readonly capabilities: Readonly<
    Record<AgentHarnessCapability, AgentHarnessCapabilitySupport>
  >;
  readonly blockers: readonly string[];
  readonly role: "primary" | "optional-loop" | "deferred-candidate";
};

export type AgentHarnessSelection = {
  readonly version: typeof AGENT_HARNESS_SPIKE_VERSION;
  readonly primaryRuntime: "muses-headless";
  readonly optionalLoopAdapter: "pi";
  readonly deferredDurableCandidate: "eve";
  readonly invariant: string;
};
