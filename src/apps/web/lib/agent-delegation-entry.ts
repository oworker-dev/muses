import { z } from "zod"

import {
  AGENT_DELEGATION_SCHEMA_VERSION,
  validateAgentDelegationPlan,
  type AgentDelegationAuthoritySnapshot,
  type AgentDelegationPlan,
  type AgentRunSnapshot,
  type AgentToolDefinition,
  type AgentToolExecutionContext,
} from "@muses/agent-core"

export const agentDelegateDefinition: AgentToolDefinition = {
  name: "agent.delegate",
  description:
    "Submit a bounded DAG of specialist Agent tasks through the Muses Scheduler. Use only when parallel or dependent specialist work is materially useful; simple requests should use a direct capability. The current image specialist is muses-image-specialist@0.1.0-alpha with toolNames [image.generate], permissions [image.generate, canvas.write], and computeCapabilities [media-processing].",
  inputSchema: {
    type: "object",
    properties: {
      planId: { type: "string", minLength: 1, maxLength: 200 },
      revision: { type: "integer", minimum: 0 },
      maxConcurrency: { type: "integer", minimum: 1, maximum: 4 },
      failureMode: { type: "string", enum: ["fail-fast", "isolate"] },
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            taskId: { type: "string", minLength: 1, maxLength: 120 },
            objective: { type: "string", minLength: 1, maxLength: 8_000 },
            profileId: { type: "string", minLength: 1, maxLength: 200 },
            profileVersion: { type: "string", minLength: 1, maxLength: 100 },
            dependsOn: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 120 },
              maxItems: 8,
            },
            facts: {
              type: "array",
              maxItems: 32,
              items: {
                type: "object",
                properties: {
                  key: { type: "string", minLength: 1, maxLength: 120 },
                  value: { type: "string", maxLength: 8_000 },
                  classification: {
                    type: "string",
                    enum: ["public", "workspace"],
                  },
                },
                required: ["key", "value", "classification"],
                additionalProperties: false,
              },
            },
            artifactRefs: {
              type: "array",
              items: { type: "string", minLength: 1 },
              maxItems: 32,
            },
            grant: {
              type: "object",
              properties: {
                permissions: { type: "array", items: { type: "string" } },
                toolNames: { type: "array", items: { type: "string" } },
                skillRefs: { type: "array", items: { type: "string" } },
                mcpConnectionRefs: {
                  type: "array",
                  items: { type: "string" },
                },
                computeCapabilities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "code",
                      "cli",
                      "browser",
                      "untrusted-file",
                      "media-processing",
                    ],
                  },
                },
              },
              required: [
                "permissions",
                "toolNames",
                "skillRefs",
                "mcpConnectionRefs",
                "computeCapabilities",
              ],
              additionalProperties: false,
            },
            budget: budgetJsonSchema(),
            result: {
              type: "object",
              properties: {
                outputSchema: { type: "object" },
                maxBytes: { type: "integer", minimum: 1, maximum: 64_000 },
                requiredEvidenceKinds: {
                  type: "array",
                  items: { type: "string", minLength: 1 },
                  maxItems: 16,
                },
              },
              required: ["outputSchema", "maxBytes", "requiredEvidenceKinds"],
              additionalProperties: false,
            },
          },
          required: [
            "taskId",
            "objective",
            "profileId",
            "profileVersion",
            "dependsOn",
            "facts",
            "artifactRefs",
            "grant",
            "budget",
            "result",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["planId", "revision", "maxConcurrency", "failureMode", "tasks"],
    additionalProperties: false,
  },
  requiredPermissions: ["agent.delegate"],
  sideEffect: "external",
}

const budgetSchema = z
  .object({
    maxTurns: z.number().int().min(1),
    maxModelCalls: z.number().int().min(1),
    maxToolCalls: z.number().int().min(0),
    maxInputTokens: z.number().int().min(1),
    maxOutputTokens: z.number().int().min(1),
    maxCreditMicros: z.string().regex(/^\d+$/),
    maxDurationMs: z.number().int().min(1),
  })
  .strict()

const grantSchema = z
  .object({
    permissions: z.array(z.string().trim().min(1)).max(32),
    toolNames: z.array(z.string().trim().min(1)).max(32),
    skillRefs: z.array(z.string().trim().min(1)).max(32),
    mcpConnectionRefs: z.array(z.string().trim().min(1)).max(32),
    computeCapabilities: z
      .array(
        z.enum(["code", "cli", "browser", "untrusted-file", "media-processing"])
      )
      .max(8),
  })
  .strict()

export const agentDelegationToolInputSchema = z
  .object({
    planId: z.string().trim().min(1).max(200),
    revision: z.number().int().min(0),
    maxConcurrency: z.number().int().min(1).max(4),
    failureMode: z.enum(["fail-fast", "isolate"]),
    tasks: z
      .array(
        z
          .object({
            taskId: z.string().trim().min(1).max(120),
            objective: z.string().trim().min(1).max(8_000),
            profileId: z.string().trim().min(1).max(200),
            profileVersion: z.string().trim().min(1).max(100),
            dependsOn: z.array(z.string().trim().min(1).max(120)).max(8),
            facts: z
              .array(
                z
                  .object({
                    key: z.string().trim().min(1).max(120),
                    value: z.string().max(8_000),
                    classification: z.enum(["public", "workspace"]),
                  })
                  .strict()
              )
              .max(32),
            artifactRefs: z.array(z.string().trim().min(1)).max(32),
            grant: grantSchema,
            budget: budgetSchema,
            result: z
              .object({
                outputSchema: z.record(z.string(), z.unknown()),
                maxBytes: z.number().int().min(1).max(64_000),
                requiredEvidenceKinds: z
                  .array(z.string().trim().min(1))
                  .max(16),
              })
              .strict(),
          })
          .strict()
      )
      .min(1)
      .max(8),
  })
  .strict()

export type AgentDelegationToolInput = z.infer<
  typeof agentDelegationToolInputSchema
>

export type AgentDelegationEntryDependencies = {
  loadRun(workspaceId: string, runId: string): Promise<AgentRunSnapshot | null>
  submit(input: {
    readonly plan: AgentDelegationPlan
    readonly authority: AgentDelegationAuthoritySnapshot
    readonly idempotencyKey: string
  }): Promise<{
    readonly receipt: { readonly receiptId: string }
    readonly run: {
      readonly delegationRunId: string
      readonly status: string
      readonly tasks: readonly {
        readonly taskId: string
        readonly status: string
      }[]
    }
  }>
  ensureDriver(delegationRunId: string): Promise<unknown>
  now(): Date
}

export async function submitAuthorizedAgentDelegation(input: {
  context: AgentToolExecutionContext
  request: AgentDelegationToolInput
  dependencies: AgentDelegationEntryDependencies
}) {
  const parent = await input.dependencies.loadRun(
    input.context.workspaceId,
    input.context.runId
  )
  assertExecutionAuthority(parent, input.context)
  const authority = await createAuthoritySnapshot(
    parent!,
    input.dependencies,
    input.dependencies.now()
  )
  const plan = createPlan(input.request, authority, input.dependencies.now())
  const validation = validateAgentDelegationPlan({ plan, authority })
  if (!validation.ok) {
    throw new Error(
      `Delegation plan was rejected: ${validation.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`
    )
  }
  const submitted = await input.dependencies.submit({
    plan,
    authority,
    idempotencyKey: `${input.context.idempotencyKey}:delegation`,
  })
  const driver = await input.dependencies.ensureDriver(
    submitted.run.delegationRunId
  )
  return {
    accepted: true,
    delegationRunId: submitted.run.delegationRunId,
    submissionReceiptId: submitted.receipt.receiptId,
    status: submitted.run.status,
    tasks: submitted.run.tasks,
    driver,
  }
}

async function createAuthoritySnapshot(
  run: AgentRunSnapshot,
  dependencies: AgentDelegationEntryDependencies,
  now: Date
): Promise<AgentDelegationAuthoritySnapshot> {
  const rootRunId = run.parent?.rootRunId || run.runId
  let current = run
  let currentDepth = 0
  const visited = new Set([run.runId])
  while (current.parent) {
    currentDepth += 1
    if (currentDepth > 3 || visited.has(current.parent.runId)) {
      throw new Error(
        "Agent delegation lineage is cyclic or exceeds policy depth."
      )
    }
    visited.add(current.parent.runId)
    const parent = await dependencies.loadRun(
      run.session.workspaceId,
      current.parent.runId
    )
    if (
      !parent ||
      parent.session.projectId !== run.session.projectId ||
      parent.session.sessionId !== run.session.sessionId ||
      (parent.parent?.rootRunId || parent.runId) !== rootRunId
    ) {
      throw new Error("Agent delegation parent lineage is not authorized.")
    }
    current = parent
  }
  const skillRefs = run.extensions
    ? run.extensions.skills.map(
        ({ skillId, version }) => `${skillId}@${version}`
      )
    : run.profile.skillRefs
  const mcpConnectionRefs = run.extensions
    ? run.extensions.mcpConnections.map(
        ({ connectionId, version }) => `${connectionId}@${version}`
      )
    : run.profile.mcpConnectionRefs
  const toolNames =
    run.extensions?.logicalSandbox.allowedToolNames || run.profile.toolNames
  return {
    workspaceId: run.session.workspaceId,
    projectId: run.session.projectId,
    sessionId: run.session.sessionId,
    rootRunId,
    delegatedByRunId: run.runId,
    sourceContextVersion: run.context.version,
    currentDepth,
    policy: {
      maxDepth: 3,
      maxTasks: 8,
      maxConcurrency: 4,
      maxContextCharactersPerTask: 10_000,
      maxResultBytesPerTask: 64_000,
    },
    delegablePermissions: run.permissions,
    delegableToolNames: toolNames,
    delegableSkillRefs: skillRefs,
    delegableMcpConnectionRefs: mcpConnectionRefs,
    delegableComputeCapabilities: run.permissions.includes("image.generate")
      ? ["media-processing"]
      : [],
    delegableContextClassifications: ["public", "workspace"],
    delegableArtifactRefs: run.context.artifactRefs,
    remainingBudget: remainingBudget(run, now),
  }
}

function createPlan(
  request: AgentDelegationToolInput,
  authority: AgentDelegationAuthoritySnapshot,
  now: Date
): AgentDelegationPlan {
  return {
    schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
    planId: request.planId,
    revision: request.revision,
    workspaceId: authority.workspaceId,
    projectId: authority.projectId,
    sessionId: authority.sessionId,
    rootRunId: authority.rootRunId,
    delegatedByRunId: authority.delegatedByRunId,
    maxConcurrency: request.maxConcurrency,
    failureMode: request.failureMode,
    tasks: request.tasks.map((task) => ({
      taskId: task.taskId,
      objective: task.objective,
      profile: {
        profileId: task.profileId,
        version: task.profileVersion,
      },
      dependsOn: task.dependsOn,
      context: {
        sourceRunId: authority.delegatedByRunId,
        sourceContextVersion: authority.sourceContextVersion,
        facts: task.facts,
        artifactRefs: task.artifactRefs,
      },
      grant: task.grant,
      budget: task.budget,
      result: task.result,
    })),
    createdAt: now.toISOString(),
  }
}

function assertExecutionAuthority(
  run: AgentRunSnapshot | null,
  context: AgentToolExecutionContext
): asserts run is AgentRunSnapshot {
  if (
    !run ||
    run.runId !== context.runId ||
    run.session.workspaceId !== context.workspaceId ||
    run.session.projectId !== context.projectId ||
    run.session.sessionId !== context.sessionId ||
    run.status !== "running" ||
    !run.permissions.includes("agent.delegate")
  ) {
    throw new Error("Agent delegation execution authority is no longer active.")
  }
}

function remainingBudget(run: AgentRunSnapshot, now: Date) {
  const { limit, usage } = run.budget
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(usage.startedAt))
  return {
    maxTurns: remaining(limit.maxTurns, usage.turns),
    maxModelCalls: remaining(limit.maxModelCalls, usage.modelCalls),
    maxToolCalls: remaining(limit.maxToolCalls, usage.toolCalls),
    maxInputTokens: remaining(limit.maxInputTokens, usage.inputTokens),
    maxOutputTokens: remaining(limit.maxOutputTokens, usage.outputTokens),
    maxCreditMicros: remainingMicros(limit.maxCreditMicros, usage.creditMicros),
    maxDurationMs: remaining(limit.maxDurationMs, elapsedMs),
  }
}

function remaining(limit: number, used: number) {
  return Math.max(0, limit - used)
}

function remainingMicros(limit: string, used: string) {
  const value = BigInt(limit) - BigInt(used)
  return value > BigInt(0) ? value.toString() : "0"
}

function budgetJsonSchema() {
  return {
    type: "object",
    properties: {
      maxTurns: { type: "integer", minimum: 1 },
      maxModelCalls: { type: "integer", minimum: 1 },
      maxToolCalls: { type: "integer", minimum: 0 },
      maxInputTokens: { type: "integer", minimum: 1 },
      maxOutputTokens: { type: "integer", minimum: 1 },
      maxCreditMicros: { type: "string", pattern: "^\\d+$" },
      maxDurationMs: { type: "integer", minimum: 1 },
    },
    required: [
      "maxTurns",
      "maxModelCalls",
      "maxToolCalls",
      "maxInputTokens",
      "maxOutputTokens",
      "maxCreditMicros",
      "maxDurationMs",
    ],
    additionalProperties: false,
  }
}
