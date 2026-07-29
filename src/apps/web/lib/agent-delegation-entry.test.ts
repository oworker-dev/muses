import { describe, expect, it, vi } from "vitest"

import {
  AGENT_CORE_SCHEMA_VERSION,
  type AgentDelegationAuthoritySnapshot,
  type AgentDelegationPlan,
  type AgentRunSnapshot,
  type AgentToolExecutionContext,
} from "@muses/agent-core"

import {
  agentDelegateDefinitionForRun,
  agentDelegationToolInputSchema,
  submitAuthorizedAgentDelegation,
  type AgentDelegationEntryDependencies,
  type AgentDelegationToolInput,
} from "./agent-delegation-entry"

const now = new Date("2026-07-30T08:00:05.000Z")

describe("Agent delegation entry", () => {
  it("derives scope, lineage, context and remaining budget from the persisted parent Run", async () => {
    const root = agentRun({ runId: "run-root" })
    const child = agentRun({
      runId: "run-child",
      parent: {
        runId: root.runId,
        rootRunId: root.runId,
        delegationPlanId: "prior-plan",
        delegationPlanRevision: 1,
        delegationTaskId: "prior-task",
      },
    })
    let submission:
      | {
          plan: AgentDelegationPlan
          authority: AgentDelegationAuthoritySnapshot
          idempotencyKey: string
        }
      | undefined
    const ensureDriver = vi.fn(async () => ({ state: "attached" }))
    const dependencies = entryDependencies({
      loadRun: async (_workspaceId, runId) =>
        runId === child.runId ? child : runId === root.runId ? root : null,
      submit: async (input) => {
        submission = input
        return acceptedSubmission()
      },
      ensureDriver,
    })

    const result = await submitAuthorizedAgentDelegation({
      context: executionContext(child),
      request: delegationRequest(),
      dependencies,
    })

    expect(submission?.plan).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
      sessionId: "session-1",
      rootRunId: "run-root",
      delegatedByRunId: "run-child",
      tasks: [
        {
          context: {
            sourceRunId: "run-child",
            sourceContextVersion: 7,
          },
        },
      ],
    })
    expect(submission?.authority).toMatchObject({
      rootRunId: "run-root",
      delegatedByRunId: "run-child",
      currentDepth: 1,
      sourceContextVersion: 7,
      delegableComputeCapabilities: ["media-processing"],
      remainingBudget: {
        maxTurns: 7,
        maxModelCalls: 6,
        maxToolCalls: 4,
        maxInputTokens: 9_000,
        maxOutputTokens: 4_500,
        maxCreditMicros: "875",
        maxDurationMs: 895_000,
      },
    })
    expect(submission?.idempotencyKey).toBe("tool-call-identity:delegation")
    expect(ensureDriver).toHaveBeenCalledWith("delegation-1")
    expect(result).toMatchObject({
      accepted: true,
      delegationRunId: "delegation-1",
      submissionReceiptId: "receipt-1",
      driver: { state: "attached" },
    })
  })

  it("projects deterministic parent headroom and a standard image budget to the model", () => {
    const definition = agentDelegateDefinitionForRun(
      agentRun({ runId: "run-root" })
    )

    expect(definition.description).toContain(
      '"maxTurns":7,"maxModelCalls":6,"maxToolCalls":4'
    )
    expect(definition.description).toContain(
      '"maxTurns":2,"maxModelCalls":2,"maxToolCalls":1'
    )
    expect(definition.description).toContain(
      "Never copy the whole parent envelope into each task."
    )
  })

  it("rejects model-supplied scope and authority fields", () => {
    expect(() =>
      agentDelegationToolInputSchema.parse({
        ...delegationRequest(),
        workspaceId: "workspace-attacker",
        rootRunId: "run-attacker",
        currentDepth: 0,
        sourceContextVersion: 999,
      })
    ).toThrow()
  })

  it("rejects grants outside persisted authority before Scheduler submission", async () => {
    const run = agentRun({ runId: "run-root" })
    const submit = vi.fn(async () => acceptedSubmission())
    const ensureDriver = vi.fn(async () => ({ state: "attached" }))
    const request = delegationRequest()

    await expect(
      submitAuthorizedAgentDelegation({
        context: executionContext(run),
        request: {
          ...request,
          tasks: [
            {
              ...request.tasks[0],
              grant: {
                ...request.tasks[0].grant,
                permissions: ["filesystem.write"],
                toolNames: ["shell.execute"],
                computeCapabilities: ["code"],
              },
            },
          ],
        },
        dependencies: entryDependencies({
          loadRun: async () => run,
          submit,
          ensureDriver,
        }),
      })
    ).rejects.toThrow("Delegation plan was rejected")
    expect(submit).not.toHaveBeenCalled()
    expect(ensureDriver).not.toHaveBeenCalled()
  })

  it("rejects a stale or cross-scope execution context", async () => {
    const run = agentRun({ runId: "run-root", status: "completed" })
    const submit = vi.fn(async () => acceptedSubmission())

    await expect(
      submitAuthorizedAgentDelegation({
        context: {
          ...executionContext(run),
          projectId: "project-attacker",
        },
        request: delegationRequest(),
        dependencies: entryDependencies({
          loadRun: async () => run,
          submit,
        }),
      })
    ).rejects.toThrow("execution authority is no longer active")
    expect(submit).not.toHaveBeenCalled()
  })
})

function delegationRequest(): AgentDelegationToolInput {
  return {
    planId: "plan-1",
    revision: 0,
    maxConcurrency: 1,
    failureMode: "fail-fast",
    tasks: [
      {
        taskId: "render",
        objective: "Generate the approved campaign image.",
        profileId: "muses-image-specialist",
        profileVersion: "0.1.0-alpha",
        dependsOn: [],
        facts: [
          {
            key: "campaign",
            value: "Summer launch",
            classification: "workspace",
          },
        ],
        artifactRefs: ["asset-1"],
        grant: {
          permissions: ["image.generate", "canvas.write"],
          toolNames: ["image.generate"],
          skillRefs: [],
          mcpConnectionRefs: [],
          computeCapabilities: ["media-processing"],
        },
        budget: {
          maxTurns: 2,
          maxModelCalls: 2,
          maxToolCalls: 2,
          maxInputTokens: 1_000,
          maxOutputTokens: 500,
          maxCreditMicros: "100",
          maxDurationMs: 30_000,
        },
        result: {
          outputSchema: {
            type: "object",
            properties: { assetId: { type: "string" } },
            required: ["assetId"],
            additionalProperties: false,
          },
          maxBytes: 1_024,
          requiredEvidenceKinds: ["artifact"],
        },
      },
    ],
  }
}

function agentRun(input: {
  runId: string
  parent?: AgentRunSnapshot["parent"]
  status?: AgentRunSnapshot["status"]
}): AgentRunSnapshot {
  return {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    runId: input.runId,
    parent: input.parent,
    session: {
      schemaVersion: AGENT_CORE_SCHEMA_VERSION,
      sessionId: "session-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      canvasId: "canvas-1",
      createdAt: "2026-07-30T08:00:00.000Z",
      updatedAt: "2026-07-30T08:00:00.000Z",
    },
    profile: {
      profileId: "muses-agent",
      version: "0.1.0-alpha",
      modelRef: "fixture/model",
      instructions: "Use bounded tools.",
      toolNames: ["agent.delegate", "image.generate"],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    status: input.status || "running",
    revision: 3,
    turn: 1,
    context: {
      version: 7,
      messages: [],
      artifactRefs: ["asset-1"],
      createdAt: "2026-07-30T08:00:00.000Z",
    },
    budget: {
      limit: {
        maxTurns: 8,
        maxModelCalls: 8,
        maxToolCalls: 8,
        maxInputTokens: 10_000,
        maxOutputTokens: 5_000,
        maxCreditMicros: "1000",
        maxDurationMs: 900_000,
      },
      usage: {
        turns: 1,
        modelCalls: 2,
        toolCalls: 3,
        inputTokens: 1_000,
        outputTokens: 500,
        creditMicros: "125",
        startedAt: "2026-07-30T08:00:00.000Z",
      },
    },
    permissions: ["agent.delegate", "image.generate", "canvas.write"],
    metadata: {},
    pendingMessages: [],
    pendingToolCalls: [],
    createdAt: "2026-07-30T08:00:00.000Z",
    updatedAt: "2026-07-30T08:00:00.000Z",
  }
}

function executionContext(run: AgentRunSnapshot): AgentToolExecutionContext {
  return {
    workspaceId: run.session.workspaceId,
    projectId: run.session.projectId,
    canvasId: run.session.canvasId,
    sessionId: run.session.sessionId,
    runId: run.runId,
    permissions: run.permissions,
    metadata: run.metadata,
    idempotencyKey: "tool-call-identity",
  }
}

function entryDependencies(
  overrides: Partial<AgentDelegationEntryDependencies> = {}
): AgentDelegationEntryDependencies {
  return {
    loadRun: async () => null,
    submit: async () => acceptedSubmission(),
    ensureDriver: async () => ({ state: "attached" }),
    now: () => now,
    ...overrides,
  }
}

function acceptedSubmission() {
  return {
    receipt: { receiptId: "receipt-1" },
    run: {
      delegationRunId: "delegation-1",
      status: "queued",
      tasks: [{ taskId: "render", status: "ready" }],
    },
  }
}
