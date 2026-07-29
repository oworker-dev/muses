import { getHookByToken, getRun, resumeHook, start } from "workflow/api"
import {
  hydrateResourceIO,
  observabilityRevivers,
} from "workflow/observability"
import { getWorld } from "workflow/runtime"
import type { PoolClient } from "pg"

import {
  getWorkflowDefinitionRef,
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  type WorkflowDefinition,
  type WorkflowInvocationTarget,
  type WorkflowRuntimeScalarValue,
} from "@muses/domain"

import { getPgPool } from "@/lib/database"
import { ModelCatalogError } from "@/lib/model-catalog"
import {
  fallbackWorkflowRunObservability,
  readWorkflowRunObservability,
} from "@/lib/workflow-run-observability"
import {
  attachWorkflowSdkRun,
  authorizeWorkflowRun,
  claimWorkflowSubmission,
  failWorkflowStart,
  finalizeCreditReservation,
  finalizeUnreservedWorkflowSubmission,
  fingerprintWorkflowSubmission,
} from "@/lib/credit-ledger"
import { requireStudioApiAccess } from "@/lib/studio-access"
import { WorkflowCatalogStoreError } from "@/lib/workflow-catalog-store"
import {
  startPublishedWorkflowInvocation,
  type StartPublishedWorkflowInvocationResult,
} from "@/lib/workflow-invocation"
import {
  MUSES_RUNTIME_STREAM_NAMESPACE,
  MUSES_WORKFLOW_RUNTIME,
  getActiveRuntimeSuspension,
  getRunFailureEvent,
  getRunStartedEvent,
  getRuntimeAttemptProjections,
  isWorkflowInterpreterHarnessOptions,
  isWorkflowSelectorHookMetadata,
  selectorHookToken,
  workflowDefinitionInterpreter,
  type WorkflowDefinitionInterpreterResult,
  type WorkflowHumanSelectionPayload,
  type WorkflowInterpreterHarnessOptions,
  type WorkflowRuntimeEvent,
} from "@/workflows/workflow-definition-interpreter"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const access = await requireStudioApiAccess(getRequestedWorkspaceId(body))
  if (!access.ok) return access.response
  const retry = getWorkflowRetryRequest(body)
  if (retry) return retryWorkflowRun(retry, access.user.id)

  const invocation = getWorkflowInvocationRequest(body)
  if (!invocation) {
    return Response.json(
      {
        accepted: false,
        error: "invalid-workflow-invocation-request",
        message:
          "A Workspace, exact published workflow target, and idempotency key are required.",
      },
      { status: 400 }
    )
  }

  const harnessOptions = getControlledHarnessOptions(request)
  if (harnessOptions === "disabled") {
    return Response.json(
      {
        accepted: false,
        error: "workflow-harness-disabled",
        message: "Controlled workflow failure scenarios are disabled.",
      },
      { status: 403 }
    )
  }
  if (harnessOptions === "invalid") {
    return Response.json(
      {
        accepted: false,
        error: "invalid-workflow-harness-scenario",
        message: "The requested workflow Harness scenario is not supported.",
      },
      { status: 400 }
    )
  }

  let result: StartPublishedWorkflowInvocationResult
  try {
    result = await startPublishedWorkflowInvocation({
      workspaceId: invocation.workspaceId,
      submittedByUserId: access.user.id,
      caller: { kind: "user", userId: access.user.id },
      target: invocation.target,
      inputs: invocation.inputs,
      idempotencyKey: invocation.idempotencyKey,
      harnessOptions,
    })
  } catch (error) {
    if (error instanceof ModelCatalogError)
      return modelCatalogErrorResponse(error)
    if (error instanceof WorkflowCatalogStoreError) {
      return workflowCatalogInvocationErrorResponse(error)
    }
    throw error
  }
  if (
    result.state === "in-progress" ||
    result.state === "idempotency-conflict" ||
    result.state === "insufficient-credits" ||
    result.state === "runtime-unavailable"
  ) {
    return publishedWorkflowInvocationFailureResponse(result)
  }

  return Response.json(
    {
      accepted: true,
      runId: result.runId,
      runtime: MUSES_WORKFLOW_RUNTIME,
      durableRuntime: "vercel-workflow-sdk",
      definition: result.definition,
      deploymentId: result.deploymentId,
      idempotentReplay: result.idempotentReplay,
      retryOfRunId: harnessOptions.retryOfRunId,
      billing: {
        estimatedMicros: result.estimatedMicros.toString(),
        ...(result.availableAfterReserveMicros === undefined
          ? {}
          : {
              availableAfterReserveMicros:
                result.availableAfterReserveMicros.toString(),
            }),
      },
      validation: {
        valid: true,
        issues: [],
        topologicalOrder: result.topologicalOrder,
      },
    },
    { status: 202 }
  )
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const runId = searchParams.get("runId")
  const workspaceId = searchParams.get("workspaceId")
  if (!runId || !workspaceId) {
    return Response.json(
      {
        error: "run-identity-required",
        message: "runId and workspaceId are required.",
      },
      { status: 400 }
    )
  }

  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response
  const ownedRun = await authorizeWorkflowRun(workspaceId, runId)
  if (!ownedRun) return workflowRunNotFoundResponse()

  try {
    const run = getRun<WorkflowDefinitionInterpreterResult>(runId)
    if (!(await run.exists)) {
      return Response.json(
        { error: "run-not-found", message: "Workflow run was not found." },
        { status: 404 }
      )
    }
    const [sdkStatus, events] = await Promise.all([
      run.status,
      readKnownRuntimeEvents(run),
    ])
    const started = getRunStartedEvent(events)
    if (started && started.definition.workspaceId !== workspaceId) {
      return Response.json(
        { error: "run-not-found", message: "Workflow run was not found." },
        { status: 404 }
      )
    }
    const runtimeSuspension = getActiveRuntimeSuspension(events)
    const failure = getRunFailureEvent(events)?.failure
    const suspension =
      sdkStatus === "pending" || sdkStatus === "running"
        ? runtimeSuspension
        : undefined
    const status =
      sdkStatus === "completed"
        ? "completed"
        : sdkStatus === "failed"
          ? "failed"
          : sdkStatus === "cancelled"
            ? "cancelled"
            : suspension
              ? "waiting"
              : sdkStatus
    const result = sdkStatus === "completed" ? await run.returnValue : undefined
    const billing = {
      reservationStatus: ownedRun.reservationStatus,
      estimatedMicros: ownedRun.estimatedMicros,
      settledMicros: ownedRun.settledMicros,
      pricingSnapshot: ownedRun.pricingSnapshot,
    }
    const observability = await readWorkflowRunObservability({
      runId,
      events,
      billing,
    }).catch(() => fallbackWorkflowRunObservability({ events, billing }))
    return Response.json({
      runId,
      runtime: MUSES_WORKFLOW_RUNTIME,
      sdkStatus,
      status,
      retryOfRunId: started?.retryOfRunId,
      suspension,
      failure,
      attempts: getRuntimeAttemptProjections(events),
      events,
      result,
      observability,
      billing: {
        estimatedMicros: ownedRun.estimatedMicros || "0",
        actualMicros: ownedRun.settledMicros || "0",
        status: ownedRun.reservationStatus || "not-required",
      },
    })
  } catch {
    return Response.json(
      { error: "run-not-found", message: "Workflow run was not found." },
      { status: 404 }
    )
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null)
  const selection = getWorkflowSelectionRequest(body)
  if (!selection) {
    return Response.json(
      {
        accepted: false,
        error: "invalid-workflow-selection-request",
        message:
          "workspaceId, runId, suspensionId, selectedAssetId and idempotencyKey are required.",
      },
      { status: 400 }
    )
  }
  const access = await requireStudioApiAccess(selection.workspaceId)
  if (!access.ok) return access.response
  if (!(await authorizeWorkflowRun(selection.workspaceId, selection.runId))) {
    return workflowRunNotFoundResponse()
  }

  const client = await getPgPool()
    .connect()
    .catch(() => null)
  if (!client) return workflowRuntimeUnavailableResponse()
  let transactionOpen = false
  try {
    await client.query("begin")
    transactionOpen = true
    await lockWorkflowRunMutation(client, selection.runId)
    const claim = await claimWorkflowResume(client, selection)
    if (claim === "replayed") {
      await client.query("commit")
      transactionOpen = false
      return workflowResumeAcceptedResponse(selection, true)
    }
    if (claim === "idempotency-conflict") {
      await client.query("rollback")
      transactionOpen = false
      return Response.json(
        {
          accepted: false,
          error: "idempotency-key-conflict",
          message:
            "The idempotency key was already used for another selection.",
        },
        { status: 409 }
      )
    }
    if (claim === "suspension-already-resumed") {
      await client.query("rollback")
      transactionOpen = false
      return workflowSuspensionNotFoundResponse()
    }

    const token = selectorHookToken(selection.runId, selection.suspensionId)
    const hook = await getHookByToken(token).catch(() => null)
    if (!hook) {
      await client.query("rollback")
      transactionOpen = false
      return workflowSuspensionNotFoundResponse()
    }
    const metadata = hook.metadata
    if (
      hook.runId !== selection.runId ||
      !isWorkflowSelectorHookMetadata(metadata) ||
      metadata.workspaceId !== selection.workspaceId ||
      metadata.suspensionId !== selection.suspensionId
    ) {
      await client.query("rollback")
      transactionOpen = false
      return Response.json(
        {
          accepted: false,
          error: "selection-not-authorized",
          message: "The selection does not belong to this workspace run.",
        },
        { status: 403 }
      )
    }
    if (!metadata.candidateAssetIds.includes(selection.selectedAssetId)) {
      await client.query("rollback")
      transactionOpen = false
      return Response.json(
        {
          accepted: false,
          error: "invalid-selected-asset",
          message: "The selected asset is not an allowed candidate.",
        },
        { status: 422 }
      )
    }
    try {
      await resumeHook<WorkflowHumanSelectionPayload>(hook, {
        suspensionId: selection.suspensionId,
        selectedAssetId: selection.selectedAssetId,
      })
    } catch {
      await client.query("rollback")
      transactionOpen = false
      return workflowSuspensionNotFoundResponse()
    }
    await client.query(
      `
        update workflow_run_resume_receipt
        set status = 'completed', completed_at = now()
        where workspace_id = $1
          and run_id = $2
          and idempotency_key = $3
      `,
      [selection.workspaceId, selection.runId, selection.idempotencyKey]
    )
    await client.query("commit")
    transactionOpen = false
    return workflowResumeAcceptedResponse(selection, false)
  } catch {
    if (transactionOpen) {
      await client.query("rollback").catch(() => undefined)
    }
    return workflowRuntimeUnavailableResponse()
  } finally {
    client.release()
  }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null)
  const cancellation = getWorkflowCancellationRequest(body)
  if (!cancellation) {
    return Response.json(
      {
        accepted: false,
        error: "invalid-workflow-cancellation-request",
        message: "workspaceId, runId and idempotencyKey are required.",
      },
      { status: 400 }
    )
  }
  const access = await requireStudioApiAccess(cancellation.workspaceId)
  if (!access.ok) return access.response
  const ownedRun = await authorizeWorkflowRun(
    cancellation.workspaceId,
    cancellation.runId
  )
  if (!ownedRun) return workflowRunNotFoundResponse()

  const run = getRun<WorkflowDefinitionInterpreterResult>(cancellation.runId)
  if (!(await run.exists.catch(() => false))) {
    return workflowRunNotFoundResponse()
  }
  const events = await readKnownRuntimeEvents(run).catch(() => [])
  const started = getRunStartedEvent(events)
  if (!started || started.definition.workspaceId !== cancellation.workspaceId) {
    return workflowRunNotFoundResponse()
  }

  const client = await getPgPool()
    .connect()
    .catch(() => null)
  if (!client) return workflowRuntimeUnavailableResponse()
  let transactionOpen = false
  try {
    await client.query("begin")
    transactionOpen = true
    await lockWorkflowRunMutation(client, cancellation.runId)
    const claim = await claimWorkflowCancellation(client, cancellation)
    if (claim === "replayed") {
      await client.query("commit")
      transactionOpen = false
      return workflowCancellationAcceptedResponse(cancellation, true)
    }
    if (claim === "idempotency-conflict") {
      await client.query("rollback")
      transactionOpen = false
      return Response.json(
        {
          accepted: false,
          error: "idempotency-key-conflict",
          message:
            "The idempotency key was already used for another cancellation.",
        },
        { status: 409 }
      )
    }
    if (claim === "run-already-claimed") {
      await client.query("rollback")
      transactionOpen = false
      return workflowRunStateConflictResponse()
    }

    const sdkStatus = await run.status
    if (
      sdkStatus === "completed" ||
      sdkStatus === "failed" ||
      sdkStatus === "cancelled"
    ) {
      await client.query("rollback")
      transactionOpen = false
      return workflowRunStateConflictResponse()
    }

    try {
      await run.cancel()
    } catch {
      await client.query("rollback")
      transactionOpen = false
      return workflowRunStateConflictResponse()
    }
    if (ownedRun.reservationId) {
      const chargedMicros = getKnownRuntimeChargeMicros(events)
      await finalizeCreditReservation({
        reservationId: ownedRun.reservationId,
        workflowRunId: cancellation.runId,
        status: "settle",
        actualMicros: chargedMicros,
        reason: "Workflow run cancelled by the user.",
        workflowStatus: "cancelled",
      })
    } else {
      await finalizeUnreservedWorkflowSubmission({
        submissionId: ownedRun.submissionId,
        workflowRunId: cancellation.runId,
        status: "cancelled",
      })
    }
    await client.query(
      `
        update workflow_run_cancel_receipt
        set status = 'completed', completed_at = now()
        where workspace_id = $1
          and run_id = $2
          and idempotency_key = $3
      `,
      [
        cancellation.workspaceId,
        cancellation.runId,
        cancellation.idempotencyKey,
      ]
    )
    await client.query("commit")
    transactionOpen = false
    return workflowCancellationAcceptedResponse(cancellation, false)
  } catch {
    if (transactionOpen) {
      await client.query("rollback").catch(() => undefined)
    }
    return workflowRuntimeUnavailableResponse()
  } finally {
    client.release()
  }
}

type WorkflowRetryRequest = {
  workspaceId: string
  retryOfRunId: string
  idempotencyKey: string
}

async function retryWorkflowRun(retry: WorkflowRetryRequest, userId: string) {
  if (!(await authorizeWorkflowRun(retry.workspaceId, retry.retryOfRunId))) {
    return workflowRunNotFoundResponse()
  }
  const sourceRun = getRun<WorkflowDefinitionInterpreterResult>(
    retry.retryOfRunId
  )
  if (!(await sourceRun.exists.catch(() => false))) {
    return workflowRunNotFoundResponse()
  }
  const [sdkStatus, events] = await Promise.all([
    sourceRun.status.catch(() => null),
    readKnownRuntimeEvents(sourceRun).catch(() => []),
  ])
  const started = getRunStartedEvent(events)
  if (!started || started.definition.workspaceId !== retry.workspaceId) {
    return workflowRunNotFoundResponse()
  }
  const failure = getRunFailureEvent(events)?.failure
  if (sdkStatus !== "failed" || !failure?.retryable) {
    return workflowRetryStateConflictResponse()
  }

  const sourceArguments = await readFrozenWorkflowArguments(
    retry.retryOfRunId,
    started.definition
  ).catch(() => null)
  if (!sourceArguments) return workflowRuntimeUnavailableResponse()

  const requestFingerprint = fingerprintWorkflowSubmission({
    retryOfRunId: retry.retryOfRunId,
    definition: sourceArguments.definition,
    inputs: sourceArguments.inputs,
  })
  const submission = await claimWorkflowSubmission({
    workspaceId: retry.workspaceId,
    userId,
    idempotencyKey: `retry:${retry.idempotencyKey}`,
    requestFingerprint,
    definition: sourceArguments.definition,
  }).catch((error: unknown) =>
    error instanceof ModelCatalogError ? error : Promise.reject(error)
  )
  if (submission instanceof ModelCatalogError) {
    return modelCatalogErrorResponse(submission)
  }
  if (submission.state === "replayed") {
    return workflowRetryAcceptedResponse(retry, submission.sdkRunId, true)
  }
  if (submission.state !== "claimed") {
    return workflowSubmissionClaimResponse(submission)
  }
  try {
    const run = await start(workflowDefinitionInterpreter, [
      sourceArguments.definition,
      sourceArguments.inputs,
      {
        ...sourceArguments.options,
        retryOfRunId: retry.retryOfRunId,
        submissionId: submission.submissionId,
        creditContext: submission.creditContext,
      },
    ])
    await attachWorkflowSdkRun(submission.submissionId, run.runId)
    return workflowRetryAcceptedResponse(retry, run.runId, false)
  } catch {
    await failWorkflowStart(
      submission.submissionId,
      "Workflow SDK did not accept the retry submission."
    ).catch(() => undefined)
    return workflowRuntimeUnavailableResponse()
  }
}

async function readFrozenWorkflowArguments(
  runId: string,
  expectedDefinition: ReturnType<typeof getWorkflowDefinitionRef>
): Promise<{
  definition: WorkflowDefinition
  inputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>
  options: WorkflowInterpreterHarnessOptions
}> {
  const world = await getWorld()
  const resource = await world.runs.get(runId, { resolveData: "all" })
  const hydrated = hydrateResourceIO(resource, observabilityRevivers)
  const input = hydrated.input
  if (!Array.isArray(input) || input.length < 2) {
    throw new Error("Workflow run input is unavailable.")
  }
  const [definitionValue, inputsValue, optionsValue] = input
  if (!isFrozenWorkflowDefinition(definitionValue, expectedDefinition)) {
    throw new Error("Workflow run definition does not match its projection.")
  }
  if (!isWorkflowRuntimeInputs(inputsValue)) {
    throw new Error("Workflow run inputs are invalid.")
  }
  if (!isWorkflowInterpreterHarnessOptions(optionsValue)) {
    throw new Error("Workflow run Harness options are invalid.")
  }
  return {
    definition: definitionValue,
    inputs: inputsValue,
    options: optionsValue || {},
  }
}

function isFrozenWorkflowDefinition(
  value: unknown,
  expected: ReturnType<typeof getWorkflowDefinitionRef>
): value is WorkflowDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<WorkflowDefinition>
  return (
    candidate.workspaceId === expected.workspaceId &&
    candidate.definitionId === expected.definitionId &&
    candidate.version === expected.version &&
    candidate.schemaVersion === expected.schemaVersion &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.executionOrder)
  )
}

function isWorkflowRuntimeInputs(
  value: unknown
): value is Readonly<Record<string, WorkflowRuntimeScalarValue>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

type WorkflowSelectionRequest = {
  workspaceId: string
  runId: string
  suspensionId: string
  selectedAssetId: string
  idempotencyKey: string
}

type WorkflowResumeClaim =
  | "claimed"
  | "replayed"
  | "idempotency-conflict"
  | "suspension-already-resumed"

type WorkflowCancellationRequest = {
  workspaceId: string
  runId: string
  idempotencyKey: string
  reason?: string
}

type WorkflowCancellationClaim =
  | "claimed"
  | "replayed"
  | "idempotency-conflict"
  | "run-already-claimed"

async function lockWorkflowRunMutation(client: PoolClient, runId: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    runId,
  ])
}

async function claimWorkflowResume(
  client: PoolClient,
  selection: WorkflowSelectionRequest
): Promise<WorkflowResumeClaim> {
  const inserted = await client.query(
    `
      insert into workflow_run_resume_receipt (
        workspace_id,
        run_id,
        suspension_id,
        idempotency_key,
        selected_asset_id,
        status
      )
      values ($1, $2, $3, $4, $5, 'processing')
      on conflict do nothing
      returning idempotency_key
    `,
    [
      selection.workspaceId,
      selection.runId,
      selection.suspensionId,
      selection.idempotencyKey,
      selection.selectedAssetId,
    ]
  )
  if (inserted.rowCount === 1) return "claimed"

  const sameKey = await client.query<{
    suspensionId: string
    selectedAssetId: string
    status: string
  }>(
    `
      select
        suspension_id as "suspensionId",
        selected_asset_id as "selectedAssetId",
        status
      from workflow_run_resume_receipt
      where workspace_id = $1
        and run_id = $2
        and idempotency_key = $3
      limit 1
    `,
    [selection.workspaceId, selection.runId, selection.idempotencyKey]
  )
  const receipt = sameKey.rows[0]
  if (receipt) {
    if (
      receipt.suspensionId !== selection.suspensionId ||
      receipt.selectedAssetId !== selection.selectedAssetId
    ) {
      return "idempotency-conflict"
    }
    return receipt.status === "completed"
      ? "replayed"
      : "suspension-already-resumed"
  }

  return "suspension-already-resumed"
}

async function claimWorkflowCancellation(
  client: PoolClient,
  cancellation: WorkflowCancellationRequest
): Promise<WorkflowCancellationClaim> {
  const inserted = await client.query(
    `
      insert into workflow_run_cancel_receipt (
        workspace_id,
        run_id,
        idempotency_key,
        reason,
        status
      )
      values ($1, $2, $3, $4, 'processing')
      on conflict do nothing
      returning idempotency_key
    `,
    [
      cancellation.workspaceId,
      cancellation.runId,
      cancellation.idempotencyKey,
      cancellation.reason || null,
    ]
  )
  if (inserted.rowCount === 1) return "claimed"

  const sameKey = await client.query<{ reason: string | null; status: string }>(
    `
      select reason, status
      from workflow_run_cancel_receipt
      where workspace_id = $1
        and run_id = $2
        and idempotency_key = $3
      limit 1
    `,
    [cancellation.workspaceId, cancellation.runId, cancellation.idempotencyKey]
  )
  const receipt = sameKey.rows[0]
  if (!receipt) return "run-already-claimed"
  if ((receipt.reason || undefined) !== cancellation.reason) {
    return "idempotency-conflict"
  }
  return receipt.status === "completed" ? "replayed" : "run-already-claimed"
}

function workflowResumeAcceptedResponse(
  selection: WorkflowSelectionRequest,
  idempotentReplay: boolean
) {
  return Response.json(
    {
      accepted: true,
      runId: selection.runId,
      suspensionId: selection.suspensionId,
      idempotencyKey: selection.idempotencyKey,
      idempotentReplay,
      status: "resuming",
    },
    { status: 202 }
  )
}

function workflowSuspensionNotFoundResponse() {
  return Response.json(
    {
      accepted: false,
      error: "suspension-not-found",
      message: "The active workflow suspension was not found.",
    },
    { status: 404 }
  )
}

function workflowCancellationAcceptedResponse(
  cancellation: WorkflowCancellationRequest,
  idempotentReplay: boolean
) {
  return Response.json(
    {
      accepted: true,
      runId: cancellation.runId,
      idempotencyKey: cancellation.idempotencyKey,
      idempotentReplay,
      status: "cancelling",
    },
    { status: 202 }
  )
}

function workflowRetryAcceptedResponse(
  retry: WorkflowRetryRequest,
  runId: string,
  idempotentReplay: boolean
) {
  return Response.json(
    {
      accepted: true,
      runId,
      retryOfRunId: retry.retryOfRunId,
      idempotencyKey: retry.idempotencyKey,
      idempotentReplay,
      status: "queued",
    },
    { status: 202 }
  )
}

function workflowRunNotFoundResponse() {
  return Response.json(
    { error: "run-not-found", message: "Workflow run was not found." },
    { status: 404 }
  )
}

function workflowRunStateConflictResponse() {
  return Response.json(
    {
      accepted: false,
      error: "run-state-conflict",
      message: "The workflow run cannot be cancelled from its current state.",
    },
    { status: 409 }
  )
}

function workflowRetryStateConflictResponse() {
  return Response.json(
    {
      accepted: false,
      error: "run-retry-conflict",
      message:
        "Only terminal, retryable workflow failures can create a new retry run.",
    },
    { status: 409 }
  )
}

function workflowRuntimeUnavailableResponse() {
  return Response.json(
    {
      accepted: false,
      error: "runtime-unavailable",
      message: "The workflow runtime is temporarily unavailable.",
    },
    { status: 503 }
  )
}

function modelCatalogErrorResponse(error: ModelCatalogError) {
  return Response.json(
    {
      accepted: false,
      error: error.code,
      message: error.message,
    },
    { status: 422 }
  )
}

function workflowCatalogInvocationErrorResponse(
  error: WorkflowCatalogStoreError
) {
  const status =
    error.code === "workflow-definition-version-not-found" ||
    error.code === "workflow-deployment-not-found" ||
    error.code === "workflow-draft-not-found"
      ? 404
      : error.code === "workflow-workspace-mismatch"
        ? 403
        : error.code === "workflow-publication-invalid"
          ? 422
          : 409
  return Response.json(
    {
      accepted: false,
      error: error.code,
      message: error.message,
    },
    { status }
  )
}

function publishedWorkflowInvocationFailureResponse(
  result: Exclude<
    StartPublishedWorkflowInvocationResult,
    { state: "started" | "replayed" }
  >
) {
  switch (result.state) {
    case "in-progress":
      return Response.json(
        {
          accepted: false,
          error: "workflow-submission-in-progress",
          message: "This workflow submission is still being started.",
        },
        { status: 409, headers: { "retry-after": "2" } }
      )
    case "idempotency-conflict":
      return Response.json(
        {
          accepted: false,
          error: "idempotency-key-conflict",
          message: "The idempotency key belongs to another workflow request.",
        },
        { status: 409 }
      )
    case "insufficient-credits":
      return Response.json(
        {
          accepted: false,
          error: "insufficient-credits",
          message: "Available credits are lower than the estimated run cost.",
          billing: {
            requiredMicros: result.requiredMicros.toString(),
            availableMicros: result.availableMicros.toString(),
          },
        },
        { status: 402 }
      )
    case "runtime-unavailable":
      return workflowRuntimeUnavailableResponse()
  }
}

function workflowSubmissionClaimResponse(
  claim: Exclude<
    Awaited<ReturnType<typeof claimWorkflowSubmission>>,
    { state: "claimed" }
  >
) {
  switch (claim.state) {
    case "replayed":
      return Response.json(
        {
          accepted: true,
          runId: claim.sdkRunId,
          idempotentReplay: true,
          billing: { estimatedMicros: claim.estimatedMicros.toString() },
        },
        { status: 202 }
      )
    case "in-progress":
      return Response.json(
        {
          accepted: false,
          error: "workflow-submission-in-progress",
          message: "This workflow submission is still being started.",
        },
        { status: 409, headers: { "retry-after": "2" } }
      )
    case "idempotency-conflict":
      return Response.json(
        {
          accepted: false,
          error: "idempotency-key-conflict",
          message: "The idempotency key belongs to another workflow request.",
        },
        { status: 409 }
      )
    case "insufficient-credits":
      return Response.json(
        {
          accepted: false,
          error: "insufficient-credits",
          message: "Available credits are lower than the estimated run cost.",
          billing: {
            requiredMicros: claim.requiredMicros.toString(),
            availableMicros: claim.availableMicros.toString(),
          },
        },
        { status: 402 }
      )
  }
}

function getRequestedWorkspaceId(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const workspaceId = (body as { workspaceId?: unknown }).workspaceId
  return typeof workspaceId === "string" && workspaceId.trim()
    ? workspaceId.trim()
    : undefined
}

function getKnownRuntimeChargeMicros(events: readonly WorkflowRuntimeEvent[]) {
  return events.reduce((total, event) => {
    if (event.type !== "node.succeeded" || !event.usage) return total
    return total + BigInt(event.usage.creditMicros)
  }, BigInt(0))
}

function getWorkflowInvocationRequest(body: unknown): {
  workspaceId: string
  idempotencyKey: string
  target: WorkflowInvocationTarget
  inputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const { workspaceId, target, idempotencyKey } = body as {
    workspaceId?: unknown
    target?: unknown
    idempotencyKey?: unknown
    inputs?: unknown
  }
  if (typeof workspaceId !== "string" || !workspaceId.trim()) return null
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) return null
  const invocationTarget = parseWorkflowInvocationTarget(target)
  if (!invocationTarget) return null
  return {
    workspaceId: workspaceId.trim(),
    idempotencyKey: idempotencyKey.trim(),
    target: invocationTarget,
    inputs: getWorkflowInputs((body as { inputs?: unknown }).inputs),
  }
}

function parseWorkflowInvocationTarget(
  value: unknown
): WorkflowInvocationTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind === "deployment") {
    return typeof candidate.workspaceId === "string" &&
      candidate.workspaceId.trim() &&
      typeof candidate.deploymentId === "string" &&
      candidate.deploymentId.trim()
      ? {
          kind: "deployment",
          workspaceId: candidate.workspaceId.trim(),
          deploymentId: candidate.deploymentId.trim(),
        }
      : null
  }
  if (candidate.kind !== "definition-version") return null
  const definition = candidate.definition
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    return null
  }
  const ref = definition as Record<string, unknown>
  return typeof ref.workspaceId === "string" &&
    ref.workspaceId.trim() &&
    typeof ref.definitionId === "string" &&
    ref.definitionId.trim() &&
    Number.isSafeInteger(ref.version) &&
    Number(ref.version) >= 1 &&
    ref.schemaVersion === WORKFLOW_DEFINITION_SCHEMA_VERSION
    ? {
        kind: "definition-version",
        definition: {
          workspaceId: ref.workspaceId.trim(),
          definitionId: ref.definitionId.trim(),
          version: Number(ref.version),
          schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
        },
      }
    : null
}

function getWorkflowRetryRequest(body: unknown): WorkflowRetryRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const candidate = body as Partial<WorkflowRetryRequest>
  if (
    typeof candidate.workspaceId !== "string" ||
    !candidate.workspaceId.trim() ||
    typeof candidate.retryOfRunId !== "string" ||
    !candidate.retryOfRunId.startsWith("wrun_") ||
    typeof candidate.idempotencyKey !== "string" ||
    !candidate.idempotencyKey.trim()
  ) {
    return null
  }
  return {
    workspaceId: candidate.workspaceId.trim(),
    retryOfRunId: candidate.retryOfRunId,
    idempotencyKey: candidate.idempotencyKey.trim(),
  }
}

function getControlledHarnessOptions(
  request: Request
): WorkflowInterpreterHarnessOptions | "disabled" | "invalid" {
  const scenario = request.headers.get("x-muses-workflow-harness")
  if (!scenario) return {}
  if (process.env.MUSES_WORKFLOW_HARNESS_ENABLED !== "true") {
    return "disabled"
  }
  switch (scenario) {
    case "permanent-failure":
      return {
        failureFault: {
          nodeId: "image-generator-1",
          mode: "permanent",
          failThroughAttempt: 1,
        },
      }
    case "transient-recovery":
      return {
        failureFault: {
          nodeId: "image-generator-1",
          mode: "transient",
          failThroughAttempt: 2,
        },
      }
    case "transient-exhaustion":
      return {
        failureFault: {
          nodeId: "image-generator-1",
          mode: "transient",
          failThroughAttempt: 3,
        },
      }
    case "selector-timeout":
      return { selectorTimeoutMs: 2_500 }
    default:
      return "invalid"
  }
}

function getWorkflowInputs(
  value: unknown
): Readonly<Record<string, WorkflowRuntimeScalarValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const inputs: Record<string, WorkflowRuntimeScalarValue> = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== "object") continue
    const runtimeValue = candidate as {
      valueType?: unknown
      value?: unknown
    }
    if (
      runtimeValue.valueType === "text" &&
      typeof runtimeValue.value === "string"
    ) {
      inputs[key] = { valueType: "text", value: runtimeValue.value }
    } else if (
      runtimeValue.valueType === "number" &&
      typeof runtimeValue.value === "number" &&
      Number.isFinite(runtimeValue.value)
    ) {
      inputs[key] = { valueType: "number", value: runtimeValue.value }
    } else if (
      runtimeValue.valueType === "boolean" &&
      typeof runtimeValue.value === "boolean"
    ) {
      inputs[key] = { valueType: "boolean", value: runtimeValue.value }
    }
  }
  return inputs
}

function getWorkflowSelectionRequest(body: unknown): {
  workspaceId: string
  runId: string
  suspensionId: string
  selectedAssetId: string
  idempotencyKey: string
} | null {
  if (!body || typeof body !== "object") return null
  const candidate = body as Record<string, unknown>
  for (const key of [
    "workspaceId",
    "runId",
    "suspensionId",
    "selectedAssetId",
    "idempotencyKey",
  ]) {
    if (typeof candidate[key] !== "string" || !candidate[key].trim()) {
      return null
    }
  }
  if (String(candidate.idempotencyKey).trim().length > 512) return null
  return {
    workspaceId: String(candidate.workspaceId).trim(),
    runId: String(candidate.runId).trim(),
    suspensionId: String(candidate.suspensionId).trim(),
    selectedAssetId: String(candidate.selectedAssetId).trim(),
    idempotencyKey: String(candidate.idempotencyKey).trim(),
  }
}

function getWorkflowCancellationRequest(
  body: unknown
): WorkflowCancellationRequest | null {
  if (!body || typeof body !== "object") return null
  const candidate = body as Record<string, unknown>
  for (const key of ["workspaceId", "runId", "idempotencyKey"]) {
    if (typeof candidate[key] !== "string" || !candidate[key].trim()) {
      return null
    }
  }
  const idempotencyKey = String(candidate.idempotencyKey).trim()
  if (idempotencyKey.length > 512) return null
  const reason =
    typeof candidate.reason === "string" && candidate.reason.trim()
      ? candidate.reason.trim().slice(0, 500)
      : undefined
  return {
    workspaceId: String(candidate.workspaceId).trim(),
    runId: String(candidate.runId).trim(),
    idempotencyKey,
    reason,
  }
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
