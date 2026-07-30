import { describe, expect, it, vi } from "vitest"

import {
  DefaultAgentPolicy,
  HeadlessAgentRuntime,
  InMemoryAgentStateStore,
  RandomAgentIdPort,
  agentDelegationParentRef,
  type AgentBudgetLimit,
  type AgentDelegationChildRuntimePort,
  type AgentDelegationFingerprintPort,
  type AgentModelPort,
  type AgentProfileSnapshot,
  type AgentRuntimePort,
  type AgentToolRegistryPort,
} from "@muses/agent-core"

vi.mock("./agent-cancellation", () => ({
  cancelAgentRunAndChildren: vi.fn(),
}))
vi.mock("./agent-delegation-runtime", () => ({
  Sha256AgentDelegationFingerprint: class {},
}))
vi.mock("./agent-driver", () => ({ ensureAgentDriver: vi.fn() }))
vi.mock("./agent-runtime", () => ({ createMusesAgentRuntime: vi.fn() }))
vi.mock("./database", () => ({ getPgPool: vi.fn() }))

import {
  MusesAgentDelegationChildRuntime,
  type AgentDelegationChildCancellationPort,
  type AgentDelegationChildCostOutcomePort,
  type AgentDelegationChildDriverPort,
} from "./agent-delegation-child-runtime"

describe("MusesAgentDelegationChildRuntime", () => {
  it("creates an independent least-authority child Run without parent metadata leakage", async () => {
    const fixture = await childFixture()

    const child = await fixture.children.start(childStart())
    const run = await fixture.runtime.inspect(child.childRunId)

    expect(child).toMatchObject({
      childRunId: "arun-child",
      childSandboxId: "logical-arun-child",
      status: "queued",
    })
    expect(run.parent).toEqual(childStart().parent)
    expect(run.permissions).toEqual(["image.generate"])
    expect(run.extensions?.logicalSandbox).toMatchObject({
      sandboxId: "logical-arun-child",
      scope: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        sessionId: "session-1",
        runId: "arun-child",
        parentRunId: "arun-root",
      },
      filesystem: {
        persistence: "ephemeral",
        namespace: "agent-run/arun-child",
      },
      network: { default: "deny" },
    })
    expect(run.metadata).toMatchObject({ initiatedByUserId: "user-1" })
    expect(run.metadata).not.toHaveProperty("privateParentFact")
    expect(fixture.drivers.ensure).toHaveBeenCalledWith("arun-child")
  })

  it("replays the exact child start and rejects idempotency drift", async () => {
    const fixture = await childFixture()
    const input = childStart()

    const first = await fixture.children.start(input)
    const replay = await fixture.children.start(input)

    expect(replay).toEqual(first)
    await expect(
      fixture.children.start({ ...input, objective: "Changed objective" })
    ).rejects.toMatchObject({ code: "revision-conflict" })
  })

  it("projects a terminal structured result and settled Agent usage", async () => {
    const fixture = await childFixture({ drive: true })

    const child = await fixture.children.start(childStart())

    expect(child).toMatchObject({
      status: "completed",
      result: {
        data: { title: "Campaign" },
        artifactRefs: ["asset-1"],
        evidence: [{ kind: "artifact", ref: "asset-1" }],
      },
      usage: {
        modelCalls: 1,
        inputTokens: 7,
        outputTokens: 3,
        creditMicros: "10",
      },
      costOutcome: "known",
    })
  })

  it("fails closed when parent authority does not match the delegated scope", async () => {
    const fixture = await childFixture()

    await expect(
      fixture.children.start({
        ...childStart(),
        session: { ...childStart().session, projectId: "project-2" },
      })
    ).rejects.toMatchObject({ code: "run-state-invalid" })
    await expect(fixture.runtime.inspect("arun-child")).rejects.toMatchObject({
      code: "run-not-found",
    })
  })

  it("retains an accepted delegation when its parent later fails", async () => {
    const fixture = await childFixture({ parentStatus: "failed" })

    const child = await fixture.children.start(childStart())

    expect(child).toMatchObject({
      childRunId: "arun-child",
      status: "queued",
    })
  })

  it("revokes delegated authority when its parent is cancelled", async () => {
    const fixture = await childFixture({ parentStatus: "cancelled" })

    await expect(fixture.children.start(childStart())).rejects.toMatchObject({
      code: "run-state-invalid",
    })
    await expect(fixture.runtime.inspect("arun-child")).rejects.toMatchObject({
      code: "run-not-found",
    })
  })

  it("cancels through the authorized child tree boundary", async () => {
    const fixture = await childFixture()
    await fixture.children.start(childStart())

    const cancelled = await fixture.children.cancel({
      childRunId: "arun-child",
      reason: "Parent failed fast.",
      idempotencyKey: "cancel-child-1",
    })

    expect(cancelled?.status).toBe("cancelled")
    expect(fixture.cancellations.cancel).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      runId: "arun-child",
      requestedByUserId: "user-1",
      idempotencyKey: "cancel-child-1",
      reason: "Parent failed fast.",
    })
  })
})

async function childFixture(
  options: {
    drive?: boolean
    parentStatus?: "queued" | "failed" | "cancelled"
  } = {}
) {
  const runtime = new HeadlessAgentRuntime({
    model:
      options.parentStatus === "failed"
        ? new FailedParentModel()
        : new FixtureModel(),
    tools: new NoTools(),
    policy: new DefaultAgentPolicy(),
    store: new InMemoryAgentStateStore(new RandomAgentIdPort()),
  })
  await runtime.start({
    runId: "arun-root",
    session: {
      workspaceId: "workspace-1",
      projectId: "project-1",
      sessionId: "session-1",
      canvasId: "canvas-1",
    },
    profile: profile(),
    input: "Parent objective",
    budget: budget(),
    permissions: ["image.generate"],
    metadata: {
      initiatedByUserId: "user-1",
      initiatedByEmail: "private@example.com",
      privateParentFact: "must-not-inherit",
    },
  })
  if (options.parentStatus === "failed") await runtime.resume("arun-root")
  if (options.parentStatus === "cancelled") await runtime.cancel("arun-root")
  const drivers: AgentDelegationChildDriverPort = {
    ensure: vi.fn(async (runId: string) => {
      if (options.drive) await runtime.resume(runId)
    }),
  }
  const cancellations: AgentDelegationChildCancellationPort = {
    cancel: vi.fn(async ({ runId }) => {
      await runtime.cancel(runId)
      return "completed" as const
    }),
  }
  const costs: AgentDelegationChildCostOutcomePort = {
    inspect: vi.fn(async () => "known" as const),
  }
  const fingerprints: AgentDelegationFingerprintPort = {
    fingerprint: (value) => JSON.stringify(value),
  }
  return {
    runtime: runtime as AgentRuntimePort,
    drivers,
    cancellations,
    children: new MusesAgentDelegationChildRuntime({
      runtime,
      drivers,
      cancellations,
      costs,
      fingerprints,
    }),
  }
}

function childStart(): Parameters<AgentDelegationChildRuntimePort["start"]>[0] {
  return {
    childRunId: "arun-child",
    parent: agentDelegationParentRef({
      parentRunId: "arun-root",
      rootRunId: "arun-root",
      planId: "plan-1",
      planRevision: 0,
      taskId: "render",
    }),
    session: {
      workspaceId: "workspace-1",
      projectId: "project-1",
      sessionId: "session-1",
    },
    taskId: "render",
    objective: "Render one campaign image.",
    profile: profile(),
    context: {
      sourceRunId: "arun-root",
      sourceContextVersion: 1,
      facts: [
        {
          key: "brief",
          value: "Campaign launch",
          classification: "workspace",
        },
      ],
      artifactRefs: [],
    },
    grant: {
      permissions: ["image.generate"],
      toolNames: ["image.generate"],
      skillRefs: [],
      mcpConnectionRefs: [],
      computeCapabilities: ["media-processing"],
    },
    budget: budget(),
    result: {
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      maxBytes: 8_192,
      requiredEvidenceKinds: ["artifact"],
    },
    idempotencyKey: "delegation-1:render:attempt-1",
  }
}

function profile(): AgentProfileSnapshot {
  return {
    profileId: "muses-agent",
    version: "0.1.0-alpha",
    modelRef: "fixture/model",
    instructions: "Complete the task and return the requested final result.",
    toolNames: ["image.generate"],
    skillRefs: [],
    mcpConnectionRefs: [],
  }
}

function budget(): AgentBudgetLimit {
  return {
    maxTurns: 2,
    maxModelCalls: 2,
    maxToolCalls: 2,
    maxInputTokens: 1_000,
    maxOutputTokens: 500,
    maxCreditMicros: "1000",
    maxDurationMs: 30_000,
  }
}

class FixtureModel implements AgentModelPort {
  estimate() {
    return { inputTokens: 7, outputTokens: 3, creditMicros: "10" }
  }

  async complete() {
    return {
      content: JSON.stringify({
        data: { title: "Campaign" },
        artifactRefs: ["asset-1"],
        evidence: [{ kind: "artifact", ref: "asset-1" }],
      }),
      finishReason: "stop" as const,
      toolCalls: [],
      usage: { inputTokens: 7, outputTokens: 3, creditMicros: "10" },
    }
  }
}

class FailedParentModel implements AgentModelPort {
  estimate() {
    return { inputTokens: 7, outputTokens: 3, creditMicros: "10" }
  }

  async complete(): Promise<never> {
    throw new Error("Fixture parent model failed after delegation acceptance.")
  }
}

class NoTools implements AgentToolRegistryPort {
  async list() {
    return []
  }

  async execute(): Promise<never> {
    throw new Error("No tools are available in this fixture.")
  }
}
