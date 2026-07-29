import { randomUUID } from "node:crypto"
import { getWorld } from "workflow/runtime"

import {
  AgentRuntimeError,
  DefaultAgentPolicy,
  HeadlessAgentRuntime,
  type AgentModelPort,
  type AgentToolRegistryPort,
  type StartAgentRun,
} from "@muses/agent-core"

import { readAgentTrace } from "../lib/agent-trace"
import { PostgresAgentStateStore, authorizeAgentRun } from "../lib/agent-state-store"
import { MusesAgentToolRegistry } from "../lib/agent-tools"
import { getPgPool } from "../lib/database"
import { getGeneratedImageAsset } from "../lib/generated-asset-store"

const pool = getPgPool()
const fixtureId = randomUUID().replaceAll("-", "")
const fixtureRunId = `arun_isolation_${fixtureId}`
const foreignWorkspaceId = `mws_foreign_${fixtureId}`

async function main() {
  try {
    const evidence = await readEvidenceRun()
    const owned = await authorizeAgentRun(evidence.workspaceId, evidence.runId)
    assert(owned, "The trace evidence AgentRun was not authorized.")
    assert(
      !(await authorizeAgentRun(foreignWorkspaceId, evidence.runId)),
      "A foreign Workspace authorized the AgentRun."
    )

    const trace = await readAgentTrace({
      workspaceId: evidence.workspaceId,
      run: owned.snapshot,
      driverRunId: owned.driverRunId,
    })
    assert(trace.traceId === evidence.runId, "The trace root is not the AgentRun.")
    assert(trace.modelCalls.length > 0, "The trace has no model-call receipts.")
    assert(
      trace.agentEvents.some((event) => event.type === "model.completed"),
      "The trace has no Agent model completion event."
    )
    assert(trace.workflowRuns.length > 0, "The trace has no child WorkflowRun.")
    assert(trace.assets.length > 0, "The trace has no generated Asset.")
    assert(trace.reservations.length > 0, "The trace has no credit reservation.")
    assert(trace.ledgerEntries.length > 0, "The trace has no credit ledger facts.")
    assert(trace.toolCommands.length > 0, "The trace has no Operation Gateway command.")
    assert(
      trace.workflowWorld.every(({ state }) => state === "available"),
      "Workflow SDK World facts were unavailable."
    )
    assert(
      trace.workflowWorld.some(
        (item) =>
          item.state === "available" &&
          item.steps.length > 0 &&
          item.events.some((event) => Boolean(event.correlationId))
      ),
      "Workflow SDK step/correlation facts are disconnected."
    )
    assertSafeProjection(trace)

    const asset = trace.assets[0]!
    assert(
      !(await getGeneratedImageAsset({
        workspaceId: foreignWorkspaceId,
        workflowRunId: asset.workflowRunId,
        assetId: asset.assetId,
      })),
      "A foreign Workspace read the generated Asset."
    )

    const inspected = await new MusesAgentToolRegistry().execute(
      {
        id: `tool_scope_${fixtureId}`,
        name: "canvas.inspect",
        input: { workspaceId: foreignWorkspaceId },
      },
      {
        workspaceId: evidence.workspaceId,
        projectId: owned.snapshot.session.projectId,
        canvasId: owned.snapshot.session.canvasId,
        sessionId: owned.snapshot.session.sessionId,
        runId: owned.snapshot.runId,
        permissions: ["canvas.read"],
        metadata: {
          initiatedByUserId: evidence.userId,
        },
        idempotencyKey: `scope:${fixtureId}`,
      }
    )
    const inspectedOutput = record(inspected.output)
    assert(inspected.ok, "The scoped canvas inspection failed.")
    assert(
      inspectedOutput?.workspaceId === evidence.workspaceId,
      "Tool input changed the verified Workspace scope."
    )

    await verifyTamperedSnapshotFailsClosed(evidence)

    console.log(
      JSON.stringify({
        passed: true,
        traceId: trace.traceId,
        agentEvents: trace.agentEvents.length,
        modelCalls: trace.modelCalls.length,
        toolCommands: trace.toolCommands.length,
        workflowRuns: trace.workflowRuns.length,
        workflowWorldRuns: trace.workflowWorld.length,
        workflowSteps: trace.workflowWorld.reduce(
          (count, item) =>
            count + (item.state === "available" ? item.steps.length : 0),
          0
        ),
        workflowEvents: trace.workflowWorld.reduce(
          (count, item) =>
            count + (item.state === "available" ? item.events.length : 0),
          0
        ),
        assets: trace.assets.length,
        reservations: trace.reservations.length,
        ledgerEntries: trace.ledgerEntries.length,
        crossWorkspaceRun: "denied",
        crossWorkspaceAsset: "denied",
        toolScopeOverride: "denied",
        tamperedSnapshot: "failed-closed",
        sensitiveFields: "absent",
      })
    )
  } finally {
    await pool
      .query("delete from muses_agent_run where id = $1", [fixtureRunId])
      .catch(() => undefined)
    await pool.end()
    await (await getWorld()).close?.()
  }
}

async function readEvidenceRun() {
  const row = (
    await pool.query<{
      runId: string
      workspaceId: string
      userId: string
    }>(`
      select agent.id as "runId", agent.workspace_id as "workspaceId",
             workspace.created_by_user_id as "userId"
      from muses_agent_run agent
      join muses_workspace workspace on workspace.id = agent.workspace_id
      where exists (
        select 1 from muses_agent_model_call model where model.run_id = agent.id
      )
        and exists (
          select 1
          from muses_workflow_run child
          join muses_generated_asset asset
            on asset.workspace_id = child.workspace_id
           and asset.workflow_run_id = child.sdk_run_id
          where child.workspace_id = agent.workspace_id
            and child.caller_kind = 'agent'
            and child.caller_id = agent.id
        )
        and exists (
          select 1 from muses_operation_command_receipt command
          where command.workspace_id = agent.workspace_id
            and command.actor_kind = 'agent'
            and command.actor_id = agent.id
        )
      order by agent.created_at desc
      limit 1
    `)
  ).rows[0]
  if (!row) {
    throw new Error(
      "A completed real Agent image run is required for trace evidence."
    )
  }
  return row
}

async function verifyTamperedSnapshotFailsClosed(
  evidence: Awaited<ReturnType<typeof readEvidenceRun>>
) {
  const target = (
    await pool.query<{ projectId: string; canvasId: string | null }>(
      `
        select project.id as "projectId", canvas.id as "canvasId"
        from muses_project project
        left join muses_creative_canvas canvas
          on canvas.workspace_id = project.workspace_id
         and canvas.project_id = project.id
        where project.workspace_id = $1
        order by project.created_at
        limit 1
      `,
      [evidence.workspaceId]
    )
  ).rows[0]
  if (!target) throw new Error("The trace Workspace has no project.")
  const store = new PostgresAgentStateStore({ pool })
  const runtime = new HeadlessAgentRuntime({
    model: new FixtureModel(),
    tools: new NoTools(),
    policy: new DefaultAgentPolicy(),
    store,
  })
  const input: StartAgentRun = {
    runId: fixtureRunId,
    session: {
      sessionId: `asession_isolation_${fixtureId}`,
      workspaceId: evidence.workspaceId,
      projectId: target.projectId,
      ...(target.canvasId ? { canvasId: target.canvasId } : {}),
    },
    profile: {
      profileId: "a9-isolation-fixture",
      version: "1.0.0",
      modelRef: "fixture/no-provider",
      instructions: "No external execution.",
      toolNames: [],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    input: "Create an isolated fixture.",
    budget: {
      maxTurns: 1,
      maxModelCalls: 1,
      maxToolCalls: 1,
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxCreditMicros: "0",
      maxDurationMs: 60_000,
    },
    permissions: ["canvas.read"],
    metadata: { initiatedByUserId: evidence.userId },
  }
  await runtime.start(input)
  await pool.query(
    `
      update muses_agent_run
      set snapshot = jsonb_set(
        snapshot,
        '{extensions,logicalSandbox,scope,workspaceId}',
        to_jsonb($2::text)
      )
      where id = $1
    `,
    [fixtureRunId, foreignWorkspaceId]
  )
  let failedClosed = false
  try {
    await runtime.inspect(fixtureRunId)
  } catch (error) {
    failedClosed =
      error instanceof AgentRuntimeError &&
      error.code === "extension-snapshot-invalid"
  }
  assert(failedClosed, "A tampered extension snapshot remained executable.")
}

function assertSafeProjection(value: unknown) {
  const forbiddenKeys = new Set([
    "prompt",
    "content",
    "input",
    "output",
    "result",
    "objectKey",
    "authRef",
    "credentialRefs",
    "initiatedByEmail",
    "providerRequestId",
    "requestFingerprint",
    "instructions",
  ])
  for (const key of collectKeys(value)) {
    assert(!forbiddenKeys.has(key), `Trace leaked forbidden field "${key}".`)
  }
}

function collectKeys(value: unknown, keys: string[] = []) {
  if (!value || typeof value !== "object") return keys
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  for (const [key, item] of Object.entries(value)) {
    keys.push(key)
    collectKeys(item, keys)
  }
  return keys
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

class FixtureModel implements AgentModelPort {
  estimate() {
    return { inputTokens: 0, outputTokens: 0, creditMicros: "0" }
  }

  async complete() {
    return {
      content: "unused",
      finishReason: "stop" as const,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, creditMicros: "0" },
    }
  }
}

class NoTools implements AgentToolRegistryPort {
  async list() {
    return []
  }

  async execute(): Promise<never> {
    throw new Error("No tool execution is allowed in this fixture.")
  }
}

await main()
process.exit(0)
