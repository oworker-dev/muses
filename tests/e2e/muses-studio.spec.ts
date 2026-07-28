import { expect, test } from "@playwright/test";
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

  await expect(panel.getByText("Result ready", { exact: true })).toBeVisible({
    timeout: 5 * 60_000,
  });
  const generatedImage = panel.locator("figure img");
  await expect(generatedImage).toBeVisible();
  const runId = await page.evaluate(
    (currentWorkspaceId) => {
      const prefix = `muses.agent.last-run.${currentWorkspaceId}.`;
      const key = Object.keys(window.localStorage).find((candidate) =>
        candidate.startsWith(prefix),
      );
      return key ? window.localStorage.getItem(key) : null;
    },
    workspaceId,
  );
  expect(runId).toBeTruthy();
  const runResponse = await page.request.get(
    `/api/studio/agent-runs?workspaceId=${workspaceId}&runId=${runId}`,
  );
  expect(runResponse.ok()).toBeTruthy();
  const runProjection = (await runResponse.json()) as {
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
      items: Array<{ kind: string; refId: string }>;
    };
  };
  expect(gateway.creativeCanvas.items).toContainEqual(
    expect.objectContaining({ kind: "asset", refId: generatedAssetId }),
  );

  await page.reload();
  await expect(page.getByTestId("studio-agent-panel")).toContainText(
    "Result ready",
  );
  await expect(
    page.getByTestId("studio-agent-panel").locator("figure img"),
  ).toBeVisible();
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

  await page.goto("/studio");
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
  let publishedWorkflow: {
    workspaceId?: string;
    workflow?: {
      nodes?: Array<{
        id: string;
        data: Record<string, unknown>;
      }>;
      edges?: Array<{
        sourceNodeId: string;
        targetNodeId: string;
      }>;
    };
  } | null = null;

  await page.route("**/api/studio/workflow-runs*", async (route) => {
    if (route.request().method() === "POST") {
      publishedWorkflow = route.request().postDataJSON();
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

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runId,
        runtime: "muses-workflow-runtime",
        sdkStatus: "completed",
        status: "completed",
        attempts: [
          {
            nodeId: "image-generator-1",
            nodeKind: "image-generator",
            attempt: 1,
            maxAttempts: 1,
            status: "succeeded",
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
            completedAt: "2026-07-28T00:00:01.240Z",
            durationMs: 1240,
            workflowCoreVersion: "4.6.2",
          },
          nodes: [
            {
              nodeId: "image-generator-1",
              nodeKind: "image-generator",
              status: "succeeded",
              attempt: 1,
              startedAt: "2026-07-28T00:00:00.000Z",
              completedAt: "2026-07-28T00:00:01.240Z",
              durationMs: 1240,
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
              outputSummary: [
                { portId: "image", valueType: "image", count: 1 },
              ],
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

  await page.goto("/studio");
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

  await expect(page.getByTestId("durable-run-images")).toBeVisible();
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
  expect(publishedWorkflow?.workspaceId).toBe(workspaceId);
  expect(publishedWorkflow?.workflow?.nodes?.map((node) => node.id)).toEqual([
    "start-1",
    "image-generator-1",
    "end-1",
  ]);
  expect(
    publishedWorkflow?.workflow?.nodes?.find(
      (node) => node.id === "image-generator-1",
    )?.data,
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
  expect(publishedWorkflow?.workflow?.edges).toEqual([
    expect.objectContaining({
      sourceNodeId: "start-1",
      targetNodeId: "image-generator-1",
    }),
    expect.objectContaining({
      sourceNodeId: "image-generator-1",
      targetNodeId: "end-1",
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
  };
  expect(publicationBody.runtime).toBe("muses-workflow-runtime");
  expect(publicationBody.durableRuntime).toBe("vercel-workflow-sdk");
  expect(publicationBody.runId).toMatch(/^wrun_/);
  expect(publicationBody.definition).toEqual({
    workspaceId,
    definitionId: "workflow-alpha:runtime-v1",
    version: 0,
    schemaVersion: "0.3.0-draft",
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
        definitionId: "workflow-alpha:runtime-v1",
        version: 0,
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
    .first();
  await firstResult.click();
  await expect(
    page.getByText(/Direction selected and published/i),
  ).toBeVisible();

  await page
    .getByTestId("workflow-node-design-1")
    .getByRole("button", { name: "Open design canvas" })
    .click();
  await expect(page.getByText("DesignDocument", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Launch composition" }),
  ).toBeVisible();

  const headline = page.locator("textarea").first();
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
  const publication = await page.evaluate(
    (key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error("Expected a persisted Studio workspace.");
      const workspace = JSON.parse(raw);
      return { workspaceId: workspace.id, workflow: workspace.workflow };
    },
    studioWorkspaceStorageKey(workspaceId, true),
  );

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

test("insufficient credits reject a real image run before provider execution", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(
    page.getByTestId("workflow-node-image-generator-1"),
  ).toBeVisible();
  const workflow = await page.evaluate(
    (storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw).workflow : null;
    },
    studioWorkspaceStorageKey(workspaceId, false),
  );
  expect(workflow).toBeTruthy();

  await drainStudioCredits();
  const idempotencyKey = `insufficient-credit:${Date.now()}`;
  const response = await page.request.post("/api/studio/workflow-runs", {
    data: { workspaceId, workflow, idempotencyKey },
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

function createIsolatedAuthIp(workerIndex: number) {
  const entropy = randomBytes(2).readUInt16BE(0);
  return `198.18.${(entropy >> 8) ^ workerIndex}.${entropy & 0xff}`;
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const port = process.env.OWORKER_DB_PORT || "5432";
  return `postgresql://oworker:oworker@127.0.0.1:${port}/oworker_saas`;
}
