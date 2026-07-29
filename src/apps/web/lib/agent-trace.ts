import { parseStepName, parseWorkflowName } from "workflow/observability"
import { getWorld } from "workflow/runtime"

import type { AgentEvent, AgentRunSnapshot } from "@muses/agent-core"

import { readAgentDelegationLineage } from "@/lib/agent-delegation-trace"
import { getPgPool } from "@/lib/database"

export const AGENT_TRACE_SCHEMA_VERSION = "agent-trace-v1" as const

type AgentEventFactRow = {
  eventId: string
  runId: string
  sequence: number
  type: AgentEvent["type"]
  createdAt: Date | string
  callId: string | null
  toolCallId: string | null
  toolName: string | null
  approvalId: string | null
  finishReason: string | null
  inputTokens: string | null
  outputTokens: string | null
  creditMicros: string | null
}

type ModelCallFactRow = {
  callId: string
  runId: string
  turn: number
  contextVersion: number
  modelRef: string
  status: string
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCreditMicros: string
  actualInputTokens: number | null
  actualOutputTokens: number | null
  actualCreditMicros: string | null
  failureCode: string | null
  createdAt: Date | string
  startedAt: Date | string | null
  completedAt: Date | string | null
}

type CommandFactRow = {
  commandId: string
  agentRunId: string
  targetType: string
  targetId: string
  status: string
  expectedRevision: number
  resultingRevision: number | null
  createdAt: Date | string
  completedAt: Date | string | null
}

type ChildWorkflowFactRow = {
  submissionId: string
  agentRunId: string
  sdkRunId: string | null
  status: string
  workflowDefinitionId: string | null
  workflowDefinitionVersion: number | null
  workflowDeploymentId: string | null
  reservationId: string | null
  createdAt: Date | string
  startedAt: Date | string | null
  completedAt: Date | string | null
}

type AssetFactRow = {
  assetId: string
  workflowRunId: string
  nodeId: string
  stepId: string
  assetIndex: number
  mimeType: string
  byteSize: string
  width: number
  height: number
  provider: string
  modelRef: string
  createdAt: Date | string
}

type ReservationFactRow = {
  reservationId: string
  submissionId: string | null
  agentModelCallId: string | null
  status: string
  estimatedMicros: string
  settledMicros: string
  failureReason: string | null
  createdAt: Date | string
  finalizedAt: Date | string | null
}

type LedgerFactRow = {
  entryId: string
  kind: string
  balanceDeltaMicros: string
  reservedDeltaMicros: string
  balanceAfterMicros: string
  reservedAfterMicros: string
  reservationId: string | null
  workflowRunId: string | null
  agentModelCallId: string | null
  createdAt: Date | string
}

export async function readAgentTrace(input: {
  workspaceId: string
  run: AgentRunSnapshot
  driverRunId: string | null
}) {
  if (input.run.session.workspaceId !== input.workspaceId) {
    throw new Error("Agent trace scope does not match its authorized Run.")
  }
  const pool = getPgPool()
  const delegationLineage = await readAgentDelegationLineage({
    workspaceId: input.workspaceId,
    run: input.run,
    pool,
  })
  const agentRunIds = delegationLineage.agentRunIds.length
    ? delegationLineage.agentRunIds
    : [input.run.runId]
  const [eventsResult, modelCallsResult, commandsResult, childWorkflowsResult] =
    await Promise.all([
      pool.query<AgentEventFactRow>(
        `
        select event_id as "eventId", event.run_id as "runId", sequence, type,
               created_at as "createdAt",
               data ->> 'callId' as "callId",
               data ->> 'toolCallId' as "toolCallId",
               data ->> 'toolName' as "toolName",
               data ->> 'approvalId' as "approvalId",
               data ->> 'finishReason' as "finishReason",
               data #>> '{usage,inputTokens}' as "inputTokens",
               data #>> '{usage,outputTokens}' as "outputTokens",
               data #>> '{usage,creditMicros}' as "creditMicros"
        from muses_agent_event event
        where event.run_id = any($2::text[])
          and exists (
            select 1 from muses_agent_run run
            where run.id = event.run_id and run.workspace_id = $1
          )
        order by event.run_id, sequence
      `,
        [input.workspaceId, agentRunIds]
      ),
      pool.query<ModelCallFactRow>(
        `
        select id as "callId", run_id as "runId", turn,
               context_version as "contextVersion",
               model_ref as "modelRef", status,
               estimated_input_tokens as "estimatedInputTokens",
               estimated_output_tokens as "estimatedOutputTokens",
               estimated_credit_micros::text as "estimatedCreditMicros",
               actual_input_tokens as "actualInputTokens",
               actual_output_tokens as "actualOutputTokens",
               actual_credit_micros::text as "actualCreditMicros",
               failure_code as "failureCode", created_at as "createdAt",
               started_at as "startedAt", completed_at as "completedAt"
        from muses_agent_model_call
        where workspace_id = $1 and run_id = any($2::text[])
        order by created_at, id
      `,
        [input.workspaceId, agentRunIds]
      ),
      pool.query<CommandFactRow>(
        `
        select command_id as "commandId", actor_id as "agentRunId",
               target_type as "targetType",
               target_id as "targetId", status,
               expected_revision as "expectedRevision",
               resulting_revision as "resultingRevision",
               created_at as "createdAt", completed_at as "completedAt"
        from muses_operation_command_receipt
        where workspace_id = $1 and actor_kind = 'agent'
          and actor_id = any($2::text[])
        order by created_at, command_id
      `,
        [input.workspaceId, agentRunIds]
      ),
      pool.query<ChildWorkflowFactRow>(
        `
        select id as "submissionId", caller_id as "agentRunId",
               sdk_run_id as "sdkRunId", status,
               workflow_definition_id as "workflowDefinitionId",
               workflow_definition_version as "workflowDefinitionVersion",
               workflow_deployment_id as "workflowDeploymentId",
               reservation_id as "reservationId", created_at as "createdAt",
               started_at as "startedAt", completed_at as "completedAt"
        from muses_workflow_run
        where workspace_id = $1 and caller_kind = 'agent'
          and caller_id = any($2::text[])
        order by created_at, id
      `,
        [input.workspaceId, agentRunIds]
      ),
    ])

  const modelCallIds = modelCallsResult.rows.map(({ callId }) => callId)
  const submissionIds = childWorkflowsResult.rows.map(
    ({ submissionId }) => submissionId
  )
  const sdkRunIds = childWorkflowsResult.rows
    .map(({ sdkRunId }) => sdkRunId)
    .filter((runId): runId is string => Boolean(runId))
  const [assetsResult, reservationsResult, ledgerResult] = await Promise.all([
    pool.query<AssetFactRow>(
      `
        select asset.id as "assetId", asset.workflow_run_id as "workflowRunId",
               asset.node_id as "nodeId", asset.step_id as "stepId",
               asset.asset_index as "assetIndex", asset.mime_type as "mimeType",
               asset.byte_size::text as "byteSize", asset.width, asset.height,
               asset.provider, asset.model_ref as "modelRef",
               asset.created_at as "createdAt"
        from muses_generated_asset asset
        where asset.workspace_id = $1
          and asset.workflow_run_id = any($2::text[])
        order by asset.created_at, asset.id
      `,
      [input.workspaceId, sdkRunIds]
    ),
    pool.query<ReservationFactRow>(
      `
        select id as "reservationId", submission_id as "submissionId",
               agent_model_call_id as "agentModelCallId", status,
               estimated_micros::text as "estimatedMicros",
               settled_micros::text as "settledMicros",
               failure_reason as "failureReason", created_at as "createdAt",
               finalized_at as "finalizedAt"
        from credit_reservation
        where workspace_id = $1
          and (
            agent_model_call_id = any($2::text[])
            or submission_id = any($3::text[])
          )
        order by created_at, id
      `,
      [input.workspaceId, modelCallIds, submissionIds]
    ),
    pool.query<LedgerFactRow>(
      `
        select id as "entryId", kind,
               balance_delta_micros::text as "balanceDeltaMicros",
               reserved_delta_micros::text as "reservedDeltaMicros",
               balance_after_micros::text as "balanceAfterMicros",
               reserved_after_micros::text as "reservedAfterMicros",
               reservation_id as "reservationId", workflow_run_id as "workflowRunId",
               agent_model_call_id as "agentModelCallId", created_at as "createdAt"
        from credit_ledger_entry
        where workspace_id = $1
          and (
            agent_run_id = any($2::text[])
            or agent_model_call_id = any($3::text[])
            or workflow_run_id = any($4::text[])
          )
        order by created_at, id
      `,
      [input.workspaceId, agentRunIds, modelCallIds, sdkRunIds]
    ),
  ])

  const workflowRefs = uniqueWorkflowRefs([
    ...(input.driverRunId
      ? [{ kind: "agent-driver" as const, runId: input.driverRunId }]
      : []),
    ...delegationLineage.workflowDriverRefs,
    ...childWorkflowsResult.rows.flatMap((workflow) =>
      workflow.sdkRunId
        ? [{ kind: "child-workflow" as const, runId: workflow.sdkRunId }]
        : []
    ),
  ])
  const workflowWorld = []
  for (const { kind, runId } of workflowRefs) {
    workflowWorld.push(await readWorkflowWorldTrace(kind, runId))
  }

  return {
    schemaVersion: AGENT_TRACE_SCHEMA_VERSION,
    traceId: input.run.runId,
    workspaceId: input.workspaceId,
    generatedAt: new Date().toISOString(),
    run: {
      runId: input.run.runId,
      ...(input.run.parent ? { parent: input.run.parent } : {}),
      projectId: input.run.session.projectId,
      canvasId: input.run.session.canvasId,
      sessionId: input.run.session.sessionId,
      status: input.run.status,
      revision: input.run.revision,
      turn: input.run.turn,
      profile: {
        profileId: input.run.profile.profileId,
        version: input.run.profile.version,
        modelRef: input.run.profile.modelRef,
      },
      budget: input.run.budget,
      createdAt: input.run.createdAt,
      updatedAt: input.run.updatedAt,
      completedAt: input.run.completedAt,
    },
    isolation: projectIsolation(input.run),
    delegationLineage: {
      rootRunId: delegationLineage.rootRunId,
      requestedRunId: delegationLineage.requestedRunId,
      agentRuns: delegationLineage.agentRuns,
      delegations: delegationLineage.delegations,
      events: delegationLineage.events,
      budgetReservations: delegationLineage.budgetReservations,
    },
    agentEvents: eventsResult.rows.map((event) => ({
      eventId: event.eventId,
      runId: event.runId,
      sequence: event.sequence,
      type: event.type,
      createdAt: iso(event.createdAt),
      ...(event.callId ? { callId: event.callId } : {}),
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(event.approvalId ? { approvalId: event.approvalId } : {}),
      ...(event.finishReason ? { finishReason: event.finishReason } : {}),
      ...(event.inputTokens || event.outputTokens || event.creditMicros
        ? {
            usage: {
              inputTokens: integer(event.inputTokens),
              outputTokens: integer(event.outputTokens),
              creditMicros: event.creditMicros || "0",
            },
          }
        : {}),
    })),
    modelCalls: modelCallsResult.rows.map((call) => ({
      ...call,
      createdAt: iso(call.createdAt),
      startedAt: optionalIso(call.startedAt),
      completedAt: optionalIso(call.completedAt),
    })),
    toolCommands: commandsResult.rows.map((command) => ({
      ...command,
      createdAt: iso(command.createdAt),
      completedAt: optionalIso(command.completedAt),
    })),
    workflowRuns: childWorkflowsResult.rows.map((workflow) => ({
      ...workflow,
      createdAt: iso(workflow.createdAt),
      startedAt: optionalIso(workflow.startedAt),
      completedAt: optionalIso(workflow.completedAt),
    })),
    workflowWorld,
    assets: assetsResult.rows.map((asset) => ({
      ...asset,
      createdAt: iso(asset.createdAt),
    })),
    reservations: reservationsResult.rows.map((reservation) => ({
      ...reservation,
      createdAt: iso(reservation.createdAt),
      finalizedAt: optionalIso(reservation.finalizedAt),
    })),
    ledgerEntries: ledgerResult.rows.map((entry) => ({
      ...entry,
      createdAt: iso(entry.createdAt),
    })),
  }
}

function projectIsolation(run: AgentRunSnapshot) {
  const extensions = run.extensions
  if (!extensions) return { state: "legacy-unpinned" as const }
  return {
    state: "pinned" as const,
    capturedAt: extensions.capturedAt,
    integrityFingerprint: extensions.integrityFingerprint,
    skills: extensions.skills.map(({ skillId, version, checksum }) => ({
      skillId,
      version,
      checksum,
    })),
    mcpConnections: extensions.mcpConnections.map(
      ({ connectionId, version }) => ({ connectionId, version })
    ),
    mcpTools: extensions.mcpTools.map(
      ({ connectionId, name, schemaChecksum }) => ({
        connectionId,
        name,
        schemaChecksum,
      })
    ),
    sandbox: {
      sandboxId: extensions.logicalSandbox.sandboxId,
      scope: extensions.logicalSandbox.scope,
      permissions: extensions.logicalSandbox.permissions,
      allowedToolNames: extensions.logicalSandbox.allowedToolNames,
      networkDefault: extensions.logicalSandbox.network.default,
      filesystem: extensions.logicalSandbox.filesystem,
      limits: extensions.logicalSandbox.limits,
    },
  }
}

async function readWorkflowWorldTrace(
  kind: "agent-driver" | "delegation-driver" | "child-workflow",
  runId: string
) {
  try {
    const world = await getWorld()
    const run = await world.runs.get(runId, { resolveData: "none" })
    const steps = await readAllPages((cursor) =>
      world.steps.list({
        runId,
        resolveData: "none",
        ...(cursor ? { pagination: { cursor } } : {}),
      })
    )
    const events = await readAllPages((cursor) =>
      world.events.list({
        runId,
        resolveData: "none",
        ...(cursor ? { pagination: { cursor } } : {}),
      })
    )
    return {
      kind,
      state: "available" as const,
      run: {
        runId: run.runId,
        status: run.status,
        workflowName:
          parseWorkflowName(run.workflowName)?.shortName || run.workflowName,
        deploymentId: run.deploymentId,
        createdAt: iso(run.createdAt),
        startedAt: optionalIso(run.startedAt),
        completedAt: optionalIso(run.completedAt),
      },
      steps: steps.map((step) => ({
        stepId: step.stepId,
        name: parseStepName(step.stepName)?.shortName || step.stepName,
        status: step.status,
        attempt: step.attempt,
        createdAt: iso(step.createdAt),
        startedAt: optionalIso(step.startedAt),
        completedAt: optionalIso(step.completedAt),
      })),
      events: events.map((event) => ({
        eventId: event.eventId,
        type: event.eventType,
        correlationId: event.correlationId,
        createdAt: iso(event.createdAt),
        occurredAt: optionalIso(event.occurredAt),
      })),
    }
  } catch {
    return { kind, state: "unavailable" as const, runId }
  }
}

function uniqueWorkflowRefs(
  refs: readonly {
    kind: "agent-driver" | "delegation-driver" | "child-workflow"
    runId: string
  }[]
) {
  const byRunId = new Map<string, (typeof refs)[number]>()
  for (const ref of refs) byRunId.set(ref.runId, ref)
  return [...byRunId.values()]
}

async function readAllPages<T>(
  read: (cursor?: string) => Promise<{ data: T[]; cursor?: string | null }>
) {
  const data: T[] = []
  let cursor: string | undefined
  do {
    const page = await read(cursor)
    data.push(...page.data)
    cursor = page.cursor || undefined
  } while (cursor)
  return data
}

function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function optionalIso(value: Date | string | null | undefined) {
  return value ? iso(value) : undefined
}

function integer(value: string | null) {
  const parsed = Number(value || 0)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}
