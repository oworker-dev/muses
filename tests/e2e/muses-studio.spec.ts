import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const studioEmail = "muses-studio-e2e@example.com";
const studioPassword = "MusesStudioE2E123!";
let workspaceId = "";

test.beforeAll(async ({ request }) => {
  await resetStudioUser();
  const signup = await request.post("/api/auth/sign-up/email", {
    headers: { "x-forwarded-for": "203.0.113.61" },
    data: {
      name: "Muses Studio E2E",
      email: studioEmail,
      password: studioPassword,
      callbackURL: "/studio",
    },
  });
  expect(signup.ok()).toBeTruthy();
  await verifyStudioUser();
});

test.beforeEach(async ({ page }, testInfo) => {
  const login = await page.request.post("/api/auth/sign-in/email", {
    headers: {
      "x-forwarded-for": createIsolatedAuthIp(testInfo.workerIndex),
    },
    data: {
      email: studioEmail,
      password: studioPassword,
      callbackURL: "/studio",
    },
  });
  expect(login.ok()).toBeTruthy();
  const context = await page.request.get("/api/studio/context");
  expect(context.ok()).toBeTruthy();
  workspaceId = ((await context.json()) as { workspace: { id: string } })
    .workspace.id;
});

test("Studio requires a verified user session", async ({
  browser,
  request,
}) => {
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto("/studio");
  await expect(page).toHaveURL(
    /\/login\?callbackURL=%2Fstudio|\/login\?callbackURL=\/studio/,
  );
  const api = await request.get("/api/studio/context");
  expect(api.status()).toBe(401);
  await anonymous.close();
});

test("personal workspace and initial credit grant are idempotent", async ({
  page,
}) => {
  const first = await page.request.get("/api/studio/context");
  const second = await page.request.get("/api/studio/context");
  const firstContext = (await first.json()) as {
    workspace: { id: string };
    credits: { postedMicros: string; availableMicros: string };
  };
  const secondContext = (await second.json()) as typeof firstContext;
  expect(secondContext.workspace.id).toBe(firstContext.workspace.id);
  expect(firstContext.credits).toMatchObject({
    postedMicros: "100000000",
    availableMicros: "100000000",
  });
  expect(await readCurrentStudioAccountFacts()).toEqual({
    memberships: 1,
    personalWorkspaces: 1,
    initialGrants: 1,
  });

  await page.goto("/account/billing");
  await expect(page.getByText("Muses credits", { exact: true })).toBeVisible();
  await expect(page.getByText("100", { exact: true }).first()).toBeVisible();
});

test("Studio uses one full-height right rail for Agent and node settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/studio?mode=professional");

  const agent = page.getByTestId("studio-agent-panel");
  await expect(agent).toBeVisible();
  expect((await agent.boundingBox())?.height).toBeGreaterThan(780);

  await page.getByTestId("workflow-node-image-generator-1").click();
  await expect(agent).toHaveCount(0);
  await expect(page.getByTestId("studio-node-inspector")).toBeVisible();

  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId("studio-node-inspector")).toHaveCount(0);
  await expect(page.getByTestId("studio-agent-panel")).toBeVisible();
});

test("Site Admin can inspect the credential-safe Provider control plane", async ({
  page,
}) => {
  await page.goto("/admin/providers");
  await expect(
    page.getByRole("heading", {
      name: /Provider connections and credentials|供应连接与凭证/i,
    }),
  ).toBeVisible();
  await expect(page.getByLabel(/API key|API 密钥/i).first()).toHaveAttribute(
    "type",
    "password",
  );
  await expect(
    page.getByText(/Plaintext is never shown again|提交后不会再次显示明文/i),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/encrypted_secret/i);

  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBeFalsy();
});

test("MusesAgent generates a real image and restores it after refresh", async ({
  page,
}) => {
  test.setTimeout(6 * 60_000);
  await page.goto("/studio");
  const panel = page.getByTestId("studio-agent-panel");
  await expect(panel).toBeVisible();
  await panel
    .getByPlaceholder("What would you like to create?")
    .fill("Create a minimal red product poster on a white background.");
  await panel.getByRole("button", { name: "Send" }).click();

  const approval = page.getByTestId("studio-agent-approval");
  await expect(approval).toBeVisible({ timeout: 2 * 60_000 });
  await expect(approval).toContainText("image.generate");
  await approval.getByRole("button", { name: "Approve" }).click();

  await expect(panel.getByText("Result ready", { exact: true })).toBeVisible({
    timeout: 5 * 60_000,
  });
  const generatedImage = panel.locator("figure img");
  await expect(generatedImage).toBeVisible();
  const runId = await page.evaluate((currentWorkspaceId) => {
    const prefix = `muses.agent.last-run.${currentWorkspaceId}.`;
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith(prefix),
    );
    return key ? window.localStorage.getItem(key) : null;
  }, workspaceId);
  expect(runId).toBeTruthy();
  const runResponse = await page.request.get(
    `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${runId}`,
  );
  expect(runResponse.ok()).toBeTruthy();
  const runProjection = (await runResponse.json()) as {
    run: {
      plan?: {
        steps: Array<{ id: string; status: string }>;
      };
      context: {
        messages: Array<{
          role: string;
          toolName?: string;
          content: string;
        }>;
      };
    };
  };
  const imageToolMessage = [...runProjection.run.context.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "tool" && message.toolName === "image.generate",
    );
  expect(imageToolMessage).toBeTruthy();
  const imageToolOutput = JSON.parse(imageToolMessage!.content) as {
    assets?: Array<{ id: string }>;
  };
  const generatedAssetId = imageToolOutput.assets?.[0]?.id;
  expect(generatedAssetId).toMatch(/^image_/);
  expect(runProjection.run.plan?.steps).toEqual([
    expect.objectContaining({ id: "understand-request", status: "completed" }),
    expect.objectContaining({ id: "generate-image", status: "completed" }),
    expect.objectContaining({ id: "place-result", status: "completed" }),
  ]);
  await expect(page.getByTestId("studio-agent-plan")).toBeVisible();
  await expect(generatedImage).toHaveAttribute(
    "src",
    new RegExp(generatedAssetId!),
  );

  const gatewayResponse = await page.request.get(
    `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
  );
  expect(gatewayResponse.ok()).toBeTruthy();
  const gateway = (await gatewayResponse.json()) as {
    creativeCanvas: {
      revision: number;
      items: Array<{
        id: string;
        kind: string;
        refId: string;
        position: { x: number; y: number };
      }>;
    };
  };
  expect(gateway.creativeCanvas.items).toContainEqual(
    expect.objectContaining({ kind: "asset", refId: generatedAssetId }),
  );
  const canvasItem = gateway.creativeCanvas.items.find(
    ({ refId }) => refId === generatedAssetId,
  );
  expect(canvasItem).toBeTruthy();
  const creativeItem = page.getByTestId(
    `creative-canvas-item-${canvasItem!.id}`,
  );
  await expect(creativeItem).toBeVisible();
  await expect(creativeItem.locator("img")).toHaveAttribute(
    "src",
    new RegExp(generatedAssetId!),
  );

  const itemBox = await creativeItem.boundingBox();
  expect(itemBox).not.toBeNull();
  await page.mouse.move(itemBox!.x + itemBox!.width - 24, itemBox!.y + 24);
  await page.mouse.down();
  await page.mouse.move(itemBox!.x + itemBox!.width + 72, itemBox!.y + 72, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
      );
      const current = (await response.json()) as typeof gateway;
      return current.creativeCanvas.items.find(
        ({ id }) => id === canvasItem!.id,
      )?.position;
    })
    .not.toEqual(canvasItem!.position);

  await page.reload();
  await expect(page.getByTestId("studio-agent-panel")).toContainText(
    "Result ready",
  );
  await expect(
    page.getByTestId("studio-agent-panel").locator("figure img"),
  ).toBeVisible();
  await expect(
    page.getByTestId(`creative-canvas-item-${canvasItem!.id}`),
  ).toBeVisible();
});

test("MusesAgent delegates parallel image work and restores specialist results", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  await page.goto("/studio");
  const panel = page.getByTestId("studio-agent-panel");
  await expect(panel).toBeVisible();
  await panel
    .getByPlaceholder("What would you like to create?")
    .fill(
      [
        "Create two independent product launch poster concepts in parallel.",
        "You must call agent.delegate exactly once with two tasks that have no dependencies and maxConcurrency 2.",
        "Use muses-image-specialist version 0.1.0-alpha for both tasks.",
        "Each task must use only toolNames [image.generate], permissions [image.generate, canvas.write], and computeCapabilities [media-processing].",
        "Give each task a clear distinct visual objective, no input artifacts, a bounded budget, and a result JSON Schema requiring one string assetId with artifact evidence.",
        "Do not call image.generate directly. After the delegation is accepted, report that the specialist work has started and stop.",
        "When trusted delegation results arrive later, give one final response that includes both exact authorized asset IDs and do not call another tool.",
      ].join(" "),
    );
  await panel.getByRole("button", { name: "Send" }).click();

  const rootApproval = page.getByTestId("studio-agent-approval");
  await expect(rootApproval).toBeVisible({ timeout: 3 * 60_000 });
  await expect(rootApproval).toContainText("agent.delegate");
  await rootApproval.getByRole("button", { name: "Approve" }).click();

  let runId: string | null = null;
  await expect
    .poll(
      async () => {
        runId = await page.evaluate((currentWorkspaceId) => {
          const prefix = `muses.agent.last-run.${currentWorkspaceId}.`;
          const key = Object.keys(window.localStorage).find((candidate) =>
            candidate.startsWith(prefix),
          );
          return key ? window.localStorage.getItem(key) : null;
        }, workspaceId);
        return runId;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^arun_/);
  const rootRunId = runId!;

  const delegationPanel = page.getByTestId("studio-agent-delegation");
  await expect(delegationPanel).toBeVisible({ timeout: 3 * 60_000 });
  await expect(delegationPanel).toContainText("2 tasks");

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${rootRunId}`,
        );
        const body = (await response.json()) as {
          delegation?: { approvals?: unknown[] };
        };
        return body.delegation?.approvals?.length;
      },
      { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(2);

  let beforeContinuation: { turn: number } | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${rootRunId}`,
        );
        const body = (await response.json()) as {
          run?: { status: string; turn: number };
          delegation?: { active: boolean; approvals: unknown[] };
        };
        if (
          body.run?.status !== "completed" ||
          !body.delegation?.active ||
          body.delegation.approvals.length !== 2
        ) {
          return null;
        }
        beforeContinuation = { turn: body.run.turn };
        return beforeContinuation;
      },
      { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBeNull();

  for (let approved = 0; approved < 2; approved += 1) {
    const childApproval = page
      .getByTestId("studio-agent-delegated-approval")
      .first();
    await expect(childApproval).toBeVisible({ timeout: 3 * 60_000 });
    await expect(childApproval).toContainText("image.generate");
    await childApproval.getByRole("button", { name: "Approve" }).click();
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${rootRunId}`,
          );
          const body = (await response.json()) as {
            delegation?: { approvals?: unknown[] };
          };
          return body.delegation?.approvals?.length;
        },
        { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
      )
      .toBe(1 - approved);
  }

  let completed: {
    active: boolean;
    delegationRunId?: string;
    runStatus?: string;
    taskStatuses: string[];
    childRunIds: Array<string | undefined>;
    artifactRefs: string[];
  } | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${rootRunId}`,
        );
        expect(response.ok()).toBeTruthy();
        const body = (await response.json()) as {
          delegation: {
            active: boolean;
            runs: Array<{
              delegationRunId: string;
              status: string;
              tasks: Array<{
                status: string;
                artifactRefs: string[];
                childRunId?: string;
              }>;
            }>;
          };
        };
        const tasks = body.delegation.runs.flatMap(({ tasks }) => tasks);
        completed = {
          active: body.delegation.active,
          delegationRunId: body.delegation.runs[0]?.delegationRunId,
          runStatus: body.delegation.runs[0]?.status,
          taskStatuses: tasks.map(({ status }) => status),
          childRunIds: tasks.map(({ childRunId }) => childRunId),
          artifactRefs: tasks.flatMap(({ artifactRefs }) => artifactRefs),
        };
        return completed;
      },
      { timeout: 6 * 60_000, intervals: [1000, 2000, 4000] },
    )
    .toMatchObject({
      active: false,
      runStatus: "completed",
      taskStatuses: ["completed", "completed"],
      childRunIds: [
        expect.stringMatching(/^arun_/),
        expect.stringMatching(/^arun_/),
      ],
      artifactRefs: [
        expect.stringMatching(/^image_/),
        expect.stringMatching(/^image_/),
      ],
    });
  expect(new Set(completed!.artifactRefs).size).toBe(2);
  expect(completed!.delegationRunId).toMatch(/^delegation_/);

  let continued: {
    status?: string;
    turn?: number;
    continuationMessages: number;
    finalAssistant: string;
  } | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${rootRunId}`,
        );
        const body = (await response.json()) as {
          run?: {
            status: string;
            turn: number;
            context: {
              messages: Array<{
                role: string;
                content: string;
                metadata?: { kind?: string; delegationRunId?: string };
              }>;
            };
          };
        };
        const messages = body.run?.context.messages || [];
        const continuationIndex = messages.findIndex(
          ({ metadata }) =>
            metadata?.kind === "agent-delegation-result" &&
            metadata.delegationRunId === completed!.delegationRunId,
        );
        const continuationMessages = messages.filter(
          ({ metadata }) =>
            metadata?.kind === "agent-delegation-result" &&
            metadata.delegationRunId === completed!.delegationRunId,
        ).length;
        const finalAssistant = messages
          .slice(continuationIndex + 1)
          .findLast(
            ({ role, content }) => role === "assistant" && content.trim(),
          )?.content;
        continued = {
          status: body.run?.status,
          turn: body.run?.turn,
          continuationMessages,
          finalAssistant: finalAssistant || "",
        };
        return continued;
      },
      { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({
      status: "completed",
      turn: beforeContinuation!.turn + 1,
      continuationMessages: 1,
      finalAssistant: expect.any(String),
    });
  expect(continued!.finalAssistant.length).toBeGreaterThan(0);
  for (const assetId of completed!.artifactRefs) {
    expect(continued!.finalAssistant).toContain(assetId);
  }

  const continuationFacts = await readAgentDelegationContinuationFacts(
    rootRunId,
    completed!.delegationRunId!,
  );
  expect(continuationFacts).toMatchObject({
    receiptCount: 1,
    receiptStatus: "completed",
    messageCommitted: true,
    rootModelCalls: continued!.turn,
    imageReservations: 2,
  });

  const gatewayResponse = await page.request.get(
    `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
  );
  expect(gatewayResponse.ok()).toBeTruthy();
  const gateway = (await gatewayResponse.json()) as {
    creativeCanvas: { items: Array<{ kind: string; refId: string }> };
  };
  for (const assetId of completed!.artifactRefs) {
    expect(gateway.creativeCanvas.items).toContainEqual(
      expect.objectContaining({ kind: "asset", refId: assetId }),
    );
  }

  const traceResponse = await page.request.get(
    `/api/studio/agent-runs/trace?workspaceId=${workspaceId}&runId=${rootRunId}`,
  );
  expect(traceResponse.ok()).toBeTruthy();
  const trace = (await traceResponse.json()) as {
    delegationLineage: {
      agentRuns: unknown[];
      delegations: unknown[];
    };
    assets: Array<{ assetId: string }>;
  };
  expect(trace.delegationLineage.agentRuns).toHaveLength(3);
  expect(trace.delegationLineage.delegations).toHaveLength(1);
  expect(trace.assets.map(({ assetId }) => assetId)).toEqual(
    expect.arrayContaining(completed!.artifactRefs),
  );

  await page.reload();
  await expect(page.getByTestId("studio-agent-delegation")).toBeVisible();
  await expect(page.getByTestId("studio-agent-delegation")).toContainText(
    "2 results",
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(
    await readAgentDelegationContinuationFacts(
      rootRunId,
      completed!.delegationRunId!,
    ),
  ).toEqual(continuationFacts);
});

test("completed MusesAgent cancels pending specialist work without continuation", async ({
  page,
}) => {
  test.setTimeout(6 * 60_000);
  await page.goto("/studio");
  const panel = page.getByTestId("studio-agent-panel");
  await expect(panel).toBeVisible();
  await panel
    .getByPlaceholder("What would you like to create?")
    .fill(
      [
        "Prepare two independent product poster explorations in parallel.",
        "You must call agent.delegate exactly once with two tasks that have no dependencies and maxConcurrency 2.",
        "Use muses-image-specialist version 0.1.0-alpha for both tasks.",
        "Each task must use only toolNames [image.generate], permissions [image.generate, canvas.write], and computeCapabilities [media-processing].",
        "Give each task no input artifacts, a bounded budget, and a result JSON Schema requiring one string assetId with artifact evidence.",
        "Do not call image.generate directly. After delegation is accepted, report that specialist work has started and stop.",
      ].join(" "),
    );
  await panel.getByRole("button", { name: "Send" }).click();

  const rootApproval = page.getByTestId("studio-agent-approval");
  await expect(rootApproval).toBeVisible({ timeout: 3 * 60_000 });
  await expect(rootApproval).toContainText("agent.delegate");
  await rootApproval.getByRole("button", { name: "Approve" }).click();

  let rootRunId: string | null = null;
  await expect
    .poll(
      async () => {
        rootRunId = await page.evaluate((currentWorkspaceId) => {
          const prefix = `muses.agent.last-run.${currentWorkspaceId}.`;
          const key = Object.keys(window.localStorage).find((candidate) =>
            candidate.startsWith(prefix),
          );
          return key ? window.localStorage.getItem(key) : null;
        }, workspaceId);
        return rootRunId;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^arun_/);

  let active: {
    delegationRunId: string;
    rootTurn: number;
    childRunIds: string[];
  } | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${rootRunId}`,
        );
        const body = (await response.json()) as {
          run?: { status: string; turn: number };
          delegation?: {
            active: boolean;
            approvals: unknown[];
            runs: Array<{
              delegationRunId: string;
              status: string;
              tasks: Array<{ childRunId?: string; status: string }>;
            }>;
          };
        };
        const delegation = body.delegation?.runs[0];
        const childRunIds =
          delegation?.tasks.flatMap(({ childRunId }) =>
            childRunId ? [childRunId] : [],
          ) || [];
        if (
          body.run?.status !== "completed" ||
          !body.delegation?.active ||
          body.delegation.approvals.length !== 2 ||
          delegation?.status !== "running" ||
          childRunIds.length !== 2
        ) {
          return null;
        }
        active = {
          delegationRunId: delegation.delegationRunId,
          rootTurn: body.run.turn,
          childRunIds,
        };
        return active;
      },
      { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBeNull();

  const modelCallsBefore = await countAgentModelCalls(rootRunId!);
  const cancelButton = page.getByTestId("studio-agent-delegation-cancel");
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();

  await expect
    .poll(
      async () =>
        readAgentDelegationCancellationFacts(
          rootRunId!,
          active!.delegationRunId,
        ),
      { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({
      rootStatus: "completed",
      rootTurn: active!.rootTurn,
      delegationStatus: "cancelled",
      driverStatus: "cancelled",
      continuationStatus: "skipped",
      continuationFailureCode: "delegation-cancelled",
      cancelledChildren: 2,
      activeChildren: 0,
      generatedAssets: 0,
      envelopeStatus: "settled",
      rootModelCalls: modelCallsBefore,
    });

  const replay = await page.request.patch("/api/studio/agent-runs", {
    data: {
      action: "cancel-delegation",
      workspaceId,
      runId: rootRunId,
      delegationRunId: active!.delegationRunId,
      idempotencyKey: `${rootRunId}:${active!.delegationRunId}:studio-cancel:v1`,
      reason: "Cancelled specialist work from Muses Studio.",
    },
  });
  expect(replay.ok()).toBeTruthy();
  expect(await replay.json()).toMatchObject({
    accepted: true,
    delegationCancellation: {
      delegationRunId: active!.delegationRunId,
      status: "cancelled",
      idempotentReplay: true,
    },
  });

  await page.reload();
  await expect(page.getByTestId("studio-agent-delegation")).toContainText(
    "Cancelled",
  );
  await expect(page.getByTestId("studio-agent-delegation-cancel")).toHaveCount(
    0,
  );
  expect(await countAgentModelCalls(rootRunId!)).toBe(modelCallsBefore);
});

test("expired Agent driver claims recover without model or credit side effects", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const gateway = await page.request.get(
    `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
  );
  expect(gateway.ok()).toBeTruthy();
  const fixtureRunIds: string[] = [];
  const fixture = await createExpiredAgentDriverFixture(workspaceId);
  fixtureRunIds.push(fixture.runId);
  try {
    const initial = await page.request.get(
      `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${fixture.runId}`,
    );
    expect(initial.ok()).toBeTruthy();
    await expectRecoveredAgentDriver(page, fixture.runId);

    const facts = await readAgentDriverFixtureFacts(fixture.runId);
    expect(facts).toMatchObject({
      agentStatus: "failed",
      driverStatus: "completed",
      driverRunId: expect.stringMatching(/^wrun_/),
      childWorkflowRuns: 0,
      generatedAssets: 0,
      creditReservations: 0,
      modelEvents: 0,
    });
    expect(facts.driverAttemptId).not.toBe(fixture.attemptId);
    expect(facts.driverRunId).toBeTruthy();

    await deleteAgentDriverFixture(fixture.runId);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const attachedFixture = await createExpiredAgentDriverFixture(
      workspaceId,
      facts.driverRunId!,
    );
    fixtureRunIds.push(attachedFixture.runId);
    const reconciled = await page.request.get(
      `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${attachedFixture.runId}`,
    );
    expect(reconciled.ok()).toBeTruthy();
    await expectRecoveredAgentDriver(page, attachedFixture.runId);

    const reconciledFacts = await readAgentDriverFixtureFacts(
      attachedFixture.runId,
    );
    expect(reconciledFacts).toMatchObject({
      agentStatus: "failed",
      driverStatus: "completed",
      driverRunId: expect.stringMatching(/^wrun_/),
      childWorkflowRuns: 0,
      generatedAssets: 0,
      creditReservations: 0,
      modelEvents: 0,
    });
    expect(reconciledFacts.driverAttemptId).not.toBe(attachedFixture.attemptId);
    expect(reconciledFacts.driverRunId).not.toBe(facts.driverRunId);
  } finally {
    for (const runId of fixtureRunIds) {
      await deleteAgentDriverFixture(runId);
    }
  }
});

test("Operation Gateway persists independent workflows with idempotent revisions", async ({
  page,
}) => {
  const initialResponse = await page.request.get(
    `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
  );
  expect(initialResponse.ok()).toBeTruthy();
  const initial =
    (await initialResponse.json()) as OperationGatewayTestSnapshot;
  expect(initial.workspaceId).toBe(workspaceId);
  expect(initial.workflowDefinitions).toHaveLength(1);

  const first = initial.workflowDefinitions[0];
  const commandId = `command_${randomBytes(10).toString("hex")}`;
  const moveCommand = {
    schemaVersion: "0.1.0-draft",
    commandId,
    idempotencyKey: commandId,
    workspaceId,
    projectId: initial.project.id,
    target: { type: "workflow-definition", id: first.definitionId },
    expectedRevision: first.revision,
    issuedAt: new Date().toISOString(),
    payload: {
      type: "workflow.definition.command",
      command: {
        type: "workflow.node.move",
        nodeId: "image-generator-1",
        position: { x: 640, y: 320 },
      },
    },
  };
  const acceptedResponse = await page.request.post(
    "/api/studio/operation-gateway",
    { data: moveCommand },
  );
  expect(acceptedResponse.ok()).toBeTruthy();
  const accepted =
    (await acceptedResponse.json()) as OperationGatewayTestResult;
  expect(accepted).toMatchObject({
    accepted: true,
    duplicate: false,
    resultingRevision: first.revision + 1,
  });
  expect(
    accepted.snapshot.workflowDefinitions[0].document.workflow.nodes.find(
      ({ id }) => id === "image-generator-1",
    )?.position,
  ).toEqual({ x: 640, y: 320 });

  const replayResponse = await page.request.post(
    "/api/studio/operation-gateway",
    { data: moveCommand },
  );
  expect(replayResponse.ok()).toBeTruthy();
  expect(await replayResponse.json()).toMatchObject({
    accepted: true,
    duplicate: true,
    resultingRevision: first.revision + 1,
  });

  const staleResponse = await page.request.post(
    "/api/studio/operation-gateway",
    {
      data: {
        ...moveCommand,
        commandId: `${commandId}_stale`,
        idempotencyKey: `${commandId}_stale`,
        expectedRevision: first.revision,
        payload: {
          ...moveCommand.payload,
          command: {
            ...moveCommand.payload.command,
            position: { x: 700, y: 400 },
          },
        },
      },
    },
  );
  expect(staleResponse.status()).toBe(409);
  expect(await staleResponse.json()).toMatchObject({
    accepted: false,
    code: "revision-conflict",
    resultingRevision: first.revision + 1,
  });

  const professional = accepted.snapshot.professionalWorkspace;
  const secondDefinitionId = `mwfd_${randomBytes(10).toString("hex")}`;
  const createResponse = await page.request.post(
    "/api/studio/operation-gateway",
    {
      data: {
        schemaVersion: "0.1.0-draft",
        commandId: `${commandId}_create`,
        idempotencyKey: `${commandId}_create`,
        workspaceId,
        projectId: initial.project.id,
        target: {
          type: "professional-workspace",
          id: professional.professionalWorkspaceId,
        },
        expectedRevision: professional.revision,
        issuedAt: new Date().toISOString(),
        payload: {
          type: "professional.workflow.create",
          definitionId: secondDefinitionId,
          name: "Second image workflow",
          position: { x: 720, y: 160 },
          collapsed: false,
        },
      },
    },
  );
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as OperationGatewayTestResult;
  expect(created.snapshot.workflowDefinitions).toHaveLength(2);
  expect(
    created.snapshot.workflowDefinitions.map(
      ({ definitionId }) => definitionId,
    ),
  ).toEqual(expect.arrayContaining([first.definitionId, secondDefinitionId]));

  const denied = await page.request.post("/api/studio/operation-gateway", {
    data: {
      ...moveCommand,
      commandId: `${commandId}_cross_workspace`,
      idempotencyKey: `${commandId}_cross_workspace`,
      workspaceId: "mws_not_authorized",
    },
  });
  expect(denied.status()).toBe(404);
  expect(await denied.json()).toMatchObject({ error: "workspace-not-found" });
});

test("Studio consumes a published versioned image model catalog", async ({
  page,
}) => {
  const response = await page.request.get(
    `/api/studio/model-catalog?workspaceId=${workspaceId}`,
  );
  expect(response.ok()).toBeTruthy();
  const catalog = (await response.json()) as {
    schemaVersion: string;
    offerings: Array<Record<string, unknown>>;
  };
  expect(catalog.schemaVersion).toBe("0.1.0");
  expect(catalog.offerings).toHaveLength(2);
  expect(catalog.offerings[0]).toMatchObject({
    modelRef: "openai/gpt-image-2@2026-07-28",
    displayName: "GPT Image 2",
    capability: {
      id: "image.generate.v1",
      profileVersion: "2026-07-28.1",
      specification: {
        inputModes: ["text-to-image", "image-to-image"],
        aspectRatios: [
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "3:2",
          "2:3",
          "21:9",
          "9:21",
        ],
        resolutionPresets: [
          { id: "1k", label: "1K", longEdge: 1024 },
          { id: "2k", label: "2K", longEdge: 2048 },
          { id: "4k", label: "4K", longEdge: 3840 },
        ],
        customSize: { enabled: true },
        outputCounts: [1, 2, 3, 4],
      },
    },
    price: {
      priceBookVersion: "alpha-2026-07-28.1",
      billingUnit: "image-output",
      unitCreditMicros: "1000000",
    },
  });
  expect(catalog.offerings[0]).not.toHaveProperty("providerModelId");

  await page.goto("/studio?mode=professional");
  await page.getByTestId("workflow-node-image-generator-1").click();
  await expect(page.getByLabel("Model").locator("option")).toHaveCount(2);
  await expectPublishedCatalogVersionsAreImmutable();
});

test("the default professional workflow produces and restores one image result", async ({
  page,
}) => {
  const runId = "wrun_gate1_first_image_fixture";
  const assetId = "image_gate1_fixture";
  const imageDataUri =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const referenceImage = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  let invokedWorkflow: {
    workspaceId?: string;
    target?: {
      kind?: string;
      workspaceId?: string;
      deploymentId?: string;
    };
  } | null = null;
  let workflowInspectionCount = 0;

  await page.route("**/api/studio/workflow-runs*", async (route) => {
    if (route.request().method() === "POST") {
      invokedWorkflow = route.request().postDataJSON();
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          accepted: true,
          runId,
          runtime: "muses-workflow-runtime",
          durableRuntime: "vercel-workflow-sdk",
        }),
      });
      return;
    }

    workflowInspectionCount += 1;
    const running = workflowInspectionCount <= 3;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runId,
        runtime: "muses-workflow-runtime",
        sdkStatus: running ? "running" : "completed",
        status: running ? "running" : "completed",
        attempts: [
          {
            nodeId: "image-generator-1",
            nodeKind: "image-generator",
            attempt: 1,
            maxAttempts: 1,
            status: running ? "running" : "succeeded",
          },
        ],
        events: [],
        result: {
          outputs: {
            image: {
              valueType: "image",
              assetIds: [assetId],
              assets: [
                {
                  id: assetId,
                  url: imageDataUri,
                  mimeType: "image/png",
                  width: 1024,
                  height: 1536,
                  prompt: "A precise launch visual for Muses",
                  provider: "openai",
                  modelRef: "openai/gpt-image-1.5@2026-07-28",
                  createdAt: "2026-07-28T00:00:00.000Z",
                  source: {
                    workspaceId,
                    runId,
                    nodeId: "image-generator-1",
                  },
                },
              ],
            },
          },
        },
        observability: {
          schemaVersion: "0.1.0",
          source: "workflow-sdk-world",
          run: {
            startedAt: "2026-07-28T00:00:00.000Z",
            ...(running
              ? {}
              : {
                  completedAt: "2026-07-28T00:00:01.240Z",
                  durationMs: 1240,
                }),
            workflowCoreVersion: "4.6.2",
          },
          nodes: [
            {
              nodeId: "image-generator-1",
              nodeKind: "image-generator",
              status: running ? "running" : "succeeded",
              attempt: 1,
              startedAt: "2026-07-28T00:00:00.000Z",
              ...(running
                ? {}
                : {
                    completedAt: "2026-07-28T00:00:01.240Z",
                    durationMs: 1240,
                  }),
              inputSummary: [
                {
                  portId: "prompt",
                  valueType: "text",
                  value: "A precise launch visual for Muses",
                  truncated: false,
                },
                {
                  portId: "referenceImages",
                  valueType: "image",
                  count: 1,
                },
              ],
              outputSummary: running
                ? []
                : [{ portId: "image", valueType: "image", count: 1 }],
              model: {
                modelRef: "openai/gpt-image-1.5@2026-07-28",
                capabilityProfile: {
                  id: "cap_openai_gpt_image_1_5_generate_v1",
                  version: "2026-07-28.1",
                },
                priceBook: {
                  entryId: "price_openai_gpt_image_1_5_low",
                  version: "alpha-2026-07-28.1",
                  unitCreditMicros: "1000000",
                },
                requestedSize: { width: 1024, height: 1536 },
                resolvedSize: {
                  width: 1024,
                  height: 1536,
                  adjusted: false,
                },
              },
              usage: {
                imageCount: 1,
                tokenStatus: "not-reported",
              },
              billing: {
                estimatedMicros: "1000000",
                actualMicros: "1000000",
                status: "settled",
              },
            },
          ],
          totals: {
            imageCount: 1,
            tokenStatus: "not-reported",
            estimatedMicros: "1000000",
            actualMicros: "1000000",
            billingStatus: "settled",
          },
        },
      }),
    });
  });

  await page.goto("/studio?mode=professional");
  await expect(page.getByTestId("workflow-node-start-1")).toBeVisible();
  await expect(
    page.getByTestId("workflow-node-image-generator-1"),
  ).toBeVisible();
  await expect(page.getByTestId("workflow-node-end-1")).toBeVisible();
  await expect(page.getByTestId("workflow-node-selector-1")).toHaveCount(0);
  await expect(page.getByTestId("workflow-node-design-1")).toHaveCount(0);

  await page.getByTestId("workflow-node-image-generator-1").click();
  await page.getByRole("button", { name: "Fixed value" }).first().click();
  await page
    .getByTestId("image-prompt-input")
    .fill("A precise launch visual for Muses");
  await page.getByTestId("image-prompt-input").press("Tab");
  await page.getByTestId("reference-image-input").setInputFiles({
    name: "muses-reference.png",
    mimeType: "image/png",
    buffer: referenceImage,
  });
  const referencePreview = page.locator(
    'img[src^="/api/studio/reference-images/refimg_"]',
  );
  await expect(referencePreview).toHaveCount(1);
  await expect
    .poll(() =>
      referencePreview.evaluate(
        (image) =>
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth === 1 &&
          image.naturalHeight === 1,
      ),
    )
    .toBe(true);
  const referencePreviewUrl = await referencePreview.getAttribute("src");
  expect(referencePreviewUrl).toBeTruthy();
  const referenceAssetId = referencePreviewUrl?.match(
    /\/reference-images\/(refimg_[a-f0-9]{32})/,
  )?.[1];
  expect(referenceAssetId).toMatch(/^refimg_[a-f0-9]{32}$/);
  const previewResponse = await page.request.get(referencePreviewUrl!);
  expect(previewResponse.ok()).toBeTruthy();
  expect(previewResponse.headers()["content-type"]).toContain("image/png");
  expect(await previewResponse.body()).toEqual(referenceImage);
  await page
    .getByLabel("Model")
    .selectOption("openai/gpt-image-1.5@2026-07-28");
  await page.getByLabel("Aspect ratio").selectOption("2:3");
  await page.getByLabel("Image count").selectOption("1");
  await page.getByLabel("Quality").selectOption("low");
  await page
    .getByRole("button", { name: "Generate image", exact: true })
    .last()
    .click();

  const generatorNode = page.getByTestId("workflow-node-image-generator-1");
  await expect(generatorNode).toHaveAttribute("data-runtime-status", "running");
  await expect(generatorNode).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByTestId("workflow-node-result-image-generator-1"),
  ).toContainText("Waiting for node output");

  await expect(page.getByTestId("durable-run-images")).toBeVisible();
  await expect(generatorNode).toHaveAttribute(
    "data-runtime-status",
    "succeeded",
  );
  await expect(
    page.getByTestId("workflow-node-result-image-generator-1"),
  ).toContainText("1.2 sec");
  await expect(
    page.getByTestId("workflow-node-result-image-generator-1"),
  ).toContainText("1 image");
  const observability = page.getByTestId("durable-run-observability");
  await expect(observability).toBeVisible();
  await expect(observability).toContainText(
    "A precise launch visual for Muses",
  );
  await expect(observability).toContainText("openai/gpt-image-1.5@2026-07-28");
  await expect(observability).toContainText("2026-07-28.1");
  await expect(observability).toContainText("alpha-2026-07-28.1");
  await expect(observability).toContainText(
    "Provider did not report token usage",
  );
  await expect(observability).toContainText("Actual 1 cr · estimated 1 cr");
  expect(invokedWorkflow?.workspaceId).toBe(workspaceId);
  expect(invokedWorkflow?.target).toMatchObject({
    kind: "deployment",
    workspaceId,
  });
  expect(invokedWorkflow?.target?.deploymentId).toMatch(/^mwdep_/);
  const inspectionResponse = await page.request.get(
    `/api/studio/workflow-publications?workspaceId=${workspaceId}&deploymentId=${invokedWorkflow?.target?.deploymentId}`,
  );
  expect(inspectionResponse.ok()).toBeTruthy();
  const inspection = (await inspectionResponse.json()) as {
    inspection: {
      definition: {
        nodes: Array<{ id: string; config: Record<string, unknown> }>;
        dataBindings: Array<{
          source: { nodeId: string };
          target: { nodeId: string };
        }>;
      };
    };
  };
  expect(inspection.inspection.definition.nodes.map((node) => node.id)).toEqual(
    ["start-1", "image-generator-1", "end-1"],
  );
  expect(
    inspection.inspection.definition.nodes.find(
      (node) => node.id === "image-generator-1",
    )?.config,
  ).toMatchObject({
    capabilityId: "image.generate.v1",
    modelRef: "openai/gpt-image-1.5@2026-07-28",
    inputs: {
      prompt: { mode: "fixed", value: "A precise launch visual for Muses" },
      referenceImages: { mode: "fixed", assetIds: [referenceAssetId] },
    },
    output: {
      size: { mode: "preset", presetId: "1k", aspectRatio: "2:3" },
      count: 1,
    },
    quality: "low",
  });
  expect(inspection.inspection.definition.dataBindings).toEqual([
    expect.objectContaining({
      source: expect.objectContaining({ nodeId: "image-generator-1" }),
      target: expect.objectContaining({ nodeId: "end-1" }),
    }),
  ]);
  await expect(page.getByTestId("durable-run-images")).toContainText(
    "GPT Image 1.5 · 1024 × 1536",
  );
  await expect(
    page.getByRole("link", { name: "Download image" }),
  ).toHaveAttribute("download", `${assetId}.png`);
  await expect(
    page.getByRole("link", { name: "Download image" }),
  ).toHaveAttribute(
    "href",
    `/api/studio/generated-images/${assetId}?workspaceId=${workspaceId}&runId=${runId}`,
  );

  await page.reload();
  await expect(page.getByTestId("durable-run-images")).toBeVisible();
  await expect(page.getByTestId("durable-run-panel")).toContainText(
    "Completed",
  );
  await page.getByTestId("durable-run-collapse").click();
  await page.getByTestId("workflow-node-image-generator-1").click();
  await expect(page.getByTestId("image-prompt-input")).toHaveValue(
    "A precise launch visual for Muses",
  );
  await expect(page.getByLabel("Aspect ratio")).toHaveValue("2:3");
});

test("reference image confirmation keeps storage misses retryable", async ({
  page,
}) => {
  const uploadResponse = await page.request.post(
    "/api/studio/reference-images/upload",
    {
      data: {
        workspaceId,
        fileName: "not-uploaded.png",
        contentType: "image/png",
        size: 68,
      },
    },
  );
  expect(uploadResponse.status()).toBe(201);
  const upload = (await uploadResponse.json()) as {
    upload: { assetId: string };
  };

  const confirmResponse = await page.request.post(
    "/api/studio/reference-images/confirm",
    {
      data: { workspaceId, assetId: upload.upload.assetId },
    },
  );
  expect(confirmResponse.status()).toBe(503);
  expect(await confirmResponse.json()).toMatchObject({
    error: "reference-image-confirm-retryable",
    retryable: true,
  });
  expect(await readReferenceImageStatus(upload.upload.assetId)).toBe(
    "uploading",
  );
});

test("Muses waits and resumes a durable server interpreter while keeping the local image fixture separate", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/studio?template=harness");

  await expect(
    page.getByRole("heading", { name: "Muses Studio" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(page.getByTestId("studio-node-library")).toBeVisible();
  await page.getByRole("button", { name: "Close node library" }).click();
  await expect(page.getByTestId("workflow-node-start-1")).toBeVisible();
  await expect(
    page.getByTestId("workflow-node-image-generator-1"),
  ).toBeVisible();
  await expect(page.getByTestId("workflow-node-selector-1")).toBeVisible();
  await expect(page.getByTestId("workflow-node-design-1")).toHaveCount(1);
  await expect(page.getByTestId("workflow-node-end-1")).toHaveCount(1);

  await page.getByTestId("workflow-node-image-generator-1").click();
  await expect(
    page.getByRole("button", { name: "Prompt variable" }),
  ).toContainText("Start · Prompt");
  expect(
    await page
      .locator("html")
      .evaluate((element) => element.classList.contains("dark")),
  ).toBe(false);

  const startResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio/workflow-runs") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Generate Check" }).click();
  const publication = await startResponse;
  expect(publication.status()).toBe(202);
  const publicationBody = (await publication.json()) as {
    runId: string;
    runtime: string;
    durableRuntime: string;
    definition: {
      workspaceId: string;
      definitionId: string;
      version: number;
      schemaVersion: string;
    };
    deploymentId: string;
  };
  expect(publicationBody.runtime).toBe("muses-workflow-runtime");
  expect(publicationBody.durableRuntime).toBe("vercel-workflow-sdk");
  expect(publicationBody.runId).toMatch(/^wrun_/);
  expect(publicationBody.definition).toEqual({
    workspaceId,
    definitionId: `${workspaceId}:durable-harness`,
    version: expect.any(Number),
    schemaVersion: "0.3.0-draft",
  });
  expect(publicationBody.definition.version).toBeGreaterThanOrEqual(1);
  expect(publicationBody.deploymentId).toMatch(/^mwdep_/);
  const repeatedInvocation = await page.request.post(
    "/api/studio/workflow-runs",
    { data: publication.request().postDataJSON() },
  );
  expect(repeatedInvocation.status()).toBe(202);
  expect(await repeatedInvocation.json()).toMatchObject({
    runId: publicationBody.runId,
    definition: publicationBody.definition,
    deploymentId: publicationBody.deploymentId,
    idempotentReplay: true,
  });
  await expect(
    page.getByText(/Durable Workflow SDK run started:/i),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("waiting");

  const waiting = await page.request.get(
    `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
  );
  const waitingBody = (await waiting.json()) as {
    status: string;
    suspension: {
      id: string;
      nodeId: string;
      candidateAssets: Array<{ assetId: string; source: string }>;
    };
    events: Array<{ type: string; nodeId?: string }>;
    observability: {
      source: string;
      run: { workflowCoreVersion?: string; startedAt?: string };
      nodes: Array<{
        nodeId: string;
        nodeKind: string;
        status: string;
        inputSummary: Array<{
          portId: string;
          valueType: string;
          value?: string;
        }>;
      }>;
    };
  };
  expect(waitingBody).toMatchObject({
    status: "waiting",
    suspension: {
      id: "selector:selector-1",
      nodeId: "selector-1",
      candidateAssets: [
        { source: "server-harness-fixture" },
        { source: "server-harness-fixture" },
        { source: "server-harness-fixture" },
      ],
    },
  });
  expect(waitingBody.events.map((event) => event.type)).toEqual(
    expect.arrayContaining([
      "run.started",
      "node.started",
      "node.succeeded",
      "node.waiting",
    ]),
  );
  expect(waitingBody.observability).toMatchObject({
    source: "workflow-sdk-world",
    run: { workflowCoreVersion: "4.6.2" },
    nodes: expect.arrayContaining([
      expect.objectContaining({
        nodeId: "image-generator-1",
        nodeKind: "image-generator",
        status: "succeeded",
        inputSummary: expect.arrayContaining([
          expect.objectContaining({
            portId: "prompt",
            valueType: "text",
            value: expect.stringContaining("cinematic launch visual"),
          }),
        ]),
      }),
      expect.objectContaining({
        nodeId: "selector-1",
        status: "waiting",
      }),
    ]),
  });
  expect(JSON.stringify(waitingBody)).not.toContain("muses:selector:wrun_");
  expect(JSON.stringify(waitingBody)).not.toContain("providerModelId");
  expect(JSON.stringify(waitingBody)).not.toContain("creditContext");
  await expect(page.getByTestId("durable-run-suspension")).toBeVisible();
  await expect(
    page.locator('[data-testid^="workflow-result-image-result-"]'),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("durable-run-suspension")).toBeVisible();
  await expect(page.getByTestId("durable-run-panel")).toContainText(
    "Waiting for you",
  );

  const wrongWorkspaceRun = await page.request.get(
    `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=another-workspace`,
  );
  expect(wrongWorkspaceRun.status()).toBe(404);

  const wrongWorkspaceSelection = await page.request.patch(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId: "another-workspace",
        runId: publicationBody.runId,
        suspensionId: waitingBody.suspension.id,
        selectedAssetId: waitingBody.suspension.candidateAssets[0].assetId,
        idempotencyKey: `selector-wrong-workspace:${publicationBody.runId}`,
      },
    },
  );
  expect(wrongWorkspaceSelection.status()).toBe(404);

  const rejectedSelection = await page.request.patch(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        runId: publicationBody.runId,
        suspensionId: waitingBody.suspension.id,
        selectedAssetId: "untrusted-asset",
        idempotencyKey: `selector-reject:${publicationBody.runId}`,
      },
    },
  );
  expect(rejectedSelection.status()).toBe(422);

  const selectedAssetId = waitingBody.suspension.candidateAssets[1].assetId;
  const resumeIdempotencyKey = [
    "selector-resume",
    publicationBody.runId,
    waitingBody.suspension.id,
    selectedAssetId,
  ].join(":");
  const resumeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio/workflow-runs") &&
      response.request().method() === "PATCH",
  );
  await page.getByTestId("server-harness-candidate-2").click();
  const firstResume = await resumeResponse;
  expect(firstResume.status()).toBe(202);
  expect(await firstResume.json()).toMatchObject({
    accepted: true,
    idempotencyKey: resumeIdempotencyKey,
    idempotentReplay: false,
  });

  const replayedResume = await page.request.patch("/api/studio/workflow-runs", {
    data: {
      workspaceId,
      runId: publicationBody.runId,
      suspensionId: waitingBody.suspension.id,
      selectedAssetId,
      idempotencyKey: resumeIdempotencyKey,
    },
  });
  expect(replayedResume.status()).toBe(202);
  expect(await replayedResume.json()).toMatchObject({
    accepted: true,
    idempotentReplay: true,
  });

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("completed");
  const completed = await page.request.get(
    `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
  );
  const completedBody = (await completed.json()) as {
    observability: {
      source: string;
      run: { durationMs?: number };
      nodes: Array<{ nodeId: string; status: string }>;
    };
  };
  expect(completedBody).toMatchObject({
    status: "completed",
    result: {
      accepted: true,
      runtime: "muses-workflow-runtime",
      definition: {
        workspaceId,
        definitionId: publicationBody.definition.definitionId,
        version: publicationBody.definition.version,
      },
      completedNodeIds: [
        "start-1",
        "image-generator-1",
        "selector-1",
        "design-1",
        "end-1",
      ],
      outputs: {
        document: {
          valueType: "design-document",
          documentId: "design-1-document",
          revision: 0,
        },
      },
    },
    observability: {
      source: "workflow-sdk-world",
      nodes: expect.arrayContaining([
        expect.objectContaining({ nodeId: "start-1", status: "succeeded" }),
        expect.objectContaining({
          nodeId: "image-generator-1",
          status: "succeeded",
        }),
        expect.objectContaining({
          nodeId: "design-1",
          status: "succeeded",
        }),
        expect.objectContaining({ nodeId: "end-1", status: "succeeded" }),
      ]),
    },
  });
  expect(completedBody.observability.run.durationMs).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId("durable-run-output")).toContainText(
    "design-1-document · r0",
  );

  const replayedAfterCompletion = await page.request.patch(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        runId: publicationBody.runId,
        suspensionId: waitingBody.suspension.id,
        selectedAssetId,
        idempotencyKey: resumeIdempotencyKey,
      },
    },
  );
  expect(replayedAfterCompletion.status()).toBe(202);
  expect(await replayedAfterCompletion.json()).toMatchObject({
    accepted: true,
    idempotentReplay: true,
  });

  const newMutationAfterCompletion = await page.request.patch(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        runId: publicationBody.runId,
        suspensionId: waitingBody.suspension.id,
        selectedAssetId,
        idempotencyKey: `${resumeIdempotencyKey}:new-mutation`,
      },
    },
  );
  expect(newMutationAfterCompletion.status()).toBe(404);

  await page
    .getByTestId("workflow-node-image-generator-1")
    .getByRole("button", { name: "Generate image" })
    .click();
  await expect(
    page.locator('[data-testid^="workflow-result-image-result-"]'),
  ).toHaveCount(3);
  const jobDetails = page.getByTestId("job-details-image-generator-1");
  await expect(jobDetails).toContainText("Actual input prompt");
  await expect(jobDetails).toContainText("Completed");
  await expect(jobDetails).toContainText("Output assets");
  await expect(jobDetails).toContainText("3");
  await expect(jobDetails).toContainText("0 credits");
  await expect(page.getByText(/Local image fixture completed/i)).toBeVisible();

  const firstResult = page
    .locator('[data-testid^="workflow-result-image-result-"]')
    .nth(1);
  await firstResult.click();
  await expect(
    page.getByText(/Direction selected and published/i),
  ).toBeVisible();

  await page.getByTestId("durable-run-collapse").click();
  await page
    .getByTestId("workflow-node-design-1")
    .getByRole("button", { name: "Open design canvas" })
    .click();
  await expect(page.getByText("DesignDocument", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Launch composition" }),
  ).toBeVisible();

  const headline = page.getByRole("textbox", { name: "headline" });
  await headline.fill("Built in public.");
  await page.getByRole("button", { name: "Back to workflow" }).click();
  await expect(page.getByTestId("workflow-node-design-1")).toContainText(
    "Built in public.",
  );

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^muses-workspace-r\d+\.json$/,
  );

  await page.reload();
  await expect(
    page.locator('[data-testid^="workflow-result-image-result-"]'),
  ).toHaveCount(3);
  await expect(page.getByTestId("workflow-node-design-1")).toContainText(
    "Built in public.",
  );
  await expect(page.getByLabel("Autosaved locally")).toBeVisible();
});

test("a waiting durable run can be cancelled once and queried after Hook disposal", async ({
  page,
}) => {
  await page.goto("/studio?template=harness");
  await expect(
    page.getByRole("heading", { name: "Muses Studio" }),
  ).toBeVisible();

  const startResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio/workflow-runs") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Generate Check" }).click();
  const publication = await startResponse;
  expect(publication.status()).toBe(202);
  const publicationBody = (await publication.json()) as { runId: string };

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("waiting");
  const waitingResponse = await page.request.get(
    `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
  );
  const waiting = (await waitingResponse.json()) as {
    suspension: {
      id: string;
      candidateAssets: Array<{ assetId: string }>;
    };
  };

  const wrongWorkspaceCancellation = await page.request.delete(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId: "another-workspace",
        runId: publicationBody.runId,
        idempotencyKey: `workflow-cancel-wrong:${publicationBody.runId}`,
      },
    },
  );
  expect(wrongWorkspaceCancellation.status()).toBe(404);

  const cancellationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio/workflow-runs") &&
      response.request().method() === "DELETE",
  );
  await page.getByTestId("durable-run-cancel").click();
  const cancellation = await cancellationResponse;
  const cancellationKey = `workflow-cancel:${publicationBody.runId}`;
  expect(cancellation.status()).toBe(202);
  expect(await cancellation.json()).toMatchObject({
    accepted: true,
    idempotencyKey: cancellationKey,
    idempotentReplay: false,
  });

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("cancelled");
  const cancelledResponse = await page.request.get(
    `/api/studio/workflow-runs?runId=${publicationBody.runId}&workspaceId=${workspaceId}`,
  );
  const cancelled = await cancelledResponse.json();
  expect(cancelled).toMatchObject({
    sdkStatus: "cancelled",
    status: "cancelled",
    events: expect.arrayContaining([
      expect.objectContaining({ type: "node.waiting", nodeId: "selector-1" }),
    ]),
  });
  expect(cancelled.suspension).toBeUndefined();
  await expect(page.getByTestId("durable-run-panel")).toContainText(
    "Cancelled",
  );
  await expect(page.getByTestId("durable-run-suspension")).toHaveCount(0);
  await expect(page.getByTestId("durable-run-cancel")).toHaveCount(0);

  const replayedCancellation = await page.request.delete(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        runId: publicationBody.runId,
        idempotencyKey: cancellationKey,
        reason: "user-requested",
      },
    },
  );
  expect(replayedCancellation.status()).toBe(202);
  expect(await replayedCancellation.json()).toMatchObject({
    accepted: true,
    idempotentReplay: true,
  });

  const conflictingCancellation = await page.request.delete(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        runId: publicationBody.runId,
        idempotencyKey: cancellationKey,
        reason: "different-reason",
      },
    },
  );
  expect(conflictingCancellation.status()).toBe(409);
  expect(await conflictingCancellation.json()).toMatchObject({
    accepted: false,
    error: "idempotency-key-conflict",
  });

  const newCancellation = await page.request.delete(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        runId: publicationBody.runId,
        idempotencyKey: `${cancellationKey}:new-mutation`,
      },
    },
  );
  expect(newCancellation.status()).toBe(409);

  const resumeAfterCancellation = await page.request.patch(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        runId: publicationBody.runId,
        suspensionId: waiting.suspension.id,
        selectedAssetId: waiting.suspension.candidateAssets[0].assetId,
        idempotencyKey: `resume-cancelled:${publicationBody.runId}`,
      },
    },
  );
  expect(resumeAfterCancellation.status()).toBe(404);

  await page.reload();
  await expect(page.getByTestId("durable-run-panel")).toContainText(
    "Cancelled",
  );
  await expect(page.getByTestId("durable-run-suspension")).toHaveCount(0);
});

test("durable failures use bounded attempts, terminal timeouts, and new-run retries", async ({
  page,
}) => {
  await page.goto("/studio?template=harness");
  await expect(
    page.getByRole("heading", { name: "Muses Studio" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => Boolean(window.localStorage.getItem(key)),
        studioWorkspaceStorageKey(workspaceId, true),
      ),
    )
    .toBe(true);
  const publication = {
    workspaceId,
    target: await publishDurableHarness(page),
  };

  const permanentStart = await page.request.post("/api/studio/workflow-runs", {
    headers: { "x-muses-workflow-harness": "permanent-failure" },
    data: {
      ...publication,
      idempotencyKey: `failure-permanent:${Date.now()}`,
    },
  });
  expect(permanentStart.status()).toBe(202);
  const permanentRunId = ((await permanentStart.json()) as { runId: string })
    .runId;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${permanentRunId}&workspaceId=${publication.workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("failed");
  const permanentProjection = await page.request.get(
    `/api/studio/workflow-runs?runId=${permanentRunId}&workspaceId=${publication.workspaceId}`,
  );
  const permanent = (await permanentProjection.json()) as {
    failure: { category: string; retryable: boolean; attempts: number };
    attempts: Array<{
      nodeId: string;
      attempt: number;
      status: string;
    }>;
    events: Array<{ type: string; nodeId?: string; attempt?: number }>;
  };
  expect(permanent.failure).toMatchObject({
    category: "permanent",
    retryable: false,
    attempts: 1,
  });
  expect(permanent.attempts).toContainEqual(
    expect.objectContaining({
      nodeId: "image-generator-1",
      attempt: 1,
      status: "failed",
    }),
  );
  expect(
    permanent.events.filter(
      (event) =>
        event.type === "node.attempt.started" &&
        event.nodeId === "image-generator-1",
    ),
  ).toHaveLength(1);
  const permanentRetry = await page.request.post("/api/studio/workflow-runs", {
    data: {
      workspaceId: publication.workspaceId,
      retryOfRunId: permanentRunId,
      idempotencyKey: `workflow-retry:${permanentRunId}`,
    },
  });
  expect(permanentRetry.status()).toBe(409);

  const transientStart = await page.request.post("/api/studio/workflow-runs", {
    headers: { "x-muses-workflow-harness": "transient-recovery" },
    data: {
      ...publication,
      idempotencyKey: `failure-transient-recovery:${Date.now()}`,
    },
  });
  expect(transientStart.status()).toBe(202);
  const transientRunId = ((await transientStart.json()) as { runId: string })
    .runId;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${transientRunId}&workspaceId=${publication.workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("waiting");
  const transientProjection = await page.request.get(
    `/api/studio/workflow-runs?runId=${transientRunId}&workspaceId=${publication.workspaceId}`,
  );
  const transient = (await transientProjection.json()) as {
    attempts: Array<{
      nodeId: string;
      attempt: number;
      status: string;
    }>;
    events: Array<{ type: string; nodeId?: string; attempt?: number }>;
  };
  expect(transient.attempts).toContainEqual(
    expect.objectContaining({
      nodeId: "image-generator-1",
      attempt: 3,
      status: "succeeded",
    }),
  );
  expect(
    transient.events
      .filter(
        (event) =>
          event.type === "node.attempt.failed" &&
          event.nodeId === "image-generator-1",
      )
      .map((event) => event.attempt),
  ).toEqual([1, 2]);
  const transientCancellation = await page.request.delete(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId: publication.workspaceId,
        runId: transientRunId,
        idempotencyKey: `workflow-cancel:${transientRunId}`,
        reason: "test-cleanup",
      },
    },
  );
  expect(transientCancellation.status()).toBe(202);

  const exhaustedStart = await page.request.post("/api/studio/workflow-runs", {
    headers: { "x-muses-workflow-harness": "transient-exhaustion" },
    data: {
      ...publication,
      idempotencyKey: `failure-transient-exhaustion:${Date.now()}`,
    },
  });
  expect(exhaustedStart.status()).toBe(202);
  const exhaustedRunId = ((await exhaustedStart.json()) as { runId: string })
    .runId;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${exhaustedRunId}&workspaceId=${publication.workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("failed");
  const exhaustedProjection = await page.request.get(
    `/api/studio/workflow-runs?runId=${exhaustedRunId}&workspaceId=${publication.workspaceId}`,
  );
  const exhausted = (await exhaustedProjection.json()) as {
    failure: {
      category: string;
      retryable: boolean;
      attempts: number;
      maxAttempts: number;
    };
    attempts: Array<{
      nodeId: string;
      attempt: number;
      status: string;
    }>;
    events: Array<{ type: string; nodeId?: string; attempt?: number }>;
  };
  expect(exhausted.failure).toMatchObject({
    category: "transient-exhausted",
    retryable: true,
    attempts: 3,
    maxAttempts: 3,
  });
  expect(exhausted.attempts).toContainEqual(
    expect.objectContaining({
      nodeId: "image-generator-1",
      attempt: 3,
      status: "failed",
    }),
  );
  expect(
    exhausted.events
      .filter(
        (event) =>
          event.type === "node.attempt.started" &&
          event.nodeId === "image-generator-1",
      )
      .map((event) => event.attempt),
  ).toEqual([1, 2, 3]);

  const timeoutStart = await page.request.post("/api/studio/workflow-runs", {
    headers: { "x-muses-workflow-harness": "selector-timeout" },
    data: {
      ...publication,
      idempotencyKey: `failure-selector-timeout:${Date.now()}`,
    },
  });
  expect(timeoutStart.status()).toBe(202);
  const timeoutRunId = ((await timeoutStart.json()) as { runId: string }).runId;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${timeoutRunId}&workspaceId=${publication.workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("waiting");
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${timeoutRunId}&workspaceId=${publication.workspaceId}`,
      );
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe("failed");
  const timedOutProjection = await page.request.get(
    `/api/studio/workflow-runs?runId=${timeoutRunId}&workspaceId=${publication.workspaceId}`,
  );
  expect(await timedOutProjection.json()).toMatchObject({
    status: "failed",
    failure: {
      code: "human-input-timeout",
      category: "timeout",
      retryable: true,
      nodeId: "selector-1",
    },
  });

  await page.evaluate(
    ({ key, workspaceId, runId }) => {
      window.localStorage.setItem(key, JSON.stringify({ workspaceId, runId }));
    },
    {
      key: studioLastRunStorageKey(workspaceId, true),
      workspaceId: publication.workspaceId,
      runId: timeoutRunId,
    },
  );
  await page.reload();
  await expect(page.getByTestId("durable-run-failure")).toContainText(
    'Selector node "selector-1" timed out while waiting for human input.',
  );
  await expect(page.getByTestId("durable-run-failure")).not.toContainText(
    "human-input-timeout",
  );
  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio/workflow-runs") &&
      response.request().method() === "POST" &&
      response.request().postData()?.includes(timeoutRunId) === true,
  );
  await page.getByTestId("durable-run-retry").click();
  const retried = await retryResponse;
  expect(retried.status()).toBe(202);
  const retriedBody = (await retried.json()) as {
    runId: string;
    retryOfRunId: string;
    idempotentReplay: boolean;
  };
  expect(retriedBody.runId).not.toBe(timeoutRunId);
  expect(retriedBody).toMatchObject({
    retryOfRunId: timeoutRunId,
    idempotentReplay: false,
  });
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/studio/workflow-runs?runId=${retriedBody.runId}&workspaceId=${publication.workspaceId}`,
      );
      const body = (await response.json()) as { retryOfRunId?: string };
      return body.retryOfRunId;
    })
    .toBe(timeoutRunId);

  const replayedRetry = await page.request.post("/api/studio/workflow-runs", {
    data: {
      workspaceId: publication.workspaceId,
      retryOfRunId: timeoutRunId,
      idempotencyKey: `workflow-retry:${timeoutRunId}`,
    },
  });
  expect(replayedRetry.status()).toBe(202);
  expect(await replayedRetry.json()).toMatchObject({
    runId: retriedBody.runId,
    retryOfRunId: timeoutRunId,
    idempotentReplay: true,
  });
  const immutableSource = await page.request.get(
    `/api/studio/workflow-runs?runId=${timeoutRunId}&workspaceId=${publication.workspaceId}`,
  );
  expect(await immutableSource.json()).toMatchObject({
    runId: timeoutRunId,
    status: "failed",
    failure: { code: "human-input-timeout" },
  });
});

test("an output port continues with compatible nodes and commits the typed edge", async ({
  page,
}) => {
  await page.goto("/studio?template=harness");

  const startNode = page.getByTestId("workflow-node-start-1");
  await startNode.getByRole("button", { name: "Continue from Prompt" }).click();

  const library = page.getByTestId("studio-node-library");
  await expect(library).toHaveAttribute("data-contextual", "true");
  await expect(
    library.getByRole("button", { name: "Add Generate image" }),
  ).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Add Human review" }),
  ).toHaveCount(0);
  await expect(
    library.getByRole("button", { name: "Add Design canvas" }),
  ).toHaveCount(0);

  await library.getByRole("button", { name: "Add Generate image" }).click();

  const continuedNode = page.getByTestId("workflow-node-image-generator-10");
  await expect(continuedNode).toBeVisible();
  await expect(continuedNode).toContainText("Start · Prompt");

  await expect
    .poll(() =>
      page.evaluate(
        (key) => {
          const raw = window.localStorage.getItem(key);
          return raw
            ? JSON.parse(raw)
                .commandLog?.slice(-2)
                .map((entry: { payloadType: string }) => entry.payloadType)
            : null;
        },
        studioWorkspaceStorageKey(workspaceId, true),
      ),
    )
    .toEqual(["workflow.node.add", "workflow.edge.add"]);

  const savedWorkspace = await page.evaluate(
    (key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    },
    studioWorkspaceStorageKey(workspaceId, true),
  );
  expect(savedWorkspace?.workflow?.edges).toContainEqual(
    expect.objectContaining({
      sourceNodeId: "start-1",
      sourcePortId: "prompt",
      targetNodeId: "image-generator-10",
      targetPortId: "prompt",
      kind: "dataflow",
    }),
  );

  await page.reload();
  await page
    .getByTestId("workflow-node-start-1")
    .getByRole("button", { name: "Continue from Prompt" })
    .click();
  await page
    .getByTestId("studio-node-library")
    .getByRole("button", { name: "Add Generate image" })
    .click();
  await expect(
    page.getByTestId("workflow-node-image-generator-11"),
  ).toContainText("Start · Prompt");
});

test("Start and End are protected singletons and Start owns typed inputs", async ({
  page,
}) => {
  await page.goto("/studio?template=harness");

  const start = page.getByTestId("workflow-node-start-1");
  const end = page.getByTestId("workflow-node-end-1");
  await start.click();
  await page.keyboard.press("Delete");
  await expect(start).toBeVisible();
  await page.getByRole("button", { name: /^\d+%$/ }).click();
  await end.click();
  await page.keyboard.press("Backspace");
  await expect(end).toBeVisible();

  await page.getByRole("button", { name: "Add node" }).click();
  const library = page.getByTestId("studio-node-library");
  await expect(library.getByRole("button", { name: "Add Start" })).toHaveCount(
    0,
  );
  await expect(library.getByRole("button", { name: "Add End" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close node library" }).click();

  await start.click();
  await page.getByRole("button", { name: "Add input" }).click();
  const name = page.getByRole("textbox", { name: "Input name" }).last();
  await name.fill("slide_count");
  await name.press("Tab");
  await page
    .getByRole("combobox", { name: "Input type" })
    .last()
    .selectOption("number");

  await expect
    .poll(() =>
      page.evaluate(
        (key) => {
          const raw = window.localStorage.getItem(key);
          if (!raw) return null;
          const workspace = JSON.parse(raw);
          return workspace.workflow.nodes
            .find((node: { id: string }) => node.id === "start-1")
            ?.outputPorts.find((port: { id: string }) => port.id === "input_2");
        },
        studioWorkspaceStorageKey(workspaceId, true),
      ),
    )
    .toMatchObject({
      id: "input_2",
      label: "slide_count",
      valueType: "number",
    });
});

test("professional canvas keeps a node under the pointer while dragging", async ({
  page,
}) => {
  await page.goto("/studio?template=harness");
  await page.getByRole("button", { name: "Close configuration panel" }).click();
  await page.waitForTimeout(300);

  const node = page.getByTestId("workflow-node-image-generator-1");
  const before = await node.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;

  await page.mouse.move(before.x + before.width / 2, before.y + 18);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 8, before.y + 18 + 4);
  await page.mouse.move(before.x + before.width / 2 + 128, before.y + 18 + 40, {
    steps: 2,
  });

  const during = await node.boundingBox();
  expect(during).not.toBeNull();
  expect((during?.x || 0) - before.x).toBeGreaterThan(70);
  await page.mouse.up();
});

test("Workflow Catalog rejects mutable, missing, disabled, and cross-workspace invocation targets", async ({
  page,
}) => {
  const first = await publishDurableHarnessPublication(page);
  const repeated = await publishDurableHarnessPublication(page);
  expect(repeated).toMatchObject({
    published: false,
    definition: first.definition,
    deployment: { deploymentId: first.deployment.deploymentId },
  });

  const layoutOnlyDraftRevision = await advanceWorkflowDraftLayoutRevision(
    first.definition.definitionId,
  );
  const layoutOnlyPublication = await page.request.post(
    "/api/studio/workflow-publications",
    {
      data: {
        workspaceId,
        definitionId: first.definition.definitionId,
        expectedDraftRevision: layoutOnlyDraftRevision,
        deploymentAlias: "production",
      },
    },
  );
  expect(layoutOnlyPublication.status()).toBe(200);
  expect(await layoutOnlyPublication.json()).toMatchObject({
    published: false,
    definition: first.definition,
    deployment: { deploymentId: first.deployment.deploymentId },
  });

  const invalidFixture = await page.request.post(
    "/api/studio/workflow-publications",
    {
      data: {
        workspaceId,
        definitionId: `${workspaceId}:not-the-durable-harness`,
        fixture: "durable-harness",
      },
    },
  );
  expect(invalidFixture.status()).toBe(422);
  expect(await invalidFixture.json()).toMatchObject({
    error: "workflow-publication-invalid",
  });
  await expectWorkflowDefinitionVersionIsImmutable(
    first.definition.definitionId,
    first.definition.version,
  );

  const mutableRequest = await page.request.post("/api/studio/workflow-runs", {
    data: {
      workspaceId,
      workflow: { id: "browser-owned-graph", nodes: [], edges: [] },
      idempotencyKey: `mutable-graph:${Date.now()}`,
    },
  });
  expect(mutableRequest.status()).toBe(400);
  expect(await mutableRequest.json()).toMatchObject({
    error: "invalid-workflow-invocation-request",
  });

  const missingDeployment = await page.request.post(
    "/api/studio/workflow-runs",
    {
      data: {
        workspaceId,
        target: {
          kind: "deployment",
          workspaceId,
          deploymentId: "mwdep_missing",
        },
        idempotencyKey: `missing-deployment:${Date.now()}`,
      },
    },
  );
  expect(missingDeployment.status()).toBe(404);
  expect(await missingDeployment.json()).toMatchObject({
    error: "workflow-deployment-not-found",
  });

  const crossWorkspace = await page.request.post("/api/studio/workflow-runs", {
    data: {
      workspaceId,
      target: {
        kind: "deployment",
        workspaceId: "mws_not_authorized",
        deploymentId: first.deployment.deploymentId,
      },
      idempotencyKey: `cross-workspace-deployment:${Date.now()}`,
    },
  });
  expect(crossWorkspace.status()).toBe(403);
  expect(await crossWorkspace.json()).toMatchObject({
    error: "workflow-workspace-mismatch",
  });

  await setWorkflowDeploymentStatus(first.deployment.deploymentId, "disabled");
  try {
    const disabledDeployment = await page.request.post(
      "/api/studio/workflow-runs",
      {
        data: {
          workspaceId,
          target: {
            kind: "deployment",
            workspaceId,
            deploymentId: first.deployment.deploymentId,
          },
          idempotencyKey: `disabled-deployment:${Date.now()}`,
        },
      },
    );
    expect(disabledDeployment.status()).toBe(409);
    expect(await disabledDeployment.json()).toMatchObject({
      error: "workflow-deployment-disabled",
    });
  } finally {
    await setWorkflowDeploymentStatus(first.deployment.deploymentId, "active");
  }
});

test("MusesAgent discovers, inspects, and invokes one exact published workflow", async ({
  page,
}) => {
  test.setTimeout(4 * 60_000);
  const publication = await publishDurableHarnessPublication(page);
  const deploymentId = publication.deployment.deploymentId;
  const started = await page.request.post("/api/studio/agent-runs", {
    data: {
      workspaceId,
      prompt: [
        "Use the Muses workflow tools in this exact order.",
        "First call workflow.list.",
        `Then call workflow.inspect for deploymentId ${deploymentId}.`,
        `Then call workflow.invoke for deploymentId ${deploymentId} with empty inputs.`,
        "Do not call image.generate. After workflow.invoke succeeds, report its runId and stop.",
      ].join(" "),
      idempotencyKey: `agent-workflow-invoke:${Date.now()}`,
    },
  });
  expect(started.status()).toBe(202);
  const startedBody = (await started.json()) as { run: { runId: string } };
  const agentRunId = startedBody.run.runId;
  expect(agentRunId).toMatch(/^arun_/);

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${agentRunId}`,
        );
        const body = (await response.json()) as {
          run?: {
            status?: string;
            pendingApproval?: {
              approvalId: string;
              toolCall: { name: string };
            };
          };
        };
        return body.run?.status === "waiting-approval"
          ? body.run.pendingApproval?.toolCall.name
          : undefined;
      },
      { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe("workflow.invoke");
  const approvalProjection = await page.request.get(
    `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${agentRunId}`,
  );
  const approvalId = (
    (await approvalProjection.json()) as {
      run: { pendingApproval: { approvalId: string } };
    }
  ).run.pendingApproval.approvalId;
  const approved = await page.request.patch("/api/studio/agent-runs", {
    data: {
      action: "approve",
      workspaceId,
      runId: agentRunId,
      approvalId,
      decision: "approved",
      reason: "Approved by the A9 callable workflow evidence.",
    },
  });
  expect(approved.status()).toBe(200);

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${agentRunId}`,
        );
        const body = (await response.json()) as {
          run?: { status?: string };
        };
        return body.run?.status;
      },
      { timeout: 3 * 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe("completed");

  const completedResponse = await page.request.get(
    `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${agentRunId}`,
  );
  expect(completedResponse.ok()).toBeTruthy();
  const completed = (await completedResponse.json()) as {
    run: {
      context: {
        messages: Array<{
          role: string;
          toolName?: string;
          content: string;
        }>;
      };
    };
  };
  const toolMessages = completed.run.context.messages.filter(
    ({ role }) => role === "tool",
  );
  expect(toolMessages.map(({ toolName }) => toolName)).toEqual(
    expect.arrayContaining([
      "workflow.list",
      "workflow.inspect",
      "workflow.invoke",
    ]),
  );
  const invocationMessage = [...toolMessages]
    .reverse()
    .find(({ toolName }) => toolName === "workflow.invoke");
  expect(invocationMessage).toBeTruthy();
  const invocation = JSON.parse(invocationMessage!.content) as {
    accepted: boolean;
    runId: string;
    definition: TestWorkflowPublication["definition"];
    deploymentId: string;
  };
  expect(invocation).toMatchObject({
    accepted: true,
    definition: publication.definition,
    deploymentId,
  });
  expect(invocation.runId).toMatch(/^wrun_/);
  expect(await readWorkflowInvocationAudit(invocation.runId)).toMatchObject({
    definitionId: publication.definition.definitionId,
    definitionVersion: publication.definition.version,
    deploymentId,
    callerKind: "agent",
    callerId: agentRunId,
  });

  const waiting = await page.request.get(
    `/api/studio/workflow-runs?workspaceId=${workspaceId}&runId=${invocation.runId}`,
  );
  expect(await waiting.json()).toMatchObject({
    runId: invocation.runId,
    status: "waiting",
  });
  const cancelled = await page.request.delete("/api/studio/workflow-runs", {
    data: {
      workspaceId,
      runId: invocation.runId,
      idempotencyKey: `agent-workflow-cleanup:${invocation.runId}`,
      reason: "A8 Agent invocation evidence complete",
    },
  });
  expect(cancelled.status()).toBe(202);
  await expect
    .poll(
      async () =>
        (await readWorkflowInvocationAudit(invocation.runId)).workflowStatus,
    )
    .toBe("cancelled");
});

test("Agent cancellation stops linked Workflow SDK children and replays one receipt", async ({
  page,
}) => {
  test.setTimeout(2 * 60_000);
  const target = await publishDurableHarness(page);
  const agentRunId = await createActiveAgentCancellationFixture(workspaceId);
  let workflowRunId: string | null = null;
  try {
    const started = await page.request.post("/api/studio/workflow-runs", {
      data: {
        workspaceId,
        target,
        idempotencyKey: `agent-cancel-child:${Date.now()}`,
      },
    });
    expect(started.status()).toBe(202);
    workflowRunId = ((await started.json()) as { runId: string }).runId;
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/studio/workflow-runs?workspaceId=${workspaceId}&runId=${workflowRunId}`,
        );
        return ((await response.json()) as { status?: string }).status;
      })
      .toBe("waiting");
    await linkWorkflowRunToAgent(workflowRunId, agentRunId);

    const request = {
      action: "cancel",
      workspaceId,
      runId: agentRunId,
      idempotencyKey: `agent-cancel:${agentRunId}`,
      reason: "A9 linked Workflow SDK cancellation fixture",
    };
    const cancelled = await page.request.patch("/api/studio/agent-runs", {
      data: request,
    });
    expect(cancelled.status()).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      accepted: true,
      run: { status: "cancelled" },
      cancellation: {
        idempotentReplay: false,
        summary: {
          children: [
            {
              runId: workflowRunId,
              state: "cancelled",
              knownCreditMicros: "0",
            },
          ],
          reviewRequired: false,
        },
      },
    });
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/studio/workflow-runs?workspaceId=${workspaceId}&runId=${workflowRunId}`,
        );
        return ((await response.json()) as { sdkStatus?: string }).sdkStatus;
      })
      .toBe("cancelled");

    const replay = await page.request.patch("/api/studio/agent-runs", {
      data: request,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({
      accepted: true,
      cancellation: { idempotentReplay: true },
    });
    const conflict = await page.request.patch("/api/studio/agent-runs", {
      data: {
        ...request,
        idempotencyKey: `${request.idempotencyKey}:different`,
        reason: "Different cancellation identity",
      },
    });
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "idempotency-key-conflict",
    });
    expect(await readAgentCancellationFacts(agentRunId)).toEqual({
      agentStatus: "cancelled",
      childStatus: "cancelled",
      receipts: 1,
      cancellationEvents: 1,
    });
  } finally {
    await restoreWorkflowCallerAndDeleteAgentFixture(agentRunId, workflowRunId);
  }
});

test("Agent trace is Workspace-scoped and excludes sensitive payloads", async ({
  page,
}) => {
  const initialized = await page.request.get(
    `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
  );
  expect(initialized.ok()).toBeTruthy();
  const agentRunId = await createActiveAgentCancellationFixture(workspaceId);
  try {
    const response = await page.request.get(
      `/api/studio/agent-runs/trace?workspaceId=${workspaceId}&runId=${agentRunId}`,
    );
    expect(response.ok()).toBeTruthy();
    const trace = (await response.json()) as Record<string, unknown>;
    expect(trace).toMatchObject({
      schemaVersion: "agent-trace-v1",
      traceId: agentRunId,
      workspaceId,
      run: { runId: agentRunId, status: "running" },
      isolation: { state: "legacy-unpinned" },
      agentEvents: [],
      modelCalls: [],
      toolCommands: [],
      workflowRuns: [],
      assets: [],
      reservations: [],
      ledgerEntries: [],
    });
    expect(collectObjectKeys(trace)).not.toEqual(
      expect.arrayContaining([
        "prompt",
        "content",
        "input",
        "output",
        "result",
        "objectKey",
        "authRef",
        "credentialRefs",
        "initiatedByEmail",
      ]),
    );

    const forgedWorkspace = await page.request.get(
      `/api/studio/agent-runs/trace?workspaceId=mws_forged_${Date.now()}&runId=${agentRunId}`,
    );
    expect(forgedWorkspace.status()).toBe(404);

    const foreignRun = await page.request.get(
      `/api/studio/agent-runs/trace?workspaceId=${workspaceId}&runId=arun_foreign_${Date.now()}`,
    );
    expect(foreignRun.status()).toBe(404);
  } finally {
    await deleteAgentDriverFixture(agentRunId);
  }
});

test("insufficient credits reject a real image run before provider execution", async ({
  page,
}) => {
  await page.goto("/studio?mode=professional");
  await expect(
    page.getByTestId("workflow-node-image-generator-1"),
  ).toBeVisible();
  const target = await publishDefaultWorkflow(page);

  await drainStudioCredits();
  const idempotencyKey = `insufficient-credit:${Date.now()}`;
  const response = await page.request.post("/api/studio/workflow-runs", {
    data: { workspaceId, target, idempotencyKey },
  });
  expect(response.status()).toBe(402);
  expect(await response.json()).toMatchObject({
    accepted: false,
    error: "insufficient-credits",
    billing: { requiredMicros: "1000000", availableMicros: "0" },
  });
  expect(await countWorkflowSubmissions(idempotencyKey)).toBe(0);
});

function studioWorkspaceStorageKey(id: string, harness: boolean) {
  return `muses.platform-core-alpha.workspace.${id}${harness ? ".harness" : ""}`;
}

type TestWorkflowPublication = {
  published: boolean;
  definition: {
    workspaceId: string;
    definitionId: string;
    version: number;
    schemaVersion: "0.3.0-draft";
  };
  deployment: {
    workspaceId: string;
    deploymentId: string;
    definition: TestWorkflowPublication["definition"];
  };
};

async function publishDurableHarnessPublication(page: Page) {
  const gateway = await page.request.get(
    `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
  );
  expect(gateway.ok()).toBeTruthy();
  const response = await page.request.post(
    "/api/studio/workflow-publications",
    {
      data: {
        workspaceId,
        definitionId: `${workspaceId}:durable-harness`,
        fixture: "durable-harness",
        deploymentAlias: "production",
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as TestWorkflowPublication;
}

async function publishDurableHarness(page: Page) {
  const publication = await publishDurableHarnessPublication(page);
  return {
    kind: "deployment" as const,
    workspaceId,
    deploymentId: publication.deployment.deploymentId,
  };
}

async function publishDefaultWorkflow(page: Page) {
  const gatewayResponse = await page.request.get(
    `/api/studio/operation-gateway?workspaceId=${workspaceId}`,
  );
  expect(gatewayResponse.ok()).toBeTruthy();
  const gateway =
    (await gatewayResponse.json()) as OperationGatewayTestSnapshot;
  const draft = gateway.workflowDefinitions[0];
  const response = await page.request.post(
    "/api/studio/workflow-publications",
    {
      data: {
        workspaceId,
        definitionId: draft.definitionId,
        expectedDraftRevision: draft.revision,
        deploymentAlias: "production",
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const publication = (await response.json()) as TestWorkflowPublication;
  return {
    kind: "deployment" as const,
    workspaceId,
    deploymentId: publication.deployment.deploymentId,
  };
}

type OperationGatewayTestSnapshot = {
  workspaceId: string;
  project: { id: string };
  professionalWorkspace: {
    professionalWorkspaceId: string;
    revision: number;
  };
  workflowDefinitions: Array<{
    definitionId: string;
    revision: number;
    document: {
      workflow: {
        nodes: Array<{ id: string; position: { x: number; y: number } }>;
      };
    };
  }>;
};

type OperationGatewayTestResult = {
  accepted: boolean;
  duplicate: boolean;
  resultingRevision: number;
  snapshot: OperationGatewayTestSnapshot;
};

type AgentDriverFixture = {
  runId: string;
  attemptId: string;
};

async function createExpiredAgentDriverFixture(
  currentWorkspaceId: string,
  driverRunId: string | null = null,
): Promise<AgentDriverFixture> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const project = await client.query<{
      projectId: string;
      canvasId: string | null;
    }>(
      `
        select
          project.id as "projectId",
          canvas.id as "canvasId"
        from muses_project project
        left join muses_creative_canvas canvas
          on canvas.workspace_id = project.workspace_id
         and canvas.project_id = project.id
        where project.workspace_id = $1
        order by project.created_at
        limit 1
      `,
      [currentWorkspaceId],
    );
    const row = project.rows[0];
    expect(row?.projectId).toBeTruthy();
    const runId = `arun_${randomBytes(16).toString("hex")}`;
    const attemptId = `adriver_fixture_${randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    const snapshot = {
      schemaVersion: "0.1.0-draft",
      runId,
      session: {
        schemaVersion: "0.1.0-draft",
        sessionId: `asession_${randomBytes(12).toString("hex")}`,
        workspaceId: currentWorkspaceId,
        projectId: row!.projectId,
        canvasId: row!.canvasId || undefined,
        createdAt: now,
        updatedAt: now,
      },
      profile: {
        profileId: "a9-recovery-fixture",
        version: "1.0.0",
        modelRef: "test/no-model",
        instructions: "This is a sanitized A9 recovery fixture.",
        toolNames: [],
        skillRefs: [],
        mcpConnectionRefs: [],
      },
      status: "queued",
      revision: 0,
      turn: 0,
      context: {
        version: 1,
        messages: [],
        artifactRefs: [],
        createdAt: now,
      },
      budget: {
        limit: {
          maxTurns: 1,
          maxModelCalls: 1,
          maxToolCalls: 1,
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          maxCreditMicros: "0",
          maxDurationMs: 900000,
        },
        usage: {
          turns: 1,
          modelCalls: 1,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          creditMicros: "0",
          startedAt: now,
        },
      },
      permissions: [],
      metadata: { fixture: "a9-driver-recovery" },
      pendingMessages: [],
      pendingToolCalls: [],
      createdAt: now,
      updatedAt: now,
    };
    await client.query(
      `
        insert into muses_agent_run (
          id, workspace_id, project_id, canvas_id, session_id,
          profile_id, profile_version, model_ref, status, revision,
          snapshot, driver_status, driver_run_id, driver_attempt_id,
          driver_lease_expires_at, driver_last_heartbeat_at,
          created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, now() - interval '1 minute',
          now() - interval '2 minutes', $15, $15
        )
      `,
      [
        runId,
        currentWorkspaceId,
        row!.projectId,
        row!.canvasId,
        snapshot.session.sessionId,
        snapshot.profile.profileId,
        snapshot.profile.version,
        snapshot.profile.modelRef,
        snapshot.status,
        snapshot.revision,
        JSON.stringify(snapshot),
        driverRunId ? "running" : "starting",
        driverRunId,
        attemptId,
        now,
      ],
    );
    return { runId, attemptId };
  } finally {
    await client.end();
  }
}

async function expectRecoveredAgentDriver(page: Page, runId: string) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${runId}`,
        );
        const body = (await response.json()) as {
          run?: { status?: string };
          driver?: { status?: string };
        };
        return {
          run: body.run?.status,
          driver: body.driver?.status,
        };
      },
      { timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .toEqual({ run: "failed", driver: "completed" });
}

async function readAgentDriverFixtureFacts(runId: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{
      agentStatus: string;
      driverStatus: string;
      driverAttemptId: string | null;
      driverRunId: string | null;
      childWorkflowRuns: string;
      generatedAssets: string;
      creditReservations: string;
      modelEvents: string;
    }>(
      `
        select
          agent.status as "agentStatus",
          agent.driver_status as "driverStatus",
          agent.driver_attempt_id as "driverAttemptId",
          agent.driver_run_id as "driverRunId",
          (select count(*) from muses_workflow_run
            where caller_kind = 'agent' and caller_id = agent.id
          ) as "childWorkflowRuns",
          (select count(*) from muses_generated_asset where workflow_run_id in (
            select sdk_run_id from muses_workflow_run
            where caller_kind = 'agent' and caller_id = agent.id
          )) as "generatedAssets",
          (select count(*) from credit_reservation where submission_id in (
            select id from muses_workflow_run
            where caller_kind = 'agent' and caller_id = agent.id
          )) as "creditReservations",
          (select count(*) from muses_agent_event where run_id = agent.id and type = 'model.completed') as "modelEvents"
        from muses_agent_run agent
        where agent.id = $1
      `,
      [runId],
    );
    const row = result.rows[0];
    return {
      ...row,
      childWorkflowRuns: Number(row?.childWorkflowRuns || 0),
      generatedAssets: Number(row?.generatedAssets || 0),
      creditReservations: Number(row?.creditReservations || 0),
      modelEvents: Number(row?.modelEvents || 0),
    };
  } finally {
    await client.end();
  }
}

async function deleteAgentDriverFixture(runId: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    await client.query("delete from muses_agent_run where id = $1", [runId]);
  } finally {
    await client.end();
  }
}

async function createActiveAgentCancellationFixture(
  currentWorkspaceId: string,
) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const target = (
      await client.query<{ projectId: string; canvasId: string | null }>(
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
        [currentWorkspaceId],
      )
    ).rows[0];
    expect(target?.projectId).toBeTruthy();
    const runId = `arun_cancel_${randomBytes(16).toString("hex")}`;
    const now = new Date().toISOString();
    const snapshot = {
      schemaVersion: "0.1.0-draft",
      runId,
      session: {
        schemaVersion: "0.1.0-draft",
        sessionId: `asession_cancel_${randomBytes(12).toString("hex")}`,
        workspaceId: currentWorkspaceId,
        projectId: target!.projectId,
        canvasId: target!.canvasId || undefined,
        createdAt: now,
        updatedAt: now,
      },
      profile: {
        profileId: "a9-cancellation-fixture",
        version: "1.0.0",
        modelRef: "test/no-model",
        instructions: "Sanitized linked cancellation fixture.",
        toolNames: [],
        skillRefs: [],
        mcpConnectionRefs: [],
      },
      status: "running",
      revision: 0,
      turn: 0,
      context: {
        version: 1,
        messages: [],
        artifactRefs: [],
        createdAt: now,
      },
      budget: {
        limit: {
          maxTurns: 1,
          maxModelCalls: 1,
          maxToolCalls: 1,
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          maxCreditMicros: "0",
          maxDurationMs: 900000,
        },
        usage: {
          turns: 0,
          modelCalls: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          creditMicros: "0",
          startedAt: now,
        },
      },
      permissions: [],
      metadata: { fixture: "a9-linked-cancellation" },
      pendingMessages: [],
      pendingToolCalls: [],
      createdAt: now,
      updatedAt: now,
    };
    await client.query(
      `
        insert into muses_agent_run (
          id, workspace_id, project_id, canvas_id, session_id,
          profile_id, profile_version, model_ref, status, revision,
          snapshot, driver_status, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'running', 0, $9, 'unclaimed', $10, $10)
      `,
      [
        runId,
        currentWorkspaceId,
        target!.projectId,
        target!.canvasId,
        snapshot.session.sessionId,
        snapshot.profile.profileId,
        snapshot.profile.version,
        snapshot.profile.modelRef,
        JSON.stringify(snapshot),
        now,
      ],
    );
    return runId;
  } finally {
    await client.end();
  }
}

async function linkWorkflowRunToAgent(
  workflowRunId: string,
  agentRunId: string,
) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const updated = await client.query(
      `
        update muses_workflow_run
        set caller_kind = 'agent', caller_id = $2
        where sdk_run_id = $1
      `,
      [workflowRunId, agentRunId],
    );
    expect(updated.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

async function readAgentCancellationFacts(agentRunId: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const row = (
      await client.query<{
        agentStatus: string;
        childStatus: string;
        receipts: string;
        cancellationEvents: string;
      }>(
        `
          select
            agent.status as "agentStatus",
            child.status as "childStatus",
            (select count(*) from muses_agent_cancel_receipt
              where agent_run_id = agent.id) as receipts,
            (select count(*) from muses_agent_event
              where run_id = agent.id and type = 'run.cancelled') as "cancellationEvents"
          from muses_agent_run agent
          join muses_workflow_run child
            on child.caller_kind = 'agent' and child.caller_id = agent.id
          where agent.id = $1
        `,
        [agentRunId],
      )
    ).rows[0];
    return {
      agentStatus: row?.agentStatus,
      childStatus: row?.childStatus,
      receipts: Number(row?.receipts || 0),
      cancellationEvents: Number(row?.cancellationEvents || 0),
    };
  } finally {
    await client.end();
  }
}

async function countAgentModelCalls(agentRunId: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "select count(*)::text as count from muses_agent_model_call where run_id = $1",
      [agentRunId],
    );
    return Number(result.rows[0]?.count || 0);
  } finally {
    await client.end();
  }
}

async function readAgentDelegationContinuationFacts(
  rootRunId: string,
  delegationRunId: string,
) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const row = (
      await client.query<{
        receiptCount: string;
        receiptStatus: string | null;
        messageCommitted: boolean;
        rootModelCalls: string;
        imageReservations: string;
        imageLedgerEntries: string;
      }>(
        `
          select
            count(continuation.delegation_run_id)::text as "receiptCount",
            max(continuation.status) as "receiptStatus",
            coalesce(bool_or(continuation.message_committed_at is not null), false)
              as "messageCommitted",
            (select count(*)::text from muses_agent_model_call model_call
              where model_call.run_id = $1) as "rootModelCalls",
            (select count(*)::text
              from credit_reservation reservation
              join muses_workflow_run workflow
                on workflow.id = reservation.submission_id
              where workflow.caller_kind = 'agent'
                and workflow.caller_id in (
                  select task ->> 'childRunId'
                  from muses_agent_delegation_run delegation,
                    jsonb_array_elements(
                      delegation.record #> '{snapshot,tasks}'
                    ) task
                  where delegation.id = $2
                    and task ? 'childRunId'
                )) as "imageReservations",
            (select count(*)::text
              from credit_ledger_entry ledger
              where ledger.reservation_id in (
                select reservation.id
                from credit_reservation reservation
                join muses_workflow_run workflow
                  on workflow.id = reservation.submission_id
                where workflow.caller_kind = 'agent'
                  and workflow.caller_id in (
                    select task ->> 'childRunId'
                    from muses_agent_delegation_run delegation,
                      jsonb_array_elements(
                        delegation.record #> '{snapshot,tasks}'
                      ) task
                    where delegation.id = $2
                      and task ? 'childRunId'
                  )
              )) as "imageLedgerEntries"
          from muses_agent_delegation_continuation continuation
          where continuation.delegation_run_id = $2
        `,
        [rootRunId, delegationRunId],
      )
    ).rows[0];
    return {
      receiptCount: Number(row?.receiptCount || 0),
      receiptStatus: row?.receiptStatus || null,
      messageCommitted: Boolean(row?.messageCommitted),
      rootModelCalls: Number(row?.rootModelCalls || 0),
      imageReservations: Number(row?.imageReservations || 0),
      imageLedgerEntries: Number(row?.imageLedgerEntries || 0),
    };
  } finally {
    await client.end();
  }
}

async function readAgentDelegationCancellationFacts(
  rootRunId: string,
  delegationRunId: string,
) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const row = (
      await client.query<{
        rootStatus: string;
        rootTurn: string;
        delegationStatus: string;
        driverStatus: string;
        continuationStatus: string | null;
        continuationFailureCode: string | null;
        cancelledChildren: string;
        activeChildren: string;
        generatedAssets: string;
        envelopeStatus: string | null;
        rootModelCalls: string;
      }>(
        `
          select
            root.status as "rootStatus",
            (root.snapshot ->> 'turn') as "rootTurn",
            delegation.status as "delegationStatus",
            delegation.driver_status as "driverStatus",
            continuation.status as "continuationStatus",
            continuation.failure_code as "continuationFailureCode",
            (select count(*)::text
              from muses_agent_run child
              where child.id in (
                select task ->> 'childRunId'
                from jsonb_array_elements(
                  delegation.record #> '{snapshot,tasks}'
                ) task
                where task ? 'childRunId'
              ) and child.status = 'cancelled') as "cancelledChildren",
            (select count(*)::text
              from muses_agent_run child
              where child.id in (
                select task ->> 'childRunId'
                from jsonb_array_elements(
                  delegation.record #> '{snapshot,tasks}'
                ) task
                where task ? 'childRunId'
              ) and child.status in (
                'queued', 'running', 'waiting-approval', 'cancelling'
              )) as "activeChildren",
            (select count(*)::text
              from muses_generated_asset asset
              where asset.workflow_run_id in (
                select workflow.sdk_run_id
                from muses_workflow_run workflow
                where workflow.caller_kind = 'agent'
                  and workflow.caller_id in (
                    select task ->> 'childRunId'
                    from jsonb_array_elements(
                      delegation.record #> '{snapshot,tasks}'
                    ) task
                    where task ? 'childRunId'
                  )
              )) as "generatedAssets",
            (select reservation.status
              from muses_agent_delegation_budget_reservation reservation
              where reservation.delegation_run_id = delegation.id
                and reservation.scope = 'envelope') as "envelopeStatus",
            (select count(*)::text from muses_agent_model_call model_call
              where model_call.run_id = root.id) as "rootModelCalls"
          from muses_agent_delegation_run delegation
          join muses_agent_run root on root.id = $1
          left join muses_agent_delegation_continuation continuation
            on continuation.delegation_run_id = delegation.id
          where delegation.id = $2
        `,
        [rootRunId, delegationRunId],
      )
    ).rows[0];
    return {
      rootStatus: row?.rootStatus,
      rootTurn: Number(row?.rootTurn || 0),
      delegationStatus: row?.delegationStatus,
      driverStatus: row?.driverStatus,
      continuationStatus: row?.continuationStatus || null,
      continuationFailureCode: row?.continuationFailureCode || null,
      cancelledChildren: Number(row?.cancelledChildren || 0),
      activeChildren: Number(row?.activeChildren || 0),
      generatedAssets: Number(row?.generatedAssets || 0),
      envelopeStatus: row?.envelopeStatus || null,
      rootModelCalls: Number(row?.rootModelCalls || 0),
    };
  } finally {
    await client.end();
  }
}

async function restoreWorkflowCallerAndDeleteAgentFixture(
  agentRunId: string,
  workflowRunId: string | null,
) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    if (workflowRunId) {
      await client.query(
        `
          update muses_workflow_run
          set caller_kind = 'user', caller_id = submitted_by_user_id
          where sdk_run_id = $1 and caller_id = $2
        `,
        [workflowRunId, agentRunId],
      );
    }
    await client.query("delete from muses_agent_run where id = $1", [
      agentRunId,
    ]);
  } finally {
    await client.end();
  }
}

function studioLastRunStorageKey(id: string, harness: boolean) {
  return `muses.platform-core-alpha.last-durable-run.${id}${harness ? ".harness" : ""}`;
}

async function resetStudioUser() {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const user = await client.query<{ id: string }>(
      'select id from "user" where lower(email) = lower($1) limit 1',
      [studioEmail],
    );
    const userId = user.rows[0]?.id;
    if (!userId) return;
    await client.query('delete from "session" where "userId" = $1', [userId]);
    await client.query('delete from "account" where "userId" = $1', [userId]);
    await client.query("delete from verification where identifier like $1", [
      `%${studioEmail}%`,
    ]);
    await client.query('delete from "user" where id = $1', [userId]);
  } finally {
    await client.end();
  }
}

async function verifyStudioUser() {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const verified = await client.query(
      'update "user" set "emailVerified" = true, "updatedAt" = now() where lower(email) = lower($1)',
      [studioEmail],
    );
    expect(verified.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

async function readCurrentStudioAccountFacts() {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{
      memberships: string;
      personalWorkspaces: string;
      initialGrants: string;
    }>(
      `
        select
          count(distinct member.workspace_id) as memberships,
          count(distinct workspace.id) filter (where workspace.kind = 'personal') as "personalWorkspaces",
          count(distinct ledger.id) filter (
            where ledger.idempotency_key = 'workspace-initial-development-grant:v1'
          ) as "initialGrants"
        from "user" account_user
        left join muses_workspace_member member on member.user_id = account_user.id
        left join muses_workspace workspace on workspace.id = member.workspace_id
        left join credit_account credit on credit.workspace_id = workspace.id
        left join credit_ledger_entry ledger on ledger.account_id = credit.id
        where lower(account_user.email) = lower($1)
      `,
      [studioEmail],
    );
    const row = result.rows[0];
    return {
      memberships: Number(row.memberships),
      personalWorkspaces: Number(row.personalWorkspaces),
      initialGrants: Number(row.initialGrants),
    };
  } finally {
    await client.end();
  }
}

async function drainStudioCredits() {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    await client.query("begin");
    const account = (
      await client.query<{
        id: string;
        workspaceId: string;
        postedMicros: string;
        reservedMicros: string;
      }>(
        `
          select
            credit.id,
            credit.workspace_id as "workspaceId",
            credit.posted_balance_micros as "postedMicros",
            credit.reserved_balance_micros as "reservedMicros"
          from credit_account credit
          join muses_workspace_member member on member.workspace_id = credit.workspace_id
          join "user" account_user on account_user.id = member.user_id
          where lower(account_user.email) = lower($1)
          for update of credit
        `,
        [studioEmail],
      )
    ).rows[0];
    expect(account).toBeTruthy();
    expect(account.reservedMicros).toBe("0");
    const posted = BigInt(account.postedMicros);
    if (posted > BigInt(0)) {
      const now = Date.now();
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
            idempotency_key,
            reason,
            metadata
          )
          values ($1, $2, $3, 'adjustment', $4, 0, 0, 0, $5, $6, '{}'::jsonb)
        `,
        [
          `mle_e2e_drain_${now}`,
          account.id,
          account.workspaceId,
          (-posted).toString(),
          `e2e-drain:${now}`,
          "E2E insufficient-credit boundary",
        ],
      );
      await client.query(
        "update credit_account set posted_balance_micros = 0, updated_at = now() where id = $1",
        [account.id],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function countWorkflowSubmissions(idempotencyKey: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "select count(*) from muses_workflow_run where workspace_id = $1 and idempotency_key = $2",
      [workspaceId, idempotencyKey],
    );
    return Number(result.rows[0].count);
  } finally {
    await client.end();
  }
}

async function readReferenceImageStatus(assetId: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ status: string }>(
      "select status from muses_reference_image where id = $1 and workspace_id = $2",
      [assetId, workspaceId],
    );
    return result.rows[0]?.status;
  } finally {
    await client.end();
  }
}

async function expectPublishedCatalogVersionsAreImmutable() {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    await expect(
      client.query(
        "update price_book_entry set unit_credit_micros = unit_credit_micros + 1 where id = $1",
        ["price_openai_gpt_image_2_alpha_20260728_1"],
      ),
    ).rejects.toThrow(/immutable/i);
  } finally {
    await client.end();
  }
}

async function expectWorkflowDefinitionVersionIsImmutable(
  definitionId: string,
  version: number,
) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    await expect(
      client.query(
        `
          update muses_workflow_definition_version
          set input_schema = '{"mutated":true}'::jsonb
          where definition_id = $1 and version = $2
        `,
        [definitionId, version],
      ),
    ).rejects.toThrow(/immutable/i);
  } finally {
    await client.end();
  }
}

async function setWorkflowDeploymentStatus(
  deploymentId: string,
  status: "active" | "disabled",
) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      "update muses_workflow_deployment set status = $2, updated_at = now() where id = $1",
      [deploymentId, status],
    );
  } finally {
    await client.end();
  }
}

async function advanceWorkflowDraftLayoutRevision(definitionId: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ revision: number }>(
      `
        update muses_workflow_definition_draft
        set revision = revision + 1,
            lifecycle_status = 'draft',
            document = jsonb_set(
              jsonb_set(
                document,
                '{workflow,revision}',
                to_jsonb(((document #>> '{workflow,revision}')::integer + 1))
              ),
              '{workflow,nodes,0,position,x}',
              to_jsonb(
                ((document #>> '{workflow,nodes,0,position,x}')::numeric + 1)
              )
            ),
            updated_at = now()
        where workspace_id = $1 and id = $2
        returning revision
      `,
      [workspaceId, definitionId],
    );
    expect(result.rowCount).toBe(1);
    return result.rows[0].revision;
  } finally {
    await client.end();
  }
}

async function readWorkflowInvocationAudit(runId: string) {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{
      definitionId: string;
      definitionVersion: number;
      deploymentId: string;
      callerKind: string;
      callerId: string;
      workflowStatus: string;
    }>(
      `
        select
          workflow_definition_id as "definitionId",
          workflow_definition_version as "definitionVersion",
          workflow_deployment_id as "deploymentId",
          caller_kind as "callerKind",
          caller_id as "callerId",
          status as "workflowStatus"
        from muses_workflow_run
        where workspace_id = $1 and sdk_run_id = $2
        limit 1
      `,
      [workspaceId, runId],
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

function createIsolatedAuthIp(workerIndex: number) {
  const entropy = randomBytes(2).readUInt16BE(0);
  return `198.18.${(entropy >> 8) ^ workerIndex}.${entropy & 0xff}`;
}

function collectObjectKeys(value: unknown, keys: string[] = []) {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  for (const [key, item] of Object.entries(value)) {
    keys.push(key);
    collectObjectKeys(item, keys);
  }
  return keys;
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const port = process.env.OWORKER_DB_PORT || "5432";
  return `postgresql://oworker:oworker@127.0.0.1:${port}/oworker_saas`;
}
