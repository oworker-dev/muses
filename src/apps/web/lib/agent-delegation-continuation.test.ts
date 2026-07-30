import { describe, expect, it, vi } from "vitest"

vi.mock("./agent-delegation-store", () => ({
  PostgresAgentDelegationStore: class {},
}))
vi.mock("./agent-driver", () => ({ ensureAgentDriver: vi.fn() }))
vi.mock("./agent-runtime", () => ({ createMusesAgentRuntime: vi.fn() }))

import type {
  AgentDelegationRecord,
  AgentMessage,
  AgentRuntimePort,
} from "@muses/agent-core"

import type {
  AgentDelegationContinuationIdentity,
  AgentDelegationContinuationReceipt,
} from "./agent-delegation-continuation-store"
import {
  continueAgentDelegationParentWithDependencies,
  createAgentDelegationContinuationProjection,
} from "./agent-delegation-continuation"

describe("Agent delegation parent continuation", () => {
  it("projects only bounded trusted terminal facts", () => {
    const projection = createAgentDelegationContinuationProjection(record())
    const serialized = JSON.stringify(projection)

    expect(projection).toEqual({
      schemaVersion: "0.1.0-draft",
      kind: "agent-delegation-terminal",
      delegationRunId: "delegation-1",
      status: "completed",
      tasks: [
        {
          taskId: "render",
          status: "completed",
          profile: {
            profileId: "muses-image-specialist",
            version: "0.1.0-alpha",
          },
          artifactRefs: ["image-1"],
        },
      ],
      artifactRefs: ["image-1"],
    })
    expect(serialized).not.toContain("UNTRUSTED_CHILD_INSTRUCTION")
    expect(serialized).not.toContain("PRIVATE_CONTEXT_FACT")
    expect(serialized).not.toContain("RAW_RESULT_BODY")
  })

  it("commits one trusted system follow-up and starts the parent driver", async () => {
    let claimedIdentity: AgentDelegationContinuationIdentity | null = null
    const markMessageCommitted = vi.fn(async () => undefined)
    const complete = vi.fn(async () => undefined)
    const followUp = vi.fn(async (_runId: string, _message: AgentMessage) =>
      undefined
    )
    const ensureDriver = vi.fn(async () => ({
      state: "attached",
      driverRunId: "workflow-parent-2",
    }))
    const store = continuationStore({
      claim: async (identity) => {
        claimedIdentity = identity
        return {
          state: "claimed" as const,
          receipt: receipt(identity, "processing", "attempt-1"),
        }
      },
      markMessageCommitted,
      complete,
    })

    const outcome = await continueAgentDelegationParentWithDependencies(record(), {
      store,
      runtime: { followUp } as unknown as AgentRuntimePort,
      ensureDriver,
    })

    expect(outcome).toMatchObject({ state: "completed", idempotentReplay: false })
    expect(followUp).toHaveBeenCalledOnce()
    const [parentRunId, message] = followUp.mock.calls[0]!
    expect(parentRunId).toBe("run-root")
    expect(message).toMatchObject({
      role: "system",
      metadata: {
        kind: "agent-delegation-result",
        delegationRunId: "delegation-1",
      },
    })
    expect(message.content).toContain("image-1")
    expect(message.content).not.toContain("RAW_RESULT_BODY")
    expect(markMessageCommitted).toHaveBeenCalledWith(
      "delegation-1",
      "attempt-1"
    )
    expect(ensureDriver).toHaveBeenCalledWith("run-root")
    expect(complete).toHaveBeenCalledWith(
      "delegation-1",
      "attempt-1",
      expect.objectContaining({ driverRunId: "workflow-parent-2" })
    )
    expect(
      (claimedIdentity as unknown as AgentDelegationContinuationIdentity)
        .projectionFingerprint
    ).toMatch(/^sha256:/)
  })

  it("skips a cancelled delegation without another model turn", async () => {
    const cancelled = record("cancelled")
    const skip = vi.fn(async () => undefined)
    const followUp = vi.fn(async () => undefined)
    const ensureDriver = vi.fn(async () => undefined)
    const store = continuationStore({
      claim: async (identity) => ({
        state: "claimed" as const,
        receipt: receipt(identity, "processing", "attempt-cancel"),
      }),
      skip,
    })

    const outcome = await continueAgentDelegationParentWithDependencies(
      cancelled,
      {
        store,
        runtime: { followUp } as unknown as AgentRuntimePort,
        ensureDriver,
      }
    )

    expect(outcome.state).toBe("skipped")
    expect(skip).toHaveBeenCalledWith(
      "delegation-1",
      "attempt-cancel",
      "delegation-cancelled"
    )
    expect(followUp).not.toHaveBeenCalled()
    expect(ensureDriver).not.toHaveBeenCalled()
  })
})

function continuationStore(
  overrides: Partial<
    Parameters<typeof continueAgentDelegationParentWithDependencies>[1]["store"]
  >
) {
  return {
    claim: async () => {
      throw new Error("Unexpected continuation claim")
    },
    markMessageCommitted: async () => undefined,
    complete: async () => {
      throw new Error("Unexpected continuation completion")
    },
    skip: async () => {
      throw new Error("Unexpected continuation skip")
    },
    fail: async () => {
      throw new Error("Unexpected continuation failure")
    },
    release: async () => false,
    ...overrides,
  } as Parameters<
    typeof continueAgentDelegationParentWithDependencies
  >[1]["store"]
}

function receipt(
  identity: AgentDelegationContinuationIdentity,
  status: AgentDelegationContinuationReceipt["status"],
  attemptId: string | null
): AgentDelegationContinuationReceipt {
  return {
    ...identity,
    status,
    attemptId,
    leaseExpiresAt: attemptId ? "2099-01-01T00:00:00.000Z" : null,
    messageCommittedAt: null,
    parentDriver: null,
    failureCode: null,
    completedAt: null,
  }
}

function record(
  status: "completed" | "cancelled" = "completed"
): AgentDelegationRecord {
  const now = "2026-07-30T00:00:00.000Z"
  return {
    plan: {
      schemaVersion: "0.1.0-draft",
      planId: "plan-1",
      revision: 0,
      workspaceId: "workspace-1",
      projectId: "project-1",
      sessionId: "session-1",
      rootRunId: "run-root",
      delegatedByRunId: "run-root",
      maxConcurrency: 1,
      failureMode: "isolate",
      tasks: [
        {
          taskId: "render",
          objective: "UNTRUSTED_CHILD_INSTRUCTION",
          profile: {
            profileId: "muses-image-specialist",
            version: "0.1.0-alpha",
          },
          dependsOn: [],
          context: {
            sourceRunId: "run-root",
            sourceContextVersion: 1,
            facts: [
              {
                key: "private",
                value: "PRIVATE_CONTEXT_FACT",
                classification: "restricted",
              },
            ],
            artifactRefs: [],
          },
          grant: {
            permissions: [],
            toolNames: [],
            skillRefs: [],
            mcpConnectionRefs: [],
            computeCapabilities: [],
          },
          budget: budget(),
          result: {
            outputSchema: { type: "object" },
            maxBytes: 1024,
            requiredEvidenceKinds: ["artifact"],
          },
        },
      ],
      createdAt: now,
    },
    authority: {} as AgentDelegationRecord["authority"],
    submission: {
      receiptId: "receipt-1",
      delegationRunId: "delegation-1",
      idempotencyKey: "submit-1",
      planId: "plan-1",
      planRevision: 0,
      planFingerprint: "plan-fingerprint",
      authorityFingerprint: "authority-fingerprint",
      submittedAt: now,
    },
    snapshot: {
      schemaVersion: "0.1.0-draft",
      delegationRunId: "delegation-1",
      planId: "plan-1",
      planRevision: 0,
      rootRunId: "run-root",
      parentRunId: "run-root",
      authorityFingerprint: "authority-fingerprint",
      status,
      revision: 3,
      maxConcurrency: 1,
      failureMode: "isolate",
      budgetEnvelope: budget(),
      budgetReservation: {
        reservationId: "budget-1",
        status: status === "cancelled" ? "released" : "settled",
        updatedAt: now,
      },
      tasks: [
        {
          taskId: "render",
          status: status === "cancelled" ? "cancelled" : "completed",
          result:
            status === "cancelled"
              ? undefined
              : {
                  data: { private: "RAW_RESULT_BODY" },
                  artifactRefs: ["image-1", "image-1"],
                  evidence: [{ kind: "artifact", ref: "image-1" }],
                },
        },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    },
  }
}

function budget() {
  return {
    maxTurns: 1,
    maxModelCalls: 1,
    maxToolCalls: 1,
    maxInputTokens: 100,
    maxOutputTokens: 100,
    maxCreditMicros: "100",
    maxDurationMs: 60_000,
  }
}
