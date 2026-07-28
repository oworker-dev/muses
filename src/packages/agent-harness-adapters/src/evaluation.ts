import type {
  AgentHarnessCandidateAssessment,
  AgentHarnessSelection,
} from "./contracts";

export const AGENT_HARNESS_ASSESSMENTS = [
  {
    id: "muses-headless",
    packageName: "@muses/agent-core",
    version: "0.0.1",
    license: "Muses-owned",
    runtimeRequirement: "Node.js 22+",
    workflowProtocol: null,
    capabilities: {
      "tool-loop": "native",
      "steering-follow-up": "native",
      "durable-recovery": "muses-adapter",
      "human-approval": "native",
      skills: "native",
      mcp: "native",
      "run-sandbox": "native",
      "self-hosting": "native",
      "muses-authority": "native",
    },
    blockers: [
      "A PostgreSQL AgentStateStore adapter is required before production use.",
      "A production model adapter is required before live inference.",
    ],
    role: "primary",
  },
  {
    id: "pi",
    packageName: "@earendil-works/pi-agent-core",
    version: "0.82.1",
    license: "MIT",
    runtimeRequirement: "Node.js >=22.19.0",
    workflowProtocol: null,
    capabilities: {
      "tool-loop": "native",
      "steering-follow-up": "native",
      "durable-recovery": "muses-adapter",
      "human-approval": "muses-adapter",
      skills: "muses-adapter",
      mcp: "muses-adapter",
      "run-sandbox": "muses-adapter",
      "self-hosting": "native",
      "muses-authority": "muses-adapter",
    },
    blockers: [
      "Pi Agent Core does not provide the production durable runtime owned by Muses.",
      "Pi tool preflight can block, but Muses must own durable approval pause and resume.",
    ],
    role: "optional-loop",
  },
  {
    id: "eve",
    packageName: "eve",
    version: "0.27.8",
    license: "Apache-2.0",
    runtimeRequirement: "Node.js >=24",
    workflowProtocol: "@workflow/* 5.0.0-beta",
    capabilities: {
      "tool-loop": "native",
      "steering-follow-up": "muses-adapter",
      "durable-recovery": "native",
      "human-approval": "native",
      skills: "native",
      mcp: "native",
      "run-sandbox": "blocked",
      "self-hosting": "native",
      "muses-authority": "muses-adapter",
    },
    blockers: [
      "The current Muses runtime uses Node.js 22 and Workflow SDK 4.x.",
      "Eve 0.27.8 requires Node.js 24 and its vendored Workflow SDK 5.0.0-beta protocol.",
      "Eve sandboxes are session-scoped while Muses requires a distinct sandbox per AgentRun.",
      "Eve does not guarantee a durable FIFO for concurrent session messages.",
    ],
    role: "deferred-candidate",
  },
] as const satisfies readonly AgentHarnessCandidateAssessment[];

export const AGENT_HARNESS_SELECTION: AgentHarnessSelection = {
  version: "0.1.0",
  primaryRuntime: "muses-headless",
  optionalLoopAdapter: "pi",
  deferredDurableCandidate: "eve",
  invariant:
    "Every harness must act through Muses Query, Command, Capability, Policy, Store, and Sandbox ports.",
};
