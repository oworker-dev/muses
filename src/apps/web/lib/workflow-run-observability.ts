import {
  hydrateResourceIO,
  observabilityRevivers,
} from "workflow/observability"
import { getWorld } from "workflow/runtime"

import type { WorkflowRuntimeValue } from "@muses/domain"

import type {
  WorkflowRuntimeEvent,
  WorkflowRuntimeFailureProjection,
} from "@/workflows/workflow-definition-interpreter"

const OBSERVABILITY_SCHEMA_VERSION = "0.1.0"
const MAX_SUMMARY_TEXT_LENGTH = 4_000

export type WorkflowRunBillingFacts = {
  reservationStatus: string | null
  estimatedMicros: string | null
  settledMicros: string | null
  pricingSnapshot: unknown
}

export type WorkflowRunValueSummary =
  | {
      portId: string
      valueType: "text"
      value: string
      truncated: boolean
    }
  | { portId: string; valueType: "number"; value: number }
  | { portId: string; valueType: "boolean"; value: boolean }
  | { portId: string; valueType: "image"; count: number }
  | {
      portId: string
      valueType: "design-document"
      documentId: string
      revision: number
    }

export type WorkflowRunNodeObservability = {
  nodeId: string
  nodeKind: string
  status: "running" | "waiting" | "succeeded" | "failed" | "cancelled"
  attempt?: number
  startedAt?: string
  completedAt?: string
  durationMs?: number
  inputSummary: WorkflowRunValueSummary[]
  outputSummary: WorkflowRunValueSummary[]
  model?: {
    modelRef: string
    capabilityProfile?: { id: string; version: string }
    priceBook?: {
      entryId: string
      version: string
      unitCreditMicros: string
    }
    requestedSize?: { width: number; height: number }
    resolvedSize?: { width: number; height: number; adjusted: boolean }
  }
  usage?: {
    imageCount: number
    tokenStatus: "reported" | "not-reported"
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    costUsd?: number
    agentRunId?: string
    agentEventCount?: number
  }
  billing?: {
    estimatedMicros: string
    actualMicros: string
    status: string
  }
  error?: WorkflowRuntimeFailureProjection
}

export type WorkflowRunObservabilityProjection = {
  schemaVersion: typeof OBSERVABILITY_SCHEMA_VERSION
  source: "workflow-sdk-world" | "muses-runtime-events"
  run: {
    startedAt?: string
    completedAt?: string
    durationMs?: number
    workflowCoreVersion?: string
  }
  nodes: WorkflowRunNodeObservability[]
  totals: {
    imageCount: number
    tokenStatus: "reported" | "not-reported"
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    costUsd?: number
    estimatedMicros: string
    actualMicros: string
    billingStatus: string
  }
}

type HydratedBusinessStep = {
  nodeId: string
  nodeKind: string
  modelRef?: string
  attempt?: number
  startedAt?: string
  completedAt?: string
  inputs: Readonly<Record<string, unknown>>
}

type NodePriceSnapshot = {
  nodeId: string
  modelRef: string
  capabilityProfileId?: string
  capabilityProfileVersion?: string
  priceBookEntryId?: string
  priceBookVersion?: string
  unitCreditMicros?: string
  count?: number
  resolvedSize?: {
    requested?: { width: number; height: number }
    width: number
    height: number
    adjusted?: boolean
  }
}

export async function readWorkflowRunObservability(input: {
  runId: string
  events: readonly WorkflowRuntimeEvent[]
  billing: WorkflowRunBillingFacts
}) {
  const world = await getWorld()
  const [serializedRun, serializedSteps] = await Promise.all([
    world.runs.get(input.runId, { resolveData: "all" }),
    readAllWorkflowSteps(world, input.runId),
  ])
  const run = hydrateResourceIO(serializedRun, observabilityRevivers)
  const runRecord = record(run)
  const steps = serializedSteps
    .map((step) => hydrateResourceIO(step, observabilityRevivers))
    .map(readBusinessStep)
    .filter((step): step is HydratedBusinessStep => Boolean(step))

  return buildWorkflowRunObservability({
    events: input.events,
    billing: input.billing,
    source: "workflow-sdk-world",
    run: {
      startedAt: isoString(run.startedAt),
      completedAt: isoString(run.completedAt),
      workflowCoreVersion:
        typeof runRecord?.workflowCoreVersion === "string"
          ? runRecord.workflowCoreVersion
          : undefined,
    },
    steps,
  })
}

export function fallbackWorkflowRunObservability(input: {
  events: readonly WorkflowRuntimeEvent[]
  billing: WorkflowRunBillingFacts
}): WorkflowRunObservabilityProjection {
  const startedAt = input.events[0]?.at
  const completedAt = input.events.findLast(
    (event) => event.type === "run.succeeded" || event.type === "run.failed"
  )?.at
  return buildWorkflowRunObservability({
    events: input.events,
    billing: input.billing,
    source: "muses-runtime-events",
    run: { startedAt, completedAt },
    steps: [],
  })
}

async function readAllWorkflowSteps(
  world: Awaited<ReturnType<typeof getWorld>>,
  runId: string
) {
  const steps: Awaited<ReturnType<(typeof world.steps)["list"]>>["data"] = []
  let cursor: string | undefined
  do {
    const page = await world.steps.list({
      runId,
      resolveData: "all",
      ...(cursor ? { pagination: { cursor } } : {}),
    })
    steps.push(...page.data)
    cursor = page.cursor || undefined
  } while (cursor)
  return steps
}

function buildWorkflowRunObservability(input: {
  events: readonly WorkflowRuntimeEvent[]
  billing: WorkflowRunBillingFacts
  source: WorkflowRunObservabilityProjection["source"]
  run: WorkflowRunObservabilityProjection["run"]
  steps: readonly HydratedBusinessStep[]
}): WorkflowRunObservabilityProjection {
  const stepByNodeId = new Map(
    input.steps.map((step) => [step.nodeId, step] as const)
  )
  const priceByNodeId = new Map(
    readNodePriceSnapshots(input.billing.pricingSnapshot).map((price) => [
      price.nodeId,
      price,
    ])
  )
  const nodes = new Map<
    string,
    {
      nodeId: string
      nodeKind: string
      startedAt?: string
      completedAt?: string
      status: WorkflowRunNodeObservability["status"]
      outputSummary: WorkflowRunValueSummary[]
      usage?: WorkflowRunNodeObservability["usage"]
      actualMicros: string
      attempt?: number
      error?: WorkflowRuntimeFailureProjection
    }
  >()

  for (const event of input.events) {
    if (event.type === "node.started") {
      nodes.set(event.nodeId, {
        nodeId: event.nodeId,
        nodeKind: event.nodeKind,
        startedAt: event.at,
        status: "running",
        outputSummary: [],
        actualMicros: "0",
      })
      continue
    }
    if (
      event.type === "node.attempt.started" ||
      event.type === "node.attempt.failed" ||
      event.type === "node.attempt.succeeded"
    ) {
      const node = nodes.get(event.nodeId)
      if (node) node.attempt = event.attempt
      continue
    }
    if (event.type === "node.waiting") {
      const node = nodes.get(event.nodeId)
      if (node) {
        node.status = "waiting"
        node.completedAt = event.at
      }
      continue
    }
    if (event.type === "node.succeeded") {
      const node = nodes.get(event.nodeId)
      if (node) {
        node.status = "succeeded"
        node.completedAt = event.at
        node.outputSummary = summarizeRuntimeValues(event.outputs)
        if (event.usage) {
          node.usage = summarizeUsage(event.usage)
          node.actualMicros = event.usage.creditMicros
        }
      }
      continue
    }
    if (event.type === "run.failed" && event.failure.nodeId) {
      const node = nodes.get(event.failure.nodeId)
      if (node) {
        node.status = "failed"
        node.completedAt = event.at
        node.error = event.failure
      }
    }
  }

  const projectedNodes = [...nodes.values()].map((node) => {
    const step = stepByNodeId.get(node.nodeId)
    const price = priceByNodeId.get(node.nodeId)
    const startedAt = step?.startedAt || node.startedAt
    const completedAt = step?.completedAt || node.completedAt
    const estimatedMicros = price?.unitCreditMicros
      ? (BigInt(price.unitCreditMicros) * BigInt(price.count || 1)).toString()
      : "0"
    return {
      nodeId: node.nodeId,
      nodeKind: node.nodeKind,
      status: node.status,
      attempt: step?.attempt || node.attempt,
      startedAt,
      completedAt,
      durationMs: durationMs(startedAt, completedAt),
      inputSummary: summarizeRuntimeValues(step?.inputs || {}),
      outputSummary: node.outputSummary,
      model: modelProjection(price, step),
      usage: node.usage,
      billing:
        price || node.actualMicros !== "0"
          ? {
              estimatedMicros,
              actualMicros: node.actualMicros,
              status: input.billing.reservationStatus || "not-required",
            }
          : undefined,
      error: node.error,
    } satisfies WorkflowRunNodeObservability
  })
  const usages = projectedNodes
    .map((node) => node.usage)
    .filter((usage): usage is NonNullable<typeof usage> => Boolean(usage))
  const tokenUsages = usages.filter((usage) => usage.tokenStatus === "reported")
  const imageCount = projectedNodes.reduce((total, node) => {
    if (node.nodeKind !== "image-generator") return total
    if (node.usage) return total + node.usage.imageCount
    return (
      total +
      node.outputSummary.reduce(
        (nodeTotal, value) =>
          value.valueType === "image" ? nodeTotal + value.count : nodeTotal,
        0
      )
    )
  }, 0)
  const runStartedAt = input.run.startedAt
  const runCompletedAt = input.run.completedAt

  return {
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    source: input.source,
    run: {
      ...input.run,
      durationMs: durationMs(runStartedAt, runCompletedAt),
    },
    nodes: projectedNodes,
    totals: {
      imageCount,
      tokenStatus: tokenUsages.length > 0 ? "reported" : "not-reported",
      inputTokens: sumOptional(tokenUsages, "inputTokens"),
      outputTokens: sumOptional(tokenUsages, "outputTokens"),
      totalTokens: sumOptional(tokenUsages, "totalTokens"),
      cacheReadTokens: sumOptional(tokenUsages, "cacheReadTokens"),
      cacheWriteTokens: sumOptional(tokenUsages, "cacheWriteTokens"),
      costUsd: sumOptional(tokenUsages, "costUsd"),
      estimatedMicros: input.billing.estimatedMicros || "0",
      actualMicros: input.billing.settledMicros || "0",
      billingStatus: input.billing.reservationStatus || "not-required",
    },
  }
}

function readBusinessStep(value: unknown): HydratedBusinessStep | null {
  const step = record(value)
  const hydratedInput = record(step?.input)
  const args = Array.isArray(hydratedInput?.args) ? hydratedInput.args : []
  const request = record(args[0])
  const node = record(request?.node)
  if (!node || typeof node.id !== "string" || typeof node.kind !== "string") {
    return null
  }
  return {
    nodeId: node.id,
    nodeKind: node.kind,
    modelRef: stringValue(record(node.config)?.modelRef),
    attempt: finiteNumber(step?.attempt),
    startedAt: isoString(step?.startedAt),
    completedAt: isoString(step?.completedAt),
    inputs: record(request?.inputs) || {},
  }
}

function summarizeRuntimeValues(
  values: Readonly<Record<string, unknown | WorkflowRuntimeValue>>
): WorkflowRunValueSummary[] {
  const summaries: WorkflowRunValueSummary[] = []
  for (const [portId, unknownValue] of Object.entries(values)) {
    const value = record(unknownValue)
    if (!value || typeof value.valueType !== "string") continue
    switch (value.valueType) {
      case "text": {
        if (typeof value.value !== "string") break
        summaries.push({
          portId,
          valueType: "text",
          value: value.value.slice(0, MAX_SUMMARY_TEXT_LENGTH),
          truncated: value.value.length > MAX_SUMMARY_TEXT_LENGTH,
        })
        break
      }
      case "number":
        if (typeof value.value === "number" && Number.isFinite(value.value)) {
          summaries.push({ portId, valueType: "number", value: value.value })
        }
        break
      case "boolean":
        if (typeof value.value === "boolean") {
          summaries.push({ portId, valueType: "boolean", value: value.value })
        }
        break
      case "image": {
        const assetIds = Array.isArray(value.assetIds)
          ? value.assetIds.filter((assetId) => typeof assetId === "string")
          : []
        summaries.push({ portId, valueType: "image", count: assetIds.length })
        break
      }
      case "design-document":
        if (
          typeof value.documentId === "string" &&
          typeof value.revision === "number"
        ) {
          summaries.push({
            portId,
            valueType: "design-document",
            documentId: value.documentId,
            revision: value.revision,
          })
        }
        break
    }
  }
  return summaries
}

function summarizeUsage(usage: {
  readonly imageCount: number
  readonly providerUsage?: unknown
  readonly agentRunId?: string
  readonly agentEventCount?: number
  readonly agentUsage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
    readonly costUsd: number
  }
}): WorkflowRunNodeObservability["usage"] {
  const providerUsage = record(usage.providerUsage) || record(usage.agentUsage)
  const inputTokens = finiteNumber(providerUsage?.inputTokens)
  const outputTokens = finiteNumber(providerUsage?.outputTokens)
  const totalTokens = finiteNumber(providerUsage?.totalTokens)
  const cacheReadTokens = finiteNumber(providerUsage?.cacheReadTokens)
  const cacheWriteTokens = finiteNumber(providerUsage?.cacheWriteTokens)
  const costUsd = finiteNumber(providerUsage?.costUsd)
  return {
    imageCount: usage.imageCount,
    tokenStatus:
      inputTokens === undefined &&
      outputTokens === undefined &&
      totalTokens === undefined
        ? "not-reported"
        : "reported",
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd,
    agentRunId: usage.agentRunId,
    agentEventCount: usage.agentEventCount,
  }
}

function modelProjection(
  price: NodePriceSnapshot | undefined,
  step: HydratedBusinessStep | undefined
): WorkflowRunNodeObservability["model"] {
  const stepModelRef = readStepModelRef(step)
  const modelRef = price?.modelRef || stepModelRef
  if (!modelRef) return undefined
  return {
    modelRef,
    capabilityProfile:
      price?.capabilityProfileId && price.capabilityProfileVersion
        ? {
            id: price.capabilityProfileId,
            version: price.capabilityProfileVersion,
          }
        : undefined,
    priceBook:
      price?.priceBookEntryId &&
      price.priceBookVersion &&
      price.unitCreditMicros
        ? {
            entryId: price.priceBookEntryId,
            version: price.priceBookVersion,
            unitCreditMicros: price.unitCreditMicros,
          }
        : undefined,
    requestedSize: price?.resolvedSize?.requested,
    resolvedSize: price?.resolvedSize
      ? {
          width: price.resolvedSize.width,
          height: price.resolvedSize.height,
          adjusted: Boolean(price.resolvedSize.adjusted),
        }
      : undefined,
  }
}

function readStepModelRef(step: HydratedBusinessStep | undefined) {
  return step?.modelRef
}

function readNodePriceSnapshots(value: unknown): NodePriceSnapshot[] {
  const snapshot = record(value)
  const candidates = Array.isArray(snapshot?.nodePrices)
    ? snapshot.nodePrices
    : []
  const prices: NodePriceSnapshot[] = []
  for (const candidate of candidates) {
    const price = record(candidate)
    if (
      !price ||
      typeof price.nodeId !== "string" ||
      typeof price.modelRef !== "string"
    ) {
      continue
    }
    const resolvedSize = record(price.resolvedSize)
    const requestedSize = record(resolvedSize?.requested)
    prices.push({
      nodeId: price.nodeId,
      modelRef: price.modelRef,
      capabilityProfileId: stringValue(price.capabilityProfileId),
      capabilityProfileVersion: stringValue(price.capabilityProfileVersion),
      priceBookEntryId: stringValue(price.priceBookEntryId),
      priceBookVersion: stringValue(price.priceBookVersion),
      unitCreditMicros: integerString(price.unitCreditMicros),
      count: finiteNumber(price.count),
      resolvedSize:
        resolvedSize &&
        finiteNumber(resolvedSize.width) !== undefined &&
        finiteNumber(resolvedSize.height) !== undefined
          ? {
              requested:
                requestedSize &&
                finiteNumber(requestedSize.width) !== undefined &&
                finiteNumber(requestedSize.height) !== undefined
                  ? {
                      width: finiteNumber(requestedSize.width)!,
                      height: finiteNumber(requestedSize.height)!,
                    }
                  : undefined,
              width: finiteNumber(resolvedSize.width)!,
              height: finiteNumber(resolvedSize.height)!,
              adjusted:
                typeof resolvedSize.adjusted === "boolean"
                  ? resolvedSize.adjusted
                  : undefined,
            }
          : undefined,
    })
  }
  return prices
}

function sumOptional(
  usages: readonly NonNullable<WorkflowRunNodeObservability["usage"]>[],
  key: "inputTokens" | "outputTokens" | "totalTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsd"
) {
  const values = usages
    .map((usage) => usage[key])
    .filter((value): value is number => value !== undefined)
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0)
    : undefined
}

function durationMs(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return undefined
  const started = new Date(startedAt).getTime()
  const completed = new Date(completedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return undefined
  return Math.max(0, completed - started)
}

function isoString(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function integerString(value: unknown) {
  if (typeof value === "string" && /^\d+$/.test(value)) return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  return undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
