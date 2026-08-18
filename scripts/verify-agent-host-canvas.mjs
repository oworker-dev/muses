/**
 * Production-topology smoke test for standalone Open Agent -> Muses canvas.
 *
 * Required environment:
 *   MUSES_BASE_URL, MUSES_SESSION_COOKIE, MUSES_WORKSPACE_ID,
 *   MUSES_PROJECT_ID, MUSES_CANVAS_ID, MUSES_CANVAS_E2E_REF_ID
 *
 * Run only against a dedicated E2E Project. The marker item is intentionally
 * retained so the authoritative canvas mutation can be inspected afterwards.
 */
const baseUrl = required("MUSES_BASE_URL").replace(/\/$/, "");
const sessionCookie = required("MUSES_SESSION_COOKIE");
const workspaceId = required("MUSES_WORKSPACE_ID");
const projectId = required("MUSES_PROJECT_ID");
const canvasId = required("MUSES_CANVAS_ID");
const markerRefId = required("MUSES_CANVAS_E2E_REF_ID");
const markerTitle = "MUSES HOST CANVAS READY";
const idempotencyKey = `muses-host-canvas:${markerRefId}`;

const initial = await musesJson(
  "GET",
  `/api/studio/operation-gateway?workspaceId=${encodeURIComponent(workspaceId)}`,
  undefined,
  200,
);
assert(
  initial.project?.id === projectId,
  "The E2E Project does not match the authorized Muses Project.",
);
assert(
  initial.creativeCanvas?.canvasId === canvasId,
  "The E2E Canvas does not match the authorized Muses Canvas.",
);
const initialRevision = initial.creativeCanvas.revision;

const host = await musesJson(
  "GET",
  `/api/studio/agent-host-token?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}&canvasId=${encodeURIComponent(canvasId)}`,
  undefined,
  200,
);
assert(
  typeof host.serviceUrl === "string" && host.serviceUrl.length > 0,
  "The Host token did not publish an Agent service URL.",
);
assert(
  typeof host.accessToken === "string" && host.accessToken.length > 0,
  "The Host token was not issued.",
);

const startRequest = {
  idempotencyKey,
  message: [
    "Use canvas.inspect before making a change.",
    `Then call canvas.item.put exactly once with refId ${JSON.stringify(markerRefId)}, kind \"artifact\", title ${JSON.stringify(markerTitle)}, x 1440, y 160, width 320, and height 180.`,
    "Inspect the canvas again and finish only after the item is visible.",
    "Return exactly MUSES_HOST_CANVAS_READY.",
  ].join(" "),
  profile: { profileId: "muses-platform", version: "0.1.0" },
  policy: {
    hostCapabilities: ["canvas.inspect", "canvas.item.put"],
    limits: {
      maxDurationMs: 180_000,
      maxInputTokens: 80_000,
      maxModelCalls: 8,
      maxOutputTokens: 4_096,
      maxToolCalls: 8,
      maxTurns: 8,
    },
  },
  metadata: { e2e: "muses-host-canvas", canvasId, projectId },
};

const started = await agentJson(
  host,
  "POST",
  "/api/agent/runs",
  startRequest,
  [200, 202],
);
assert(
  started.disposition === "started" || started.disposition === "replayed",
  "The AgentRun was not accepted.",
);
assert(
  typeof started.run?.runId === "string",
  "The Agent service did not return a run id.",
);
const replay = await agentJson(
  host,
  "POST",
  "/api/agent/runs",
  startRequest,
  200,
);
assert(
  replay.disposition === "replayed",
  "The AgentRun idempotency replay was not reported.",
);
assert(
  replay.run?.runId === started.run.runId,
  "The AgentRun replay returned a different run id.",
);

const completed = await pollAgentRun(host, started.run.runId);
assert(
  completed.status === "completed",
  `The AgentRun ended as ${completed.status}: ${completed.failure?.message || "no failure detail"}`,
);
assert(completed.result?.kind === "text", "The AgentRun did not return text.");
assert(
  String(completed.result.value).includes("MUSES_HOST_CANVAS_READY"),
  "The AgentRun did not confirm the canvas mutation.",
);

const final = await pollCanvasItem();
assert(
  final.creativeCanvas.revision > initialRevision,
  "The authoritative canvas revision did not advance.",
);

console.log(
  JSON.stringify({
    agentRunId: completed.runId,
    canvasId,
    finalRevision: final.creativeCanvas.revision,
    idempotency: replay.disposition,
    markerRefId,
    projectId,
    status: completed.status,
    usage: completed.usage,
    workspaceId,
  }),
);

async function pollAgentRun(hostConfig, runId) {
  const deadline = Date.now() + 180_000;
  let cursor = 0;
  const answered = new Set();
  while (Date.now() < deadline) {
    const payload = await agentJson(
      hostConfig,
      "GET",
      `/api/agent/runs/${encodeURIComponent(runId)}`,
      undefined,
      200,
    );
    const events = await agentJson(
      hostConfig,
      "GET",
      `/api/agent/runs/${encodeURIComponent(runId)}/events?after=${encodeURIComponent(String(cursor))}`,
      undefined,
      200,
    );
    cursor = events.nextCursor;
    for (const event of events.events ?? []) {
      if (event.type !== "input.requested") continue;
      const requests = Array.isArray(event.data?.requests) ? event.data.requests : [];
      const responses = requests
        .filter((request) => request?.kind === "tool-approval")
        .filter((request) => typeof request?.requestId === "string")
        .filter((request) => !answered.has(request.requestId))
        .map((request) => ({ requestId: request.requestId, optionId: "approve" }));
      if (responses.length === 0) continue;
      const responseKey = `muses-host-canvas-input:${runId}:${responses.map((response) => response.requestId).sort().join(",")}`;
      const accepted = await agentJson(
        hostConfig,
        "POST",
        `/api/agent/runs/${encodeURIComponent(runId)}/input`,
        { idempotencyKey: responseKey, inputResponses: responses },
        [200, 202],
      );
      assert(
        accepted.disposition === "accepted" || accepted.disposition === "replayed",
        "The AgentRun input response was not accepted.",
      );
      for (const response of responses) answered.add(response.requestId);
    }
    if (["completed", "failed", "cancelled"].includes(events.run?.status)) {
      return events.run;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`AgentRun ${runId} did not settle within 180 seconds.`);
}

async function pollCanvasItem() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await musesJson(
      "GET",
      `/api/studio/operation-gateway?workspaceId=${encodeURIComponent(workspaceId)}`,
      undefined,
      200,
    );
    const marker = snapshot.creativeCanvas?.items?.find(
      (item) => item.refId === markerRefId && item.title === markerTitle,
    );
    if (marker) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "The AgentRun completed without the expected authoritative canvas item.",
  );
}

async function musesJson(method, path, body, expectedStatus) {
  return jsonRequest(`${baseUrl}${path}`, method, body, expectedStatus, {
    cookie: sessionCookie,
  });
}

async function agentJson(hostConfig, method, path, body, expectedStatus) {
  return jsonRequest(
    `${hostConfig.serviceUrl.replace(/\/$/, "")}${path}`,
    method,
    body,
    expectedStatus,
    { authorization: `Bearer ${hostConfig.accessToken}` },
  );
}

async function jsonRequest(url, method, body, expectedStatus, headers) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
  });
  const payload = await response.json().catch(() => undefined);
  const expectedStatuses = Array.isArray(expectedStatus)
    ? expectedStatus
    : [expectedStatus];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${method} request returned ${response.status}, expected ${expectedStatuses.join(" or ")}: ${payload?.message || payload?.error || "unknown error"}`,
    );
  }
  return payload;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
