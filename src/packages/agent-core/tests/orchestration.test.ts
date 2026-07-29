import { describe, expect, it } from "vitest";

import {
  AGENT_DELEGATION_SCHEMA_VERSION,
  validateAgentDelegationPlan,
  type AgentDelegationAuthoritySnapshot,
  type AgentDelegationPlan,
  type AgentDelegationTask,
  type AgentDelegationValidation,
} from "../src";

describe("Agent delegation contract", () => {
  it("accepts a bounded DAG with a stable order and aggregate budget", () => {
    const research = delegatedTask("research");
    const render = delegatedTask("render", ["research"]);
    const qa = delegatedTask("qa", ["research"]);

    const result = validateAgentDelegationPlan({
      plan: delegationPlan([research, render, qa]),
      authority: delegationAuthority(),
    });

    expect(result).toEqual({
      ok: true,
      nextDepth: 1,
      topologicalOrder: ["research", "render", "qa"],
      budgetEnvelope: {
        maxTurns: 6,
        maxModelCalls: 6,
        maxToolCalls: 6,
        maxInputTokens: 3_000,
        maxOutputTokens: 1_500,
        maxCreditMicros: "300",
        maxDurationMs: 30_000,
      },
    });
  });

  it("rejects scope and lineage drift", () => {
    const plan = delegationPlan();
    const result = validateAgentDelegationPlan({
      plan: { ...plan, delegatedByRunId: "run-elsewhere" },
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("scope-mismatch");
  });

  it("rejects duplicate ids without misreporting a dependency cycle", () => {
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([
        delegatedTask("duplicate"),
        delegatedTask("duplicate"),
      ]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("duplicate-task");
    expect(issueCodes(result)).not.toContain("dependency-cycle");
  });

  it.each([
    ["missing", delegatedTask("render", ["unknown"])],
    ["self", delegatedTask("render", ["render"])],
  ])("rejects a %s dependency", (_label, invalidTask) => {
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([invalidTask]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("dependency-invalid");
  });

  it("rejects a dependency cycle", () => {
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([
        delegatedTask("left", ["right"]),
        delegatedTask("right", ["left"]),
      ]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("dependency-cycle");
  });

  it.each([
    [
      "depth-exceeded",
      delegationPlan(),
      delegationAuthority({ currentDepth: 3 }),
    ],
    [
      "task-limit-exceeded",
      delegationPlan([delegatedTask("one"), delegatedTask("two")]),
      delegationAuthority({ policy: { ...policy(), maxTasks: 1 } }),
    ],
    [
      "concurrency-invalid",
      { ...delegationPlan(), maxConcurrency: 2 },
      delegationAuthority(),
    ],
  ] as const)("enforces the %s policy", (code, plan, authority) => {
    const result = validateAgentDelegationPlan({ plan, authority });

    expect(issueCodes(result)).toContain(code);
  });

  it.each([
    [
      "permission-not-granted",
      grantTask({ permissions: ["admin.write"] }),
    ],
    ["tool-not-granted", grantTask({ toolNames: ["admin.delete"] })],
    ["skill-not-granted", grantTask({ skillRefs: ["unknown@1"] })],
    [
      "mcp-not-granted",
      grantTask({ mcpConnectionRefs: ["unknown-mcp@1"] }),
    ],
    [
      "compute-not-granted",
      grantTask({ computeCapabilities: ["browser"] }),
    ],
  ] as const)("rejects %s escalation", (code, invalidTask) => {
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([invalidTask]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain(code);
  });

  it.each([
    [
      "another Run",
      {
        ...delegatedTask("research").context,
        sourceRunId: "run-elsewhere",
      },
    ],
    [
      "an empty artifact",
      { ...delegatedTask("research").context, artifactRefs: [""] },
    ],
    [
      "a stale ContextSnapshot",
      { ...delegatedTask("research").context, sourceContextVersion: 1 },
    ],
    [
      "an oversized package",
      {
        ...delegatedTask("research").context,
        facts: [
          {
            key: "brief",
            value: "x".repeat(2_000),
            classification: "workspace" as const,
          },
        ],
      },
    ],
  ])("rejects context from %s", (_label, context) => {
    const task = delegatedTask("research");
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([{ ...task, context }]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("context-invalid");
  });

  it("rejects an unbounded or non-object result contract", () => {
    const task = delegatedTask("research");
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([
        {
          ...task,
          result: {
            ...task.result,
            outputSchema: { type: "string" },
            maxBytes: 100_000,
          },
        },
      ]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("result-contract-invalid");
  });

  it.each([
    [
      "restricted classification",
      {
        ...delegatedTask("research").context,
        facts: [
          {
            key: "secret",
            value: "restricted data",
            classification: "restricted" as const,
          },
        ],
      },
    ],
    [
      "unauthorized artifact",
      {
        ...delegatedTask("research").context,
        artifactRefs: ["artifact:not-authorized"],
      },
    ],
  ])("rejects %s in an otherwise valid context", (_label, context) => {
    const task = delegatedTask("research");
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([{ ...task, context }]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("context-not-granted");
  });

  it("rejects an invalid child budget", () => {
    const task = delegatedTask("research");
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([
        { ...task, budget: { ...task.budget, maxModelCalls: 0 } },
      ]),
      authority: delegationAuthority(),
    });

    expect(issueCodes(result)).toContain("budget-invalid");
  });

  it("rejects aggregate child budget above the parent remainder", () => {
    const result = validateAgentDelegationPlan({
      plan: delegationPlan([
        delegatedTask("one"),
        delegatedTask("two"),
      ]),
      authority: delegationAuthority({
        remainingBudget: { ...remainingBudget(), maxModelCalls: 3 },
      }),
    });

    expect(issueCodes(result)).toContain("budget-exceeded");
  });

  it("reports malformed server budget as data instead of throwing BigInt", () => {
    const result = validateAgentDelegationPlan({
      plan: delegationPlan(),
      authority: delegationAuthority({
        remainingBudget: {
          ...remainingBudget(),
          maxCreditMicros: "not-an-integer",
        },
      }),
    });

    expect(issueCodes(result)).toContain("budget-invalid");
  });
});

function delegationPlan(
  tasks: readonly AgentDelegationTask[] = [delegatedTask("research")],
): AgentDelegationPlan {
  return {
    schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
    planId: "plan-1",
    revision: 0,
    workspaceId: "workspace-1",
    projectId: "project-1",
    sessionId: "session-1",
    rootRunId: "run-root",
    delegatedByRunId: "run-root",
    maxConcurrency: 1,
    failureMode: "isolate",
    tasks,
    createdAt: "2026-07-29T00:00:00.000Z",
  };
}

function delegatedTask(
  taskId: string,
  dependsOn: readonly string[] = [],
): AgentDelegationTask {
  return {
    taskId,
    objective: `Complete ${taskId}.`,
    profile: { profileId: "image-specialist", version: "1.0.0" },
    dependsOn,
    context: {
      sourceRunId: "run-root",
      sourceContextVersion: 2,
      facts: [
        {
          key: "brief",
          value: "Create one campaign image.",
          classification: "workspace",
        },
      ],
      artifactRefs: ["artifact:brief-1"],
    },
    grant: {
      permissions: ["image.generate"],
      toolNames: ["image.generate"],
      skillRefs: ["image-direction@1.0.0"],
      mcpConnectionRefs: ["asset-search@1.0.0"],
      computeCapabilities: ["media-processing"],
    },
    budget: {
      maxTurns: 2,
      maxModelCalls: 2,
      maxToolCalls: 2,
      maxInputTokens: 1_000,
      maxOutputTokens: 500,
      maxCreditMicros: "100",
      maxDurationMs: 10_000,
    },
    result: {
      outputSchema: {
        type: "object",
        properties: { assetRef: { type: "string" } },
        required: ["assetRef"],
      },
      maxBytes: 8_192,
      requiredEvidenceKinds: ["asset"],
    },
  };
}

function grantTask(
  grant: Partial<AgentDelegationTask["grant"]>,
): AgentDelegationTask {
  const task = delegatedTask("research");
  return { ...task, grant: { ...task.grant, ...grant } };
}

function policy() {
  return {
    maxDepth: 3,
    maxTasks: 8,
    maxConcurrency: 4,
    maxContextCharactersPerTask: 1_024,
    maxResultBytesPerTask: 16_384,
  };
}

function remainingBudget() {
  return {
    maxTurns: 20,
    maxModelCalls: 20,
    maxToolCalls: 20,
    maxInputTokens: 20_000,
    maxOutputTokens: 10_000,
    maxCreditMicros: "10000",
    maxDurationMs: 60_000,
  };
}

function delegationAuthority(
  overrides: Partial<AgentDelegationAuthoritySnapshot> = {},
): AgentDelegationAuthoritySnapshot {
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    sessionId: "session-1",
    rootRunId: "run-root",
    delegatedByRunId: "run-root",
    sourceContextVersion: 2,
    currentDepth: 0,
    policy: policy(),
    delegablePermissions: ["image.generate"],
    delegableToolNames: ["image.generate"],
    delegableSkillRefs: ["image-direction@1.0.0"],
    delegableMcpConnectionRefs: ["asset-search@1.0.0"],
    delegableComputeCapabilities: ["media-processing"],
    delegableContextClassifications: ["public", "workspace"],
    delegableArtifactRefs: ["artifact:brief-1"],
    remainingBudget: remainingBudget(),
    ...overrides,
  };
}

function issueCodes(result: AgentDelegationValidation) {
  return result.ok ? [] : result.issues.map(({ code }) => code);
}
