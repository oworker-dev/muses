import type { Pool } from "pg"

import {
  AGENT_DELEGATION_SCHEMA_VERSION,
  AgentRuntimeError,
  type AgentDelegationChildRuntimePort,
  type AgentDelegationChildSnapshot,
  type AgentDelegationFingerprintPort,
  type AgentDelegationTaskResult,
  type AgentRunParentRef,
  type AgentRunSnapshot,
  type AgentRuntimePort,
} from "@muses/agent-core"

import { getPgPool } from "./database"

const CHILD_START_SCHEMA_VERSION = "agent-delegation-child-start-v1" as const

export type AgentDelegationChildDriverPort = {
  ensure(runId: string): Promise<unknown>
}

export type AgentDelegationChildCancellationPort = {
  cancel(input: {
    readonly workspaceId: string
    readonly runId: string
    readonly requestedByUserId: string
    readonly idempotencyKey: string
    readonly reason: string
  }): Promise<
    | "completed"
    | "in-progress"
    | "idempotency-conflict"
    | "run-state-conflict"
  >
}

export type AgentDelegationChildCostOutcomePort = {
  inspect(runId: string): Promise<"known" | "unknown">
}

export class PostgresAgentDelegationChildCostOutcome
  implements AgentDelegationChildCostOutcomePort
{
  constructor(private readonly pool: Pool = getPgPool()) {}

  async inspect(runId: string) {
    const row = (
      await this.pool.query<{ uncertain: boolean }>(
        `
          select exists (
            select 1
            from muses_agent_model_call call
            left join credit_reservation reservation
              on reservation.agent_model_call_id = call.id
            where call.run_id = $1
              and (
                call.status in ('calling', 'ambiguous')
                or reservation.status in ('active', 'review_required')
              )
          ) as uncertain
        `,
        [runId]
      )
    ).rows[0]
    return row?.uncertain ? ("unknown" as const) : ("known" as const)
  }
}

export class MusesAgentDelegationChildRuntime
  implements AgentDelegationChildRuntimePort
{
  constructor(
    private readonly dependencies: {
      readonly runtime: AgentRuntimePort
      readonly drivers: AgentDelegationChildDriverPort
      readonly cancellations: AgentDelegationChildCancellationPort
      readonly costs: AgentDelegationChildCostOutcomePort
      readonly fingerprints: AgentDelegationFingerprintPort
    }
  ) {}

  async start(
    input: Parameters<AgentDelegationChildRuntimePort["start"]>[0]
  ) {
    const startFingerprint = await this.startFingerprint(input)
    const existing = await inspectOptional(this.dependencies.runtime, input.childRunId)
    if (existing) {
      assertChildStartIdentity(existing, input, startFingerprint)
      await this.ensureDriver(existing)
      return this.project(await this.dependencies.runtime.inspect(input.childRunId))
    }

    const parent = await this.dependencies.runtime.inspect(input.parent.runId)
    assertParentAuthority(parent, input.parent, input.session)
    const initiatedByUserId = stringMetadata(
      parent.metadata,
      "initiatedByUserId"
    )
    if (!initiatedByUserId) {
      throw new AgentRuntimeError(
        "run-state-invalid",
        "A delegated AgentRun requires an authorized initiating user."
      )
    }

    await this.dependencies.runtime.start({
      runId: input.childRunId,
      parent: input.parent,
      session: {
        ...input.session,
        ...(parent.session.canvasId ? { canvasId: parent.session.canvasId } : {}),
      },
      profile: input.profile,
      input: childTaskPrompt(input),
      budget: input.budget,
      permissions: input.grant.permissions,
      metadata: {
        initiatedByUserId,
        delegationChild: {
          schemaVersion: CHILD_START_SCHEMA_VERSION,
          delegationSchemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
          taskId: input.taskId,
          idempotencyKey: input.idempotencyKey,
          startFingerprint,
        },
      },
    })
    const created = await this.dependencies.runtime.inspect(input.childRunId)
    assertChildStartIdentity(created, input, startFingerprint)
    await this.ensureDriver(created)
    return this.project(await this.dependencies.runtime.inspect(input.childRunId))
  }

  async inspect(childRunId: string) {
    const run = await this.dependencies.runtime.inspect(childRunId)
    await this.ensureDriver(run)
    return this.project(await this.dependencies.runtime.inspect(childRunId))
  }

  async cancel(input: {
    readonly childRunId: string
    readonly reason: string
    readonly idempotencyKey: string
  }) {
    const run = await inspectOptional(this.dependencies.runtime, input.childRunId)
    if (!run) return null
    if (!isTerminal(run.status)) {
      const requestedByUserId = stringMetadata(
        run.metadata,
        "initiatedByUserId"
      )
      if (!requestedByUserId) {
        throw new AgentRuntimeError(
          "run-state-invalid",
          "A delegated AgentRun cancellation requires its initiating user."
        )
      }
      const state = await this.dependencies.cancellations.cancel({
        workspaceId: run.session.workspaceId,
        runId: run.runId,
        requestedByUserId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      })
      if (state === "idempotency-conflict") {
        throw new AgentRuntimeError(
          "run-state-invalid",
          "Delegated AgentRun cancellation idempotency changed."
        )
      }
    }
    return this.project(await this.dependencies.runtime.inspect(input.childRunId))
  }

  private async ensureDriver(run: AgentRunSnapshot) {
    if (run.status === "queued" || run.status === "running") {
      await this.dependencies.drivers.ensure(run.runId)
    }
  }

  private async project(
    run: AgentRunSnapshot
  ): Promise<AgentDelegationChildSnapshot> {
    const childSandboxId = run.extensions?.logicalSandbox.sandboxId
    if (!childSandboxId?.trim()) {
      throw new AgentRuntimeError(
        "extension-snapshot-invalid",
        "A delegated AgentRun requires its independent logical sandbox."
      )
    }
    const status = childStatus(run.status)
    const terminal = isTerminal(run.status)
    return {
      childRunId: run.runId,
      childSandboxId,
      status,
      ...(status === "completed"
        ? { result: parseDelegatedResult(run) }
        : {}),
      ...(run.status === "failed" && run.failure
        ? { failure: run.failure }
        : {}),
      ...(terminal
        ? {
            usage: run.budget.usage,
            costOutcome: await this.dependencies.costs.inspect(run.runId),
          }
        : {}),
    }
  }

  private startFingerprint(
    input: Parameters<AgentDelegationChildRuntimePort["start"]>[0]
  ) {
    return this.dependencies.fingerprints.fingerprint({
      schemaVersion: CHILD_START_SCHEMA_VERSION,
      childRunId: input.childRunId,
      parent: input.parent,
      session: input.session,
      taskId: input.taskId,
      objective: input.objective,
      profile: input.profile,
      context: input.context,
      grant: input.grant,
      budget: input.budget,
      result: input.result,
      idempotencyKey: input.idempotencyKey,
    })
  }
}

function assertParentAuthority(
  parent: AgentRunSnapshot,
  expected: AgentRunParentRef,
  session: {
    readonly workspaceId: string
    readonly projectId: string
    readonly sessionId: string
  }
) {
  const rootRunId = parent.parent?.rootRunId || parent.runId
  if (
    parent.runId !== expected.runId ||
    rootRunId !== expected.rootRunId ||
    parent.session.workspaceId !== session.workspaceId ||
    parent.session.projectId !== session.projectId ||
    parent.session.sessionId !== session.sessionId ||
    parent.status === "failed" ||
    parent.status === "cancelled"
  ) {
    throw new AgentRuntimeError(
      "run-state-invalid",
      "The delegated AgentRun parent authority does not match its immutable scope."
    )
  }
}

function assertChildStartIdentity(
  run: AgentRunSnapshot,
  input: Parameters<AgentDelegationChildRuntimePort["start"]>[0],
  startFingerprint: string
) {
  const delegation = recordMetadata(run.metadata, "delegationChild")
  if (
    run.runId !== input.childRunId ||
    run.parent?.runId !== input.parent.runId ||
    run.parent.rootRunId !== input.parent.rootRunId ||
    run.parent.delegationPlanId !== input.parent.delegationPlanId ||
    run.parent.delegationPlanRevision !==
      input.parent.delegationPlanRevision ||
    run.parent.delegationTaskId !== input.parent.delegationTaskId ||
    run.session.workspaceId !== input.session.workspaceId ||
    run.session.projectId !== input.session.projectId ||
    run.session.sessionId !== input.session.sessionId ||
    delegation?.schemaVersion !== CHILD_START_SCHEMA_VERSION ||
    delegation.taskId !== input.taskId ||
    delegation.idempotencyKey !== input.idempotencyKey ||
    delegation.startFingerprint !== startFingerprint
  ) {
    throw new AgentRuntimeError(
      "revision-conflict",
      `Delegated AgentRun "${input.childRunId}" already belongs to another immutable task start.`
    )
  }
}

function childTaskPrompt(
  input: Parameters<AgentDelegationChildRuntimePort["start"]>[0]
) {
  return [
    "Complete the following delegated task using only the granted tools and context.",
    `Objective: ${input.objective}`,
    `Authorized context facts: ${JSON.stringify(input.context.facts)}`,
    `Authorized input Artifact refs: ${JSON.stringify(input.context.artifactRefs)}`,
    `Required data JSON Schema: ${JSON.stringify(input.result.outputSchema)}`,
    "Your final assistant message must be only one JSON object with exactly these top-level fields:",
    '{"data":<Schema-conforming value>,"artifactRefs":["authorized-result-asset-id"],"evidence":[{"kind":"artifact","ref":"same-asset-id"}]}',
    "Do not wrap the JSON in Markdown. Do not claim an Artifact or evidence ref that was not returned by an authorized tool.",
  ].join("\n")
}

function parseDelegatedResult(
  run: AgentRunSnapshot
): AgentDelegationTaskResult | undefined {
  const content = [...run.context.messages]
    .reverse()
    .find(({ role }) => role === "assistant")?.content
  if (!content) return undefined
  try {
    const parsed = JSON.parse(content) as unknown
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Object.hasOwn(parsed, "data") ||
      !Array.isArray((parsed as { artifactRefs?: unknown }).artifactRefs) ||
      !Array.isArray((parsed as { evidence?: unknown }).evidence)
    ) {
      return undefined
    }
    return parsed as AgentDelegationTaskResult
  } catch {
    return undefined
  }
}

async function inspectOptional(runtime: AgentRuntimePort, runId: string) {
  try {
    return await runtime.inspect(runId)
  } catch (error) {
    if (error instanceof AgentRuntimeError && error.code === "run-not-found") {
      return null
    }
    throw error
  }
}

function childStatus(
  status: AgentRunSnapshot["status"]
): AgentDelegationChildSnapshot["status"] {
  if (status === "waiting-approval" || status === "waiting-input") {
    return "waiting-approval"
  }
  return status
}

function isTerminal(status: AgentRunSnapshot["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function stringMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string
) {
  const value = metadata[key]
  return typeof value === "string" && value.trim() ? value : null
}

function recordMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string
) {
  const value = metadata[key]
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}
