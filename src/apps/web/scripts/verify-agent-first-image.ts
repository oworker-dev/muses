import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import type {
  AgentEvent,
  AgentRunSnapshot,
} from "@muses/agent-contracts/agent-run"

import { getPgPool } from "../lib/database"
import { createMusesAgentHostClient } from "../lib/muses-agent-host"
import { getOrCreateOperationGatewaySnapshot } from "../lib/operation-gateway-store"

const userId = required("MUSES_E2E_USER_ID")
const workspaceId = required("MUSES_E2E_WORKSPACE_ID")
const projectId = required("MUSES_E2E_PROJECT_ID")
const canvasId = required("MUSES_E2E_CANVAS_ID")

const client = createMusesAgentHostClient({
  userId,
  workspaceId,
  projectId,
  canvasId,
  actorType: "service",
})
const idempotencyKey = `muses-agent-first-image:${Date.now()}:${randomUUID()}`
const request = {
  idempotencyKey,
  message:
    "MUSES_IMAGE_E2E: Generate one real image from my request, place it on the current canvas, verify the placement, and report the result.",
  profile: { profileId: "muses-platform", version: "0.1.0" },
  policy: {
    hostCapabilities: ["canvas.inspect", "image.generate"],
    limits: {
      maxTurns: 1,
      maxModelCalls: 8,
      maxToolCalls: 8,
      maxInputTokens: 100_000,
      maxOutputTokens: 10_000,
      maxDurationMs: 360_000,
    },
  },
  metadata: { verification: "muses-agent-first-image-e2e" },
} as const

try {
  const before = await creditAccount()
  const started = await client.start(request)
  const replay = await client.start(request)
  assert.equal(replay.disposition, "replayed")
  assert.equal(replay.run.runId, started.run.runId)

  const run = await poll(started.run.runId)
  assert.equal(
    run.status,
    "completed",
    `AgentRun ended as ${run.status}: ${run.failure?.message || "unknown failure"}`
  )
  assert.equal(run.result?.kind, "text")
  assert.match(run.result.value, /MUSES_IMAGE_E2E_COMPLETED/)
  assert.ok(run.usage.inputTokens > 0)
  assert.ok(run.usage.outputTokens > 0)
  assert.ok(run.usage.steps > 0)

  const eventPayload = await client.events(run.runId)
  const outputs = completedHostOutputs(eventPayload.events)
  const imageResult = outputs.find(
    (output) => output.capability === "image.generate"
  )
  assert.ok(imageResult, "Agent events do not contain image.generate output.")
  const imageOutput = record(imageResult.output)
  const assets = array(imageOutput.assets).map(record)
  assert.equal(assets.length, 1)
  const asset = assets[0]
  const assetId = string(asset.id, "Generated Asset id is missing.")
  const assetUrl = string(asset.url, "Generated Asset URL is missing.")
  const workflowRunId = string(
    imageOutput.workflowRunId,
    "Image Workflow run id is missing."
  )
  assert.match(assetId, /^image_[a-f0-9]{24}$/)
  assert.match(workflowRunId, /^wrun_[A-Za-z0-9_-]+$/)

  const canvasResult = outputs
    .filter((output) => output.capability === "canvas.inspect")
    .at(-1)
  assert.ok(
    canvasResult,
    "Agent events do not contain the final canvas inspection."
  )
  assert.ok(
    canvasItems(canvasResult.output).some(
      (item) => item.kind === "asset" && item.refId === assetId
    ),
    "The final Agent canvas inspection does not contain the generated Asset."
  )

  const response = await fetch(assetUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  })
  assert.equal(
    response.ok,
    true,
    `Generated image returned HTTP ${response.status}.`
  )
  assert.match(response.headers.get("content-type") || "", /^image\//)
  assert.ok((await response.arrayBuffer()).byteLength > 0)

  const persisted = await persistedImageEvidence(assetId, workflowRunId)
  assert.equal(persisted.projectId, projectId)
  assert.equal(persisted.callerKind, "agent")
  assert.equal(persisted.callerId, run.runId)
  assert.equal(persisted.runStatus, "completed")
  assert.equal(persisted.reservationStatus, "settled")
  assert.ok(BigInt(persisted.settledMicros) > BigInt(0))
  assert.ok(BigInt(persisted.byteSize) > BigInt(0))
  assert.equal(persisted.ledgerKind, "settle")
  assert.equal(
    BigInt(persisted.balanceDeltaMicros),
    -BigInt(persisted.settledMicros)
  )

  const refreshed = await getOrCreateOperationGatewaySnapshot({
    workspaceId,
    projectId,
    userId,
  })
  assert.equal(refreshed.creativeCanvas.canvasId, canvasId)
  assert.ok(
    refreshed.creativeCanvas.items.some(
      (item) => item.kind === "asset" && item.refId === assetId
    ),
    "A fresh authoritative canvas read lost the generated Asset."
  )

  const after = await creditAccount()
  assert.equal(after.reservedMicros, "0")
  assert.ok(BigInt(after.postedMicros) < BigInt(before.postedMicros))

  console.log(
    JSON.stringify({
      ok: true,
      agentRunId: run.runId,
      workflowRunId,
      assetId,
      canvasId,
      eventCount: eventPayload.nextCursor,
      imageBytes: persisted.byteSize,
      chargedMicros: persisted.settledMicros,
      usage: run.usage,
    })
  )
} finally {
  await getPgPool().end()
}

async function poll(runId: string): Promise<AgentRunSnapshot> {
  const deadline = Date.now() + 7 * 60_000
  while (Date.now() < deadline) {
    const run = await client.inspect(runId)
    if (["completed", "failed", "cancelled"].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("AgentRun did not settle within seven minutes.")
}

function completedHostOutputs(events: readonly AgentEvent[]) {
  return events
    .filter(
      (event) =>
        event.type === "tool.completed" &&
        record(event.data).status === "completed"
    )
    .map((event) => record(record(record(event.data).result).output))
    .filter((output) => typeof output.capability === "string")
}

function canvasItems(value: unknown) {
  const output = record(value)
  return array(record(output.canvas).items).map(record)
}

async function creditAccount() {
  const result = await getPgPool().query<{
    postedMicros: string
    reservedMicros: string
  }>(
    `
      select
        posted_balance_micros::text as "postedMicros",
        reserved_balance_micros::text as "reservedMicros"
      from credit_account
      where workspace_id = $1
    `,
    [workspaceId]
  )
  assert.ok(result.rows[0], "Workspace credit account was not found.")
  return result.rows[0]
}

async function persistedImageEvidence(assetId: string, workflowRunId: string) {
  const result = await getPgPool().query<{
    balanceDeltaMicros: string
    byteSize: string
    callerId: string | null
    callerKind: string | null
    ledgerKind: string | null
    projectId: string
    reservationStatus: string | null
    runStatus: string
    settledMicros: string | null
  }>(
    `
      select
        asset.project_id as "projectId",
        asset.byte_size::text as "byteSize",
        run.caller_kind as "callerKind",
        run.caller_id as "callerId",
        run.status as "runStatus",
        reservation.status as "reservationStatus",
        reservation.settled_micros::text as "settledMicros",
        ledger.kind as "ledgerKind",
        ledger.balance_delta_micros::text as "balanceDeltaMicros"
      from muses_generated_asset asset
      join muses_workflow_run run
        on run.workspace_id = asset.workspace_id
       and run.sdk_run_id = asset.workflow_run_id
      left join credit_reservation reservation on reservation.id = run.reservation_id
      left join credit_ledger_entry ledger
        on ledger.reservation_id = reservation.id
       and ledger.kind = 'settle'
      where asset.workspace_id = $1
        and asset.id = $2
        and asset.workflow_run_id = $3
      limit 1
    `,
    [workspaceId, assetId, workflowRunId]
  )
  const row = result.rows[0]
  assert.ok(row, "Generated Asset persistence evidence was not found.")
  assert.ok(row.settledMicros, "Image credit reservation was not settled.")
  assert.ok(
    row.balanceDeltaMicros,
    "Image credit settlement ledger is missing."
  )
  return row as typeof row & {
    balanceDeltaMicros: string
    settledMicros: string
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message)
  return value
}

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}
