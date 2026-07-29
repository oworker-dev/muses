import { randomUUID } from "node:crypto"

import {
  DEFAULT_AGENT_CONTEXT_HISTORY_CHARACTERS,
  DefaultAgentPolicy,
  HeadlessAgentRuntime,
  type AgentMessage,
  type AgentModelPort,
  type AgentToolRegistryPort,
  type StartAgentRun,
} from "@muses/agent-core"

import { getPgPool } from "@/lib/database"
import { PostgresAgentStateStore } from "@/lib/agent-state-store"

const pool = getPgPool()
const runId = `arun_${randomUUID().replaceAll("-", "")}`

async function main() {
  try {
    const target = (
      await pool.query<{
        workspaceId: string
        projectId: string
        canvasId: string | null
      }>(`
      select
        project.workspace_id as "workspaceId",
        project.id as "projectId",
        canvas.id as "canvasId"
      from muses_project project
      left join muses_creative_canvas canvas
        on canvas.workspace_id = project.workspace_id
       and canvas.project_id = project.id
      order by project.created_at
      limit 1
    `)
    ).rows[0]
    if (!target)
      throw new Error("A Muses project is required for this fixture.")

    const store = new PostgresAgentStateStore({ pool })
    const initialModel = new DeterministicModel()
    const runtime = createRuntime(store, initialModel)
    const input = startInput(target)
    await runtime.start(input)
    await runtime.resume(runId)
    for (let index = 1; index < 14; index += 1) {
      await runtime.followUp(runId, {
        id: `amsg_fixture_${index}`,
        role: "user",
        content: `Sanitized revision request ${index}.`,
        createdAt: new Date(Date.now() + index * 1000).toISOString(),
      })
      await runtime.resume(runId)
    }

    const compacted = await runtime.inspect(runId)
    if (!compacted.context.summary) {
      throw new Error("The long session did not create a context summary.")
    }
    const authorities = {
      plan: compacted.plan,
      permissions: compacted.permissions,
      budget: compacted.budget,
    }

    const recoveredModel = new DeterministicModel()
    const recoveredRuntime = createRuntime(store, recoveredModel)
    await recoveredRuntime.followUp(runId, {
      id: "amsg_fixture_recovered",
      role: "user",
      content: "Confirm the sanitized retained facts.",
      createdAt: new Date(Date.now() + 20_000).toISOString(),
    })
    await recoveredRuntime.resume(runId)
    const recovered = await recoveredRuntime.inspect(runId)
    const events = await store.readEvents(runId)
    const compactionEvents = events.filter(
      ({ type }) => type === "context.compacted"
    )
    const summaryMessage = recoveredModel.seenMessages[0]?.[0]
    if (
      summaryMessage?.metadata?.kind !== "context-summary" ||
      !summaryMessage.content.includes("Muses context summary")
    ) {
      throw new Error("The recovered model input did not receive the summary.")
    }
    if (
      JSON.stringify(recovered.plan) !== JSON.stringify(authorities.plan) ||
      JSON.stringify(recovered.permissions) !==
        JSON.stringify(authorities.permissions) ||
      recovered.budget.usage.toolCalls !== authorities.budget.usage.toolCalls ||
      recovered.budget.usage.creditMicros !==
        authorities.budget.usage.creditMicros
    ) {
      throw new Error("An authoritative Agent fact drifted after recovery.")
    }
    const history = recovered.context.summary?.facts.find(
      ({ kind, key }) => kind === "message" && key === "history"
    )
    if (
      recovered.context.summary?.version !== 1 ||
      recovered.context.summary.sourceMessageCount !== 26 ||
      recovered.context.messages.length !== 21 ||
      compactionEvents.length !== 1 ||
      !history ||
      history.value.length > DEFAULT_AGENT_CONTEXT_HISTORY_CHARACTERS
    ) {
      throw new Error(
        `Context compaction watermarks or bounds drifted: ${JSON.stringify({
          summaryVersion: recovered.context.summary?.version,
          sourceMessageCount: recovered.context.summary?.sourceMessageCount,
          retainedMessageCount: recovered.context.messages.length,
          compactionEvents: compactionEvents.length,
          historyCharacters: history?.value.length,
        })}`
      )
    }

    console.log(
      JSON.stringify({
        passed: true,
        summaryVersion: recovered.context.summary?.version,
        sourceMessageCount: recovered.context.summary?.sourceMessageCount,
        retainedMessageCount: recovered.context.messages.length,
        compactionEvents: compactionEvents.length,
        historyCharacters: history.value.length,
        modelCalls: recovered.budget.usage.modelCalls,
        toolCalls: recovered.budget.usage.toolCalls,
        creditMicros: recovered.budget.usage.creditMicros,
      })
    )
  } finally {
    await pool
      .query("delete from muses_agent_run where id = $1", [runId])
      .catch(() => undefined)
    await pool.end()
  }
}

function createRuntime(
  store: PostgresAgentStateStore,
  model: DeterministicModel
) {
  return new HeadlessAgentRuntime({
    model,
    tools: new NoTools(),
    policy: new DefaultAgentPolicy(),
    store,
  })
}

function startInput(target: {
  workspaceId: string
  projectId: string
  canvasId: string | null
}): StartAgentRun {
  return {
    runId,
    session: {
      sessionId: `asession_${runId.slice("arun_".length)}`,
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      ...(target.canvasId ? { canvasId: target.canvasId } : {}),
    },
    profile: {
      profileId: "a9-context-fixture",
      version: "1.0.0",
      modelRef: "fixture/deterministic",
      instructions: "Use only persisted sanitized context facts.",
      toolNames: [],
      skillRefs: [],
      mcpConnectionRefs: [],
    },
    input: "Start the sanitized context compaction fixture.",
    budget: {
      maxTurns: 32,
      maxModelCalls: 32,
      maxToolCalls: 1,
      maxInputTokens: 10_000,
      maxOutputTokens: 10_000,
      maxCreditMicros: "0",
      maxDurationMs: 60_000,
    },
    permissions: ["canvas.read"],
    plan: {
      goal: "Verify context compaction without external side effects.",
      steps: [
        {
          id: "compact-and-recover",
          title: "Compact and recover",
          status: "completed",
          dependsOn: [],
          evidenceRefs: [],
        },
      ],
    },
    metadata: { fixture: "a9-context-compaction" },
  }
}

class DeterministicModel implements AgentModelPort {
  readonly seenMessages: Array<readonly AgentMessage[]> = []

  async complete(input: Parameters<AgentModelPort["complete"]>[0]) {
    this.seenMessages.push(structuredClone(input.messages))
    return {
      content: "Sanitized deterministic result.",
      finishReason: "stop" as const,
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, creditMicros: "0" },
    }
  }
}

class NoTools implements AgentToolRegistryPort {
  async list() {
    return []
  }

  async execute(): Promise<never> {
    throw new Error("The context fixture must not execute tools.")
  }
}

await main()
