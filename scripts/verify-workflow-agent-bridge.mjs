/**
 * Production-topology smoke test for Muses Workflow -> standalone muses-agent.
 *
 * Required environment:
 *   MUSES_BASE_URL, MUSES_SESSION_COOKIE, MUSES_WORKSPACE_ID,
 *   MUSES_PROJECT_ID, MUSES_DEPLOYMENT_ID
 */
const baseUrl = required("MUSES_BASE_URL").replace(/\/$/, "")
const sessionCookie = required("MUSES_SESSION_COOKIE")
const workspaceId = required("MUSES_WORKSPACE_ID")
const projectId = required("MUSES_PROJECT_ID")
const deploymentId = required("MUSES_DEPLOYMENT_ID")
const message = process.env.MUSES_AGENT_BRIDGE_MESSAGE?.trim() || "Return the word BRIDGE_READY."
const cancelMessage = process.env.MUSES_AGENT_BRIDGE_CANCEL_MESSAGE?.trim()
  || "SLOW Keep this turn active until it is cancelled."
const idempotencyKey = `workflow-agent-bridge:${Date.now()}`

const request = {
  workspaceId,
  target: { kind: "deployment", workspaceId, deploymentId },
  inputs: { message: { valueType: "text", value: message } },
  idempotencyKey,
}

const started = await jsonRequest("POST", "/api/studio/workflow-runs", request, 202)
assert(started.accepted === true && typeof started.runId === "string", "Workflow did not return a run id.")

const replay = await jsonRequest("POST", "/api/studio/workflow-runs", request, 202)
assert(replay.idempotentReplay === true, "Workflow idempotency replay was not reported.")
assert(replay.runId === started.runId, "Workflow replay returned a different run id.")

const completed = await pollRun(started.runId)
assert(completed.status === "completed", `Workflow ended as ${completed.status}: ${failureMessage(completed)}`)
const result = completed.result?.outputs?.result
assert(result?.valueType === "text" && typeof result.value === "string", "Agent output was not projected to the End node.")
assert(result.value.length > 0, "Agent output was empty.")
assert(completed.events.some((event) => event.type === "node.succeeded" && event.nodeId === "agent-run-1"), "The agent.run node did not succeed.")

const agentNode = completed.observability?.nodes?.find((node) => node.nodeId === "agent-run-1")
assert(typeof agentNode?.usage?.agentRunId === "string", "AgentRun correlation was not projected into Workflow observability.")
assertUsageProjection(completed, agentNode)

const cancellation = await verifyCancellation()

console.log(JSON.stringify({
  agentRunId: agentNode.usage.agentRunId,
  agentEventCount: agentNode.usage.agentEventCount,
  agentUsage: {
    inputTokens: agentNode.usage.inputTokens,
    outputTokens: agentNode.usage.outputTokens,
    cacheReadTokens: agentNode.usage.cacheReadTokens,
    cacheWriteTokens: agentNode.usage.cacheWriteTokens,
    costUsd: agentNode.usage.costUsd,
  },
  idempotency: replay.idempotentReplay,
  cancellation,
  result: result.value,
  runId: started.runId,
  status: completed.status,
}))

async function verifyCancellation() {
  const cancellationKey = `workflow-agent-bridge-cancel:${Date.now()}`
  const cancellationRequest = {
    ...request,
    idempotencyKey: cancellationKey,
    inputs: { message: { valueType: "text", value: cancelMessage } },
  }
  const started = await jsonRequest("POST", "/api/studio/workflow-runs", cancellationRequest, 202)
  const active = await pollRunUntil(
    started.runId,
    (projection) => projection.events?.some((event) => event.type === "node.agent.started"),
    "publish node.agent.started",
  )
  const agentStarted = active.events.find((event) => event.type === "node.agent.started")
  assert(typeof agentStarted?.agentRunId === "string", "Cancellation run did not expose its AgentRun id.")

  const cancelBody = {
    workspaceId,
    runId: started.runId,
    idempotencyKey: `cancel:${cancellationKey}`,
    reason: "Workflow-Agent bridge cancellation conformance test.",
  }
  const accepted = await jsonRequest("DELETE", "/api/studio/workflow-runs", cancelBody, 202)
  assert(accepted.accepted === true && accepted.idempotentReplay === false, "Workflow cancellation was not accepted.")
  const replayed = await jsonRequest("DELETE", "/api/studio/workflow-runs", cancelBody, 202)
  assert(replayed.idempotentReplay === true, "Workflow cancellation idempotency replay was not reported.")

  const cancelledWorkflow = await pollRun(started.runId)
  assert(cancelledWorkflow.status === "cancelled", `Cancelled Workflow ended as ${cancelledWorkflow.status}.`)

  const host = await jsonRequest(
    "GET",
    `/api/studio/agent-host-token?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}`,
    undefined,
    200,
  )
  assert(typeof host.serviceUrl === "string" && typeof host.accessToken === "string", "Agent Host token was not issued.")
  const cancelledAgent = await pollAgentRun(host.serviceUrl, host.accessToken, agentStarted.agentRunId)
  assert(cancelledAgent.status === "cancelled", `Cancelled AgentRun ended as ${cancelledAgent.status}.`)
  return {
    agentRunId: agentStarted.agentRunId,
    agentStatus: cancelledAgent.status,
    idempotency: replayed.idempotentReplay,
    runId: started.runId,
    workflowStatus: cancelledWorkflow.status,
  }
}

function assertUsageProjection(completed, agentNode) {
  const usage = agentNode?.usage
  const totals = completed.observability?.totals
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "costUsd"]) {
    assert(typeof usage?.[key] === "number" && usage[key] >= 0, `Agent usage ${key} was not reported.`)
    assert(totals?.[key] === usage[key], `Workflow total ${key} does not match the Agent node.`)
  }
  assert(usage.inputTokens > 0, "Agent input token usage was empty.")
  assert(usage.outputTokens > 0, "Agent output token usage was empty.")
  assert(totals.tokenStatus === "reported", "Workflow token totals were marked as not reported.")
}

async function pollRun(runId) {
  return pollRunUntil(
    runId,
    (projection) => ["completed", "failed", "cancelled"].includes(projection.status),
    "settle",
  )
}

async function pollRunUntil(runId, predicate, expected) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const projection = await jsonRequest(
      "GET",
      `/api/studio/workflow-runs?workspaceId=${encodeURIComponent(workspaceId)}&runId=${encodeURIComponent(runId)}`,
      undefined,
      200,
    )
    if (predicate(projection)) return projection
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Workflow ${runId} did not ${expected} within 120 seconds.`)
}

async function pollAgentRun(serviceUrl, accessToken, runId) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/api/agent/runs/${encodeURIComponent(runId)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: "error",
    })
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) throw new Error(`AgentRun inspection returned ${response.status}: ${payload?.message || "unknown error"}`)
    if (["completed", "failed", "cancelled"].includes(payload.run?.status)) return payload.run
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`AgentRun ${runId} did not settle within 60 seconds.`)
}

async function jsonRequest(method, path, body, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie: sessionCookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => undefined)
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path} returned ${response.status}, expected ${expectedStatus}: ${payload?.message || payload?.error || "unknown error"}`)
  }
  return payload
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function failureMessage(projection) {
  return projection.failure?.message || projection.result?.failure?.message || "no failure detail"
}
