import { describe, expect, it, vi } from "vitest"

import type {
  AgentDelegationArtifactAuthorizationPort,
  AgentDelegationTask,
  AgentDelegationTaskResult,
  AgentProfileSnapshot,
} from "@muses/agent-core"

vi.mock("./agent-delegation-store", () => ({
  PostgresAgentDelegationBudget: class {},
  PostgresAgentDelegationStore: class {},
}))
vi.mock("./database", () => ({ getPgPool: vi.fn() }))
vi.mock("./agent-runtime", () => ({ musesAgentProfile: vi.fn() }))

import {
  AjvAgentDelegationResultValidator,
  Sha256AgentDelegationFingerprint,
  VersionedAgentProfileRegistry,
} from "./agent-delegation-runtime"

describe("Sha256AgentDelegationFingerprint", () => {
  it("is stable across object key order", () => {
    const fingerprints = new Sha256AgentDelegationFingerprint()

    expect(fingerprints.fingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(
      fingerprints.fingerprint({ a: { c: 3, d: 4 }, b: 2 })
    )
  })

  it("preserves array order and rejects values outside strict JSON", () => {
    const fingerprints = new Sha256AgentDelegationFingerprint()
    const sparse = new Array(2)
    sparse[1] = "value"

    expect(fingerprints.fingerprint(["a", "b"])).not.toBe(
      fingerprints.fingerprint(["b", "a"])
    )
    expect(() => fingerprints.fingerprint(sparse)).toThrow("Sparse JSON array")
    expect(() => fingerprints.fingerprint({ value: undefined })).toThrow(
      "Unsupported JSON value"
    )
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => fingerprints.fingerprint(cyclic)).toThrow("Cyclic JSON value")
  })
})

describe("VersionedAgentProfileRegistry", () => {
  it("resolves only an exact Profile version inside its registered scope", async () => {
    const profile = agentProfile()
    const registry = new VersionedAgentProfileRegistry([
      {
        profile,
        workspaceIds: ["workspace-1"],
        projectIds: ["project-1"],
      },
    ])

    await expect(
      registry.resolve({
        workspaceId: "workspace-1",
        projectId: "project-1",
        profileId: profile.profileId,
        version: profile.version,
      })
    ).resolves.toEqual(profile)
    await expect(
      registry.resolve({
        workspaceId: "workspace-1",
        projectId: "project-2",
        profileId: profile.profileId,
        version: profile.version,
      })
    ).resolves.toBeNull()
    await expect(
      registry.resolve({
        workspaceId: "workspace-1",
        projectId: "project-1",
        profileId: profile.profileId,
        version: "2.0.0",
      })
    ).resolves.toBeNull()
  })

  it("rejects malformed and duplicate Profile registrations", () => {
    expect(
      () =>
        new VersionedAgentProfileRegistry([
          {
            profile: {
              ...agentProfile(),
              toolNames: ["image.generate", "image.generate"],
            },
          },
        ])
    ).toThrow(expect.objectContaining({ code: "delegation-profile-invalid" }))

    expect(
      () =>
        new VersionedAgentProfileRegistry([
          { profile: agentProfile() },
          { profile: agentProfile() },
        ])
    ).toThrow(expect.objectContaining({ code: "delegation-profile-invalid" }))
  })
})

describe("AjvAgentDelegationResultValidator", () => {
  it("accepts a Schema-conforming result with authorized Artifact evidence", async () => {
    const validator = resultValidator(["asset-1"])

    await expect(
      validator.validate(validationInput(validResult()))
    ).resolves.toEqual({ ok: true })
  })

  it("rejects Schema mismatch and oversized or non-JSON results", async () => {
    const validator = resultValidator(["asset-1"])

    await expect(
      validator.validate(
        validationInput({ ...validResult(), data: { title: 42 } })
      )
    ).resolves.toMatchObject({ ok: false, code: "result-schema-mismatch" })
    await expect(
      validator.validate(
        validationInput(validResult(), {
          task: {
            ...delegatedTask(),
            result: { ...delegatedTask().result, maxBytes: 8 },
          },
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "result-size-exceeded" })
    await expect(
      validator.validate(
        validationInput({ ...validResult(), data: undefined })
      )
    ).resolves.toMatchObject({ ok: false, code: "result-not-json" })
  })

  it("rejects missing or unauthorized evidence", async () => {
    const validator = resultValidator(["asset-1"])

    await expect(
      validator.validate(
        validationInput({ ...validResult(), evidence: [] })
      )
    ).resolves.toMatchObject({ ok: false, code: "result-evidence-missing" })
    await expect(
      validator.validate(
        validationInput({
          ...validResult(),
          evidence: [{ kind: "artifact", ref: "asset-2" }],
        })
      )
    ).resolves.toMatchObject({
      ok: false,
      code: "result-evidence-not-authorized",
    })
  })

  it("rejects Artifact references outside the authorized Project", async () => {
    const validator = resultValidator([])

    await expect(
      validator.validate(validationInput(validResult()))
    ).resolves.toMatchObject({
      ok: false,
      code: "result-artifact-not-authorized",
    })
  })
})

function agentProfile(): AgentProfileSnapshot {
  return {
    profileId: "image-specialist",
    version: "1.0.0",
    modelRef: "fixture/model",
    instructions: "Generate one image.",
    toolNames: ["image.generate"],
    skillRefs: [],
    mcpConnectionRefs: [],
  }
}

function delegatedTask(): AgentDelegationTask {
  return {
    taskId: "render",
    objective: "Render one campaign image.",
    profile: { profileId: "image-specialist", version: "1.0.0" },
    dependsOn: [],
    context: {
      sourceRunId: "run-root",
      sourceContextVersion: 1,
      facts: [],
      artifactRefs: [],
    },
    grant: {
      permissions: ["image.generate"],
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
      maxCreditMicros: "1000",
      maxDurationMs: 30_000,
    },
    result: {
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
      maxBytes: 8_192,
      requiredEvidenceKinds: ["artifact"],
    },
  }
}

function validResult(): AgentDelegationTaskResult {
  return {
    data: { title: "Campaign" },
    artifactRefs: ["asset-1"],
    evidence: [{ kind: "artifact", ref: "asset-1" }],
  }
}

function validationInput(
  result: AgentDelegationTaskResult,
  overrides: Partial<{
    workspaceId: string
    projectId: string
    task: AgentDelegationTask
  }> = {}
) {
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    task: delegatedTask(),
    result,
    ...overrides,
  }
}

function resultValidator(authorizedRefs: readonly string[]) {
  const authorized = new Set(authorizedRefs)
  const artifacts: AgentDelegationArtifactAuthorizationPort = {
    authorize: async ({ artifactRefs }) => {
      const unauthorized = artifactRefs.filter((ref) => !authorized.has(ref))
      return unauthorized.length === 0
        ? { ok: true }
        : { ok: false, unauthorized }
    },
  }
  return new AjvAgentDelegationResultValidator(artifacts)
}
