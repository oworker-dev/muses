import { randomUUID } from "node:crypto"

import { getRun } from "workflow/api"

import { AgentRuntimeError, type AgentRunSnapshot } from "@muses/agent-core"

import { createMusesAgentRuntime } from "@/lib/agent-runtime"
import { authorizeAgentRun } from "@/lib/agent-state-store"
import {
  finalizeCreditReservation,
  finalizeUnreservedWorkflowSubmission,
} from "@/lib/credit-ledger"
import { getPgPool } from "@/lib/database"
import {
  MUSES_RUNTIME_STREAM_NAMESPACE,
  type WorkflowDefinitionInterpreterResult,
  type WorkflowRuntimeEvent,
} from "@/workflows/workflow-definition-interpreter"

const CANCELLATION_LEASE_MS = 2 * 60 * 1000

type AgentChildWorkflowRow = {
  submissionId: string
  sdkRunId: string | null
  reservationId: string | null
  reservationStatus: string | null
  status: string
}

export type AgentChildCancellationResult = {
  submissionId: string
  runId: string | null
  state:
    | "cancelled"
    | "completed"
    | "failed"
    | "already-cancelled"
    | "review-required"
    | "not-started"
    | "not-found"
  knownCreditMicros: string
}

export type AgentCancellationSummary = {
  agentRunId: string
  driver: { runId: string | null; state: string }
  children: AgentChildCancellationResult[]
  reviewRequired: boolean
}

export type AgentCancellationResult =
  | {
      state: "completed"
      idempotentReplay: boolean
      summary: AgentCancellationSummary
    }
  | { state: "in-progress" }
  | { state: "idempotency-conflict" }
  | { state: "run-state-conflict" }

export async function cancelAgentRunAndChildren(input: {
  workspaceId: string
  runId: string
  requestedByUserId: string
  idempotencyKey: string
  reason?: string
}): Promise<AgentCancellationResult> {
  const claim = await claimAgentCancellation(input)
  if (claim.state !== "claimed") return claim

  const runtime = createMusesAgentRuntime()
  try {
    await cancelAgentCoreWithRetry(runtime, input.runId, input.reason)
    const owned = await authorizeAgentRun(input.workspaceId, input.runId)
    if (!owned) throw new Error("AgentRun disappeared during cancellation.")
    const driver = await cancelSdkRun(owned.driverRunId)
    const children = await listAgentChildWorkflows(
      input.workspaceId,
      input.runId
    )
    const childResults: AgentChildCancellationResult[] = []
    for (const child of children) {
      childResults.push(await cancelAgentChildWorkflow(child))
    }
    const summary: AgentCancellationSummary = {
      agentRunId: input.runId,
      driver: { runId: owned.driverRunId, state: driver },
      children: childResults,
      reviewRequired: childResults.some(
        ({ state }) => state === "review-required"
      ),
    }
    await completeAgentCancellation(input, claim.attemptId, summary)
    return { state: "completed", idempotentReplay: false, summary }
  } catch (error) {
    await releaseAgentCancellationAttempt(input, claim.attemptId).catch(
      () => undefined
    )
    if (
      error instanceof AgentRuntimeError &&
      error.code === "run-state-invalid"
    ) {
      return { state: "run-state-conflict" }
    }
    throw error
  }
}

async function cancelAgentCoreWithRetry(
  runtime: ReturnType<typeof createMusesAgentRuntime>,
  runId: string,
  reason?: string
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await runtime.cancel(runId, reason)
      return
    } catch (error) {
      if (
        !(error instanceof AgentRuntimeError) ||
        error.code !== "revision-conflict" ||
        attempt === 4
      ) {
        throw error
      }
    }
  }
}

async function cancelSdkRun(runId: string | null) {
  if (!runId) return "not-started"
  const run = getRun(runId)
  if (!(await run.exists.catch(() => false))) return "not-found"
  const before = await run.status.catch(() => "not-found" as const)
  if (before !== "pending" && before !== "running") return before
  await run.cancel().catch(() => undefined)
  const after = await run.status.catch(() => "not-found" as const)
  if (after === "pending" || after === "running") {
    throw new Error(
      `WorkflowRun "${runId}" is still active after cancellation.`
    )
  }
  return after
}

async function listAgentChildWorkflows(workspaceId: string, runId: string) {
  const result = await getPgPool().query<AgentChildWorkflowRow>(
    `
      select
        run.id as "submissionId",
        run.sdk_run_id as "sdkRunId",
        run.reservation_id as "reservationId",
        reservation.status as "reservationStatus",
        run.status
      from muses_workflow_run run
      left join credit_reservation reservation on reservation.id = run.reservation_id
      where run.workspace_id = $1
        and run.caller_kind = 'agent'
        and run.caller_id = $2
      order by run.created_at, run.id
    `,
    [workspaceId, runId]
  )
  return result.rows
}

async function cancelAgentChildWorkflow(
  child: AgentChildWorkflowRow
): Promise<AgentChildCancellationResult> {
  if (!child.sdkRunId) {
    await finalizeCancelledChild(child, [], false)
    return {
      submissionId: child.submissionId,
      runId: null,
      state: "not-started",
      knownCreditMicros: "0",
    }
  }

  const run = getRun<WorkflowDefinitionInterpreterResult>(child.sdkRunId)
  if (!(await run.exists.catch(() => false))) {
    if (child.reservationId && child.reservationStatus === "active") {
      await finalizeCreditReservation({
        reservationId: child.reservationId,
        workflowRunId: child.sdkRunId,
        status: "review",
        actualMicros: BigInt(0),
        reason:
          "The linked Workflow SDK run could not be found during Agent cancellation.",
        workflowStatus: "cancelled",
      })
      return {
        submissionId: child.submissionId,
        runId: child.sdkRunId,
        state: "review-required",
        knownCreditMicros: "0",
      }
    }
    return {
      submissionId: child.submissionId,
      runId: child.sdkRunId,
      state: "not-found",
      knownCreditMicros: "0",
    }
  }
  let status = await run.status
  let events = await readKnownRuntimeEvents(run).catch(() => [])
  if (status === "pending" || status === "running") {
    await run.cancel().catch(() => undefined)
    status = await run.status
    events = await readKnownRuntimeEvents(run).catch(() => events)
  }
  if (status === "pending" || status === "running") {
    throw new Error(
      `Child WorkflowRun "${child.sdkRunId}" is still active after cancellation.`
    )
  }
  const knownCreditMicros = getKnownRuntimeChargeMicros(events)
  if (status === "completed" || status === "failed") {
    return {
      submissionId: child.submissionId,
      runId: child.sdkRunId,
      state: status,
      knownCreditMicros: knownCreditMicros.toString(),
    }
  }
  if (status !== "cancelled") {
    throw new Error(
      `Child WorkflowRun "${child.sdkRunId}" has an unknown cancellation state.`
    )
  }

  const billingUncertain = hasUnresolvedProviderEffect(events)
  await finalizeCancelledChild(child, events, billingUncertain)
  return {
    submissionId: child.submissionId,
    runId: child.sdkRunId,
    state: billingUncertain
      ? "review-required"
      : child.status === "cancelled"
        ? "already-cancelled"
        : "cancelled",
    knownCreditMicros: knownCreditMicros.toString(),
  }
}

async function finalizeCancelledChild(
  child: AgentChildWorkflowRow,
  events: readonly WorkflowRuntimeEvent[],
  billingUncertain: boolean
) {
  const knownCreditMicros = getKnownRuntimeChargeMicros(events)
  if (child.reservationId) {
    await finalizeCreditReservation({
      reservationId: child.reservationId,
      workflowRunId: child.sdkRunId,
      status: billingUncertain
        ? "review"
        : knownCreditMicros > BigInt(0)
          ? "settle"
          : "release",
      actualMicros: knownCreditMicros,
      reason: billingUncertain
        ? "Agent cancellation interrupted an active provider call; billing requires review."
        : "Agent cancellation stopped this child workflow.",
      workflowStatus: "cancelled",
    })
  } else {
    await finalizeUnreservedWorkflowSubmission({
      submissionId: child.submissionId,
      workflowRunId: child.sdkRunId,
      status: "cancelled",
    })
  }
}

function hasUnresolvedProviderEffect(events: readonly WorkflowRuntimeEvent[]) {
  const activeImageNodes = new Set<string>()
  for (const event of events) {
    if (event.type === "node.started" && event.nodeKind === "image-generator") {
      activeImageNodes.add(event.nodeId)
    }
    if (
      event.type === "node.succeeded" &&
      event.nodeKind === "image-generator"
    ) {
      activeImageNodes.delete(event.nodeId)
    }
  }
  return activeImageNodes.size > 0
}

function getKnownRuntimeChargeMicros(events: readonly WorkflowRuntimeEvent[]) {
  return events.reduce((total, event) => {
    if (event.type !== "node.succeeded" || !event.usage) return total
    return total + BigInt(event.usage.creditMicros)
  }, BigInt(0))
}

async function readKnownRuntimeEvents(
  run: ReturnType<typeof getRun<WorkflowDefinitionInterpreterResult>>
) {
  const readable = run.getReadable<WorkflowRuntimeEvent>({
    namespace: MUSES_RUNTIME_STREAM_NAMESPACE,
  })
  const tailIndex = await readable.getTailIndex()
  if (tailIndex < 0) return []
  const reader = readable.getReader()
  const events: WorkflowRuntimeEvent[] = []
  try {
    for (let index = 0; index <= tailIndex; index += 1) {
      const chunk = await reader.read()
      if (chunk.done) break
      events.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return events
}

async function claimAgentCancellation(input: {
  workspaceId: string
  runId: string
  requestedByUserId: string
  idempotencyKey: string
  reason?: string
}): Promise<
  | { state: "claimed"; attemptId: string }
  | {
      state: "completed"
      idempotentReplay: true
      summary: AgentCancellationSummary
    }
  | { state: "in-progress" }
  | { state: "idempotency-conflict" }
  | { state: "run-state-conflict" }
> {
  const client = await getPgPool().connect()
  const attemptId = `acancel_${randomUUID().replaceAll("-", "")}`
  const leaseExpiresAt = new Date(
    Date.now() + CANCELLATION_LEASE_MS
  ).toISOString()
  try {
    await client.query("begin")
    const run = (
      await client.query<{ status: AgentRunSnapshot["status"] }>(
        `
          select status
          from muses_agent_run
          where workspace_id = $1 and id = $2
          for update
        `,
        [input.workspaceId, input.runId]
      )
    ).rows[0]
    if (!run || run.status === "completed" || run.status === "failed") {
      await client.query("rollback")
      return { state: "run-state-conflict" }
    }
    const inserted = await client.query(
      `
        insert into muses_agent_cancel_receipt (
          workspace_id, agent_run_id, idempotency_key, requested_by_user_id,
          reason, attempt_id, lease_expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict do nothing
        returning attempt_id
      `,
      [
        input.workspaceId,
        input.runId,
        input.idempotencyKey,
        input.requestedByUserId,
        input.reason || null,
        attemptId,
        leaseExpiresAt,
      ]
    )
    if (inserted.rowCount === 1) {
      await client.query("commit")
      return { state: "claimed", attemptId }
    }
    const existing = (
      await client.query<{
        idempotencyKey: string
        requestedByUserId: string
        reason: string | null
        status: string
        leaseExpiresAt: Date | string
        summary: AgentCancellationSummary | null
      }>(
        `
          select
            idempotency_key as "idempotencyKey",
            requested_by_user_id as "requestedByUserId",
            reason, status, lease_expires_at as "leaseExpiresAt", summary
          from muses_agent_cancel_receipt
          where workspace_id = $1 and agent_run_id = $2
          for update
        `,
        [input.workspaceId, input.runId]
      )
    ).rows[0]
    if (
      !existing ||
      existing.idempotencyKey !== input.idempotencyKey ||
      existing.requestedByUserId !== input.requestedByUserId ||
      (existing.reason || undefined) !== input.reason
    ) {
      await client.query("rollback")
      return { state: "idempotency-conflict" }
    }
    if (existing.status === "completed" && existing.summary) {
      await client.query("commit")
      return {
        state: "completed",
        idempotentReplay: true,
        summary: existing.summary,
      }
    }
    if (new Date(existing.leaseExpiresAt).getTime() > Date.now()) {
      await client.query("commit")
      return { state: "in-progress" }
    }
    await client.query(
      `
        update muses_agent_cancel_receipt
        set attempt_id = $4, lease_expires_at = $5, updated_at = now()
        where workspace_id = $1 and agent_run_id = $2 and idempotency_key = $3
      `,
      [
        input.workspaceId,
        input.runId,
        input.idempotencyKey,
        attemptId,
        leaseExpiresAt,
      ]
    )
    await client.query("commit")
    return { state: "claimed", attemptId }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function completeAgentCancellation(
  input: { workspaceId: string; runId: string; idempotencyKey: string },
  attemptId: string,
  summary: AgentCancellationSummary
) {
  const result = await getPgPool().query(
    `
      update muses_agent_cancel_receipt
      set status = 'completed', summary = $5, updated_at = now(), completed_at = now()
      where workspace_id = $1
        and agent_run_id = $2
        and idempotency_key = $3
        and attempt_id = $4
        and status = 'processing'
    `,
    [
      input.workspaceId,
      input.runId,
      input.idempotencyKey,
      attemptId,
      JSON.stringify(summary),
    ]
  )
  if (result.rowCount !== 1) {
    throw new Error("Agent cancellation receipt ownership was lost.")
  }
}

async function releaseAgentCancellationAttempt(
  input: { workspaceId: string; runId: string; idempotencyKey: string },
  attemptId: string
) {
  await getPgPool().query(
    `
      update muses_agent_cancel_receipt
      set lease_expires_at = now(), updated_at = now()
      where workspace_id = $1
        and agent_run_id = $2
        and idempotency_key = $3
        and attempt_id = $4
        and status = 'processing'
    `,
    [input.workspaceId, input.runId, input.idempotencyKey, attemptId]
  )
}
