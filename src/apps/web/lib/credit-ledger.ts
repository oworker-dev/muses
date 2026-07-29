import { createHash } from "node:crypto"
import type { PoolClient } from "pg"

import type {
  ImageReferenceImageSpec,
  ResolvedImageOutputSize,
  WorkflowDefinition,
  WorkflowDefinitionImageGeneratorNode,
  WorkflowInvocationCaller,
} from "@muses/domain"
import { resolveImageOutputSize } from "@muses/domain"

import { getPgPool } from "@/lib/database"
import {
  ModelCatalogError,
  resolveImageModelOffering,
} from "@/lib/model-catalog"
import { prefixedId } from "@/lib/studio-access"
import { getReadyReferenceImages } from "@/lib/reference-image-storage"

const ZERO = BigInt(0)

export type WorkflowCreditContext = {
  reservationId: string
  estimatedMicros: string
  nodePrices: Array<{
    nodeId: string
    modelRef: string
    providerId: string
    providerModelId: string
    capabilityProfileId: string
    capabilityProfileVersion: string
    priceBookEntryId: string
    priceBookVersion: string
    unitCreditMicros: string
    resolvedSize: ResolvedImageOutputSize
    referenceImageAssetIds: string[]
    referenceImages: ImageReferenceImageSpec
  }>
}

export type WorkflowSubmissionClaim =
  | {
      state: "claimed"
      submissionId: string
      creditContext?: WorkflowCreditContext
      estimatedMicros: bigint
      availableAfterReserveMicros: bigint
    }
  | {
      state: "replayed"
      submissionId: string
      sdkRunId: string
      estimatedMicros: bigint
    }
  | { state: "in-progress"; submissionId: string }
  | { state: "idempotency-conflict" }
  | {
      state: "insufficient-credits"
      requiredMicros: bigint
      availableMicros: bigint
    }

export function fingerprintWorkflowSubmission(input: unknown) {
  return createHash("sha256").update(stableJson(input)).digest("hex")
}

export async function claimWorkflowSubmission(input: {
  workspaceId: string
  userId: string
  idempotencyKey: string
  requestFingerprint: string
  definition: WorkflowDefinition
  deploymentId?: string
  caller?: WorkflowInvocationCaller
}): Promise<WorkflowSubmissionClaim> {
  const pricing = await estimateWorkflowCredits(input.definition)
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const existing = await client.query<{
      id: string
      sdkRunId: string | null
      status: string
      requestFingerprint: string
      estimatedMicros: string | null
    }>(
      `
        select
          run.id,
          run.sdk_run_id as "sdkRunId",
          run.status,
          run.request_fingerprint as "requestFingerprint",
          reservation.estimated_micros as "estimatedMicros"
        from muses_workflow_run run
        left join credit_reservation reservation on reservation.id = run.reservation_id
        where run.workspace_id = $1 and run.idempotency_key = $2
        limit 1
      `,
      [input.workspaceId, input.idempotencyKey]
    )
    const prior = existing.rows[0]
    if (prior) {
      await client.query("commit")
      if (prior.requestFingerprint !== input.requestFingerprint) {
        return { state: "idempotency-conflict" }
      }
      if (prior.sdkRunId) {
        return {
          state: "replayed",
          submissionId: prior.id,
          sdkRunId: prior.sdkRunId,
          estimatedMicros: BigInt(prior.estimatedMicros || 0),
        }
      }
      return { state: "in-progress", submissionId: prior.id }
    }

    const account = (
      await client.query<{
        id: string
        postedMicros: string
        reservedMicros: string
      }>(
        `
          select
            id,
            posted_balance_micros as "postedMicros",
            reserved_balance_micros as "reservedMicros"
          from credit_account
          where workspace_id = $1
          for update
        `,
        [input.workspaceId]
      )
    ).rows[0]
    if (!account) throw new Error("Studio credit account was not found.")

    const postedMicros = BigInt(account.postedMicros)
    const reservedMicros = BigInt(account.reservedMicros)
    const availableMicros = postedMicros - reservedMicros
    if (pricing.estimatedMicros > availableMicros) {
      await client.query("rollback")
      return {
        state: "insufficient-credits",
        requiredMicros: pricing.estimatedMicros,
        availableMicros,
      }
    }

    const submissionId = prefixedId("mrun")
    const publishedDefinition = input.definition.version >= 1
    await client.query(
      `
        insert into muses_workflow_run (
          id,
          workspace_id,
          submitted_by_user_id,
          workflow_document_id,
          workflow_document_revision,
          workflow_definition_id,
          workflow_definition_version,
          workflow_deployment_id,
          caller_kind,
          caller_id,
          idempotency_key,
          request_fingerprint,
          status
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'starting')
      `,
      [
        submissionId,
        input.workspaceId,
        input.userId,
        input.definition.source.documentId,
        input.definition.source.documentRevision,
        publishedDefinition ? input.definition.definitionId : null,
        publishedDefinition ? input.definition.version : null,
        input.deploymentId || null,
        (input.caller || { kind: "user", userId: input.userId }).kind,
        workflowCallerId(
          input.caller || { kind: "user", userId: input.userId }
        ),
        input.idempotencyKey,
        input.requestFingerprint,
      ]
    )

    let creditContext: WorkflowCreditContext | undefined
    if (pricing.estimatedMicros > ZERO) {
      const reservationId = prefixedId("mcr")
      const nextReserved = reservedMicros + pricing.estimatedMicros
      const snapshot = {
        version: "model-catalog-image-request-v2",
        nodePrices: pricing.nodePrices.map((price) => ({
          ...price,
          unitCreditMicros: price.unitCreditMicros.toString(),
        })),
      }
      await client.query(
        `
          insert into credit_reservation (
            id,
            account_id,
            workspace_id,
            submission_id,
            idempotency_key,
            estimated_micros,
            pricing_snapshot
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          reservationId,
          account.id,
          input.workspaceId,
          submissionId,
          input.idempotencyKey,
          pricing.estimatedMicros.toString(),
          JSON.stringify(snapshot),
        ]
      )
      await client.query(
        `
          insert into credit_ledger_entry (
            id,
            account_id,
            workspace_id,
            kind,
            balance_delta_micros,
            reserved_delta_micros,
            balance_after_micros,
            reserved_after_micros,
            reservation_id,
            idempotency_key,
            actor_user_id,
            reason,
            metadata
          )
          values ($1, $2, $3, 'reserve', 0, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          prefixedId("mle"),
          account.id,
          input.workspaceId,
          pricing.estimatedMicros.toString(),
          postedMicros.toString(),
          nextReserved.toString(),
          reservationId,
          `reserve:${input.idempotencyKey}`,
          input.userId,
          "Workflow model usage reservation",
          JSON.stringify(snapshot),
        ]
      )
      await client.query(
        `
          update credit_account
          set reserved_balance_micros = $2, updated_at = now()
          where id = $1
        `,
        [account.id, nextReserved.toString()]
      )
      await client.query(
        "update muses_workflow_run set reservation_id = $2 where id = $1",
        [submissionId, reservationId]
      )
      creditContext = {
        reservationId,
        estimatedMicros: pricing.estimatedMicros.toString(),
        nodePrices: pricing.nodePrices.map((price) => ({
          nodeId: price.nodeId,
          modelRef: price.modelRef,
          providerId: price.providerId,
          providerModelId: price.providerModelId,
          capabilityProfileId: price.capabilityProfileId,
          capabilityProfileVersion: price.capabilityProfileVersion,
          priceBookEntryId: price.priceBookEntryId,
          priceBookVersion: price.priceBookVersion,
          unitCreditMicros: price.unitCreditMicros.toString(),
          resolvedSize: price.resolvedSize,
          referenceImageAssetIds: [...price.referenceImageAssetIds],
          referenceImages: price.referenceImages,
        })),
      }
    }

    await client.query("commit")
    return {
      state: "claimed",
      submissionId,
      creditContext,
      estimatedMicros: pricing.estimatedMicros,
      availableAfterReserveMicros: availableMicros - pricing.estimatedMicros,
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function workflowCallerId(caller: WorkflowInvocationCaller) {
  switch (caller.kind) {
    case "user":
      return caller.userId
    case "agent":
      return caller.agentRunId
    case "api":
      return caller.clientId
    case "workflow":
      return caller.workflowRunId
  }
}

export async function attachWorkflowSdkRun(
  submissionId: string,
  sdkRunId: string
) {
  const result = await getPgPool().query(
    `
      update muses_workflow_run
      set sdk_run_id = $2,
          status = case when status = 'starting' then 'running' else status end,
          started_at = coalesce(started_at, now())
      where id = $1 and (sdk_run_id is null or sdk_run_id = $2)
    `,
    [submissionId, sdkRunId]
  )
  if (result.rowCount !== 1) {
    throw new Error("Workflow submission could not be attached to its SDK run.")
  }
  await getPgPool().query(
    `
      update credit_reservation
      set workflow_run_id = $2
      where submission_id = $1
        and (workflow_run_id is null or workflow_run_id = $2)
    `,
    [submissionId, sdkRunId]
  )
}

export async function failWorkflowStart(submissionId: string, reason: string) {
  const result = await getPgPool().query<{ reservationId: string | null }>(
    `
      update muses_workflow_run
      set status = 'failed', completed_at = now()
      where id = $1 and sdk_run_id is null
      returning reservation_id as "reservationId"
    `,
    [submissionId]
  )
  const reservationId = result.rows[0]?.reservationId
  if (reservationId) {
    await finalizeCreditReservation({
      reservationId,
      workflowRunId: null,
      status: "release",
      actualMicros: ZERO,
      reason,
      workflowStatus: "failed",
    })
  }
}

export async function finalizeUnreservedWorkflowSubmission(input: {
  submissionId: string
  workflowRunId: string
  status: "completed" | "failed" | "cancelled"
}) {
  const result = await getPgPool().query(
    `
      update muses_workflow_run
      set status = $2,
          sdk_run_id = coalesce(sdk_run_id, $3),
          completed_at = coalesce(completed_at, now())
      where id = $1
        and reservation_id is null
        and (sdk_run_id is null or sdk_run_id = $3)
    `,
    [input.submissionId, input.status, input.workflowRunId]
  )
  if (result.rowCount !== 1) {
    throw new Error("Unreserved workflow submission could not be finalized.")
  }
}

export async function finalizeCreditReservation(input: {
  reservationId: string
  workflowRunId: string | null
  status: "settle" | "release" | "review"
  actualMicros: bigint
  reason: string
  workflowStatus: "completed" | "failed" | "cancelled"
}) {
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const reservation = (
      await client.query<{
        id: string
        accountId: string
        workspaceId: string
        submissionId: string
        status: string
        estimatedMicros: string
      }>(
        `
          select
            id,
            account_id as "accountId",
            workspace_id as "workspaceId",
            submission_id as "submissionId",
            status,
            estimated_micros as "estimatedMicros"
          from credit_reservation
          where id = $1
          for update
        `,
        [input.reservationId]
      )
    ).rows[0]
    if (!reservation || reservation.status !== "active") {
      await client.query("commit")
      return
    }

    if (input.status === "review") {
      await client.query(
        `
          update credit_reservation
          set status = 'review_required', failure_reason = $2
          where id = $1
        `,
        [reservation.id, input.reason]
      )
      await updateSubmissionStatus(
        client,
        reservation.submissionId,
        input.workflowStatus,
        input.workflowRunId
      )
      await client.query("commit")
      return
    }

    const account = (
      await client.query<{
        postedMicros: string
        reservedMicros: string
      }>(
        `
          select
            posted_balance_micros as "postedMicros",
            reserved_balance_micros as "reservedMicros"
          from credit_account
          where id = $1
          for update
        `,
        [reservation.accountId]
      )
    ).rows[0]
    if (!account) throw new Error("Credit account was not found.")

    const estimated = BigInt(reservation.estimatedMicros)
    const actual =
      input.status === "release"
        ? ZERO
        : input.actualMicros < estimated
          ? input.actualMicros
          : estimated
    let posted = BigInt(account.postedMicros)
    let reserved = BigInt(account.reservedMicros)

    if (actual > ZERO) {
      posted -= actual
      reserved -= actual
      await insertLedgerEntry(client, {
        accountId: reservation.accountId,
        workspaceId: reservation.workspaceId,
        reservationId: reservation.id,
        workflowRunId: input.workflowRunId,
        kind: "settle",
        balanceDeltaMicros: -actual,
        reservedDeltaMicros: -actual,
        balanceAfterMicros: posted,
        reservedAfterMicros: reserved,
        idempotencyKey: `settle:${reservation.id}`,
        reason: input.reason,
      })
    }

    const released = estimated - actual
    if (released > ZERO) {
      reserved -= released
      await insertLedgerEntry(client, {
        accountId: reservation.accountId,
        workspaceId: reservation.workspaceId,
        reservationId: reservation.id,
        workflowRunId: input.workflowRunId,
        kind: "release",
        balanceDeltaMicros: ZERO,
        reservedDeltaMicros: -released,
        balanceAfterMicros: posted,
        reservedAfterMicros: reserved,
        idempotencyKey: `release:${reservation.id}`,
        reason: input.reason,
      })
    }

    await client.query(
      `
        update credit_account
        set posted_balance_micros = $2,
            reserved_balance_micros = $3,
            updated_at = now()
        where id = $1
      `,
      [reservation.accountId, posted.toString(), reserved.toString()]
    )
    await client.query(
      `
        update credit_reservation
        set status = $2,
            workflow_run_id = coalesce(workflow_run_id, $3),
            settled_micros = $4,
            failure_reason = $5,
            finalized_at = now()
        where id = $1
      `,
      [
        reservation.id,
        input.status === "release" ? "released" : "settled",
        input.workflowRunId,
        actual.toString(),
        input.status === "release" ? input.reason : null,
      ]
    )
    await updateSubmissionStatus(
      client,
      reservation.submissionId,
      input.workflowStatus,
      input.workflowRunId
    )
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function authorizeWorkflowRun(
  workspaceId: string,
  sdkRunId: string
) {
  const result = await getPgPool().query<{
    submissionId: string
    reservationId: string | null
    reservationStatus: string | null
    estimatedMicros: string | null
    settledMicros: string | null
    pricingSnapshot: unknown
  }>(
    `
      select
        run.id as "submissionId",
        run.reservation_id as "reservationId",
        reservation.status as "reservationStatus",
        reservation.estimated_micros as "estimatedMicros",
        reservation.settled_micros as "settledMicros",
        reservation.pricing_snapshot as "pricingSnapshot"
      from muses_workflow_run run
      left join credit_reservation reservation on reservation.id = run.reservation_id
      where run.workspace_id = $1 and run.sdk_run_id = $2
      limit 1
    `,
    [workspaceId, sdkRunId]
  )
  return result.rows[0] || null
}

export function creditChargeForNode(
  context: WorkflowCreditContext | undefined,
  nodeId: string,
  outputCount: number
) {
  const price = context?.nodePrices.find(
    (candidate) => candidate.nodeId === nodeId
  )
  return price ? BigInt(price.unitCreditMicros) * BigInt(outputCount) : ZERO
}

async function estimateWorkflowCredits(definition: WorkflowDefinition) {
  const imageNodes = definition.nodes.filter(
    (node): node is WorkflowDefinitionImageGeneratorNode =>
      node.kind === "image-generator" &&
      node.config.capabilityId === "image.generate.v1"
  )
  const nodePrices = await Promise.all(
    imageNodes.map(async (node) => {
      const offering = await resolveImageModelOffering(node.config.modelRef)
      const profile = offering.capability.specification
      const size = resolveImageOutputSize(node.config.output.size, profile)
      const fixedReferenceIds =
        node.config.inputs.referenceImages.mode === "fixed"
          ? [...new Set(node.config.inputs.referenceImages.assetIds)]
          : []
      const hasVariableReferenceBinding = definition.dataBindings.some(
        (binding) =>
          binding.target.nodeId === node.id &&
          binding.target.portId === "referenceImages"
      )
      const inputMode =
        fixedReferenceIds.length > 0 || hasVariableReferenceBinding
          ? "image-to-image"
          : "text-to-image"
      if (
        offering.capability.id !== node.config.capabilityId ||
        !size.ok ||
        !profile.inputModes.includes(inputMode) ||
        !profile.outputCounts.includes(node.config.output.count) ||
        !profile.parameters.quality.values.includes(node.config.quality) ||
        fixedReferenceIds.length > profile.referenceImages.maxCount
      ) {
        throw new ModelCatalogError(
          "model-capability-invalid",
          `Image node "${node.id}" is not valid for "${node.config.modelRef}".`
        )
      }
      const referenceAssets = await getReadyReferenceImages({
        workspaceId: definition.workspaceId,
        assetIds: fixedReferenceIds,
      })
      if (
        referenceAssets.some(
          (asset) =>
            !profile.referenceImages.mimeTypes.includes(asset.mimeType) ||
            asset.byteSize > profile.referenceImages.maxBytes
        )
      ) {
        throw new ModelCatalogError(
          "model-capability-invalid",
          `Reference images for node "${node.id}" exceed the model profile.`
        )
      }
      return {
        nodeId: node.id,
        modelRef: offering.modelRef,
        providerId: offering.provider.id,
        providerModelId: offering.providerModelId,
        capabilityProfileId: offering.capability.profileId,
        capabilityProfileVersion: offering.capability.profileVersion,
        priceBookEntryId: offering.price.entryId,
        priceBookVersion: offering.price.priceBookVersion,
        unitCreditMicros: BigInt(offering.price.unitCreditMicros),
        resolvedSize: size.value,
        referenceImageAssetIds: fixedReferenceIds,
        referenceImages: profile.referenceImages,
        count: node.config.output.count,
      }
    })
  )
  return {
    nodePrices,
    estimatedMicros: nodePrices.reduce(
      (total, price) => total + price.unitCreditMicros * BigInt(price.count),
      ZERO
    ),
  }
}

async function insertLedgerEntry(
  client: PoolClient,
  input: {
    accountId: string
    workspaceId: string
    reservationId: string
    workflowRunId: string | null
    kind: "settle" | "release"
    balanceDeltaMicros: bigint
    reservedDeltaMicros: bigint
    balanceAfterMicros: bigint
    reservedAfterMicros: bigint
    idempotencyKey: string
    reason: string
  }
) {
  await client.query(
    `
      insert into credit_ledger_entry (
        id,
        account_id,
        workspace_id,
        kind,
        balance_delta_micros,
        reserved_delta_micros,
        balance_after_micros,
        reserved_after_micros,
        reservation_id,
        workflow_run_id,
        idempotency_key,
        reason
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (account_id, idempotency_key) do nothing
    `,
    [
      prefixedId("mle"),
      input.accountId,
      input.workspaceId,
      input.kind,
      input.balanceDeltaMicros.toString(),
      input.reservedDeltaMicros.toString(),
      input.balanceAfterMicros.toString(),
      input.reservedAfterMicros.toString(),
      input.reservationId,
      input.workflowRunId,
      input.idempotencyKey,
      input.reason,
    ]
  )
}

async function updateSubmissionStatus(
  client: PoolClient,
  submissionId: string,
  status: "completed" | "failed" | "cancelled",
  workflowRunId: string | null
) {
  await client.query(
    `
      update muses_workflow_run
      set status = $2,
          sdk_run_id = coalesce(sdk_run_id, $3),
          completed_at = now()
      where id = $1
    `,
    [submissionId, status, workflowRunId]
  )
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`
}
