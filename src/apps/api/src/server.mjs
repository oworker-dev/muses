import { serve } from "@hono/node-server";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import { serviceMap } from "./capabilities.mjs";

const portSchema = z.coerce.number().int().positive().default(3001);
const port = portSchema.parse(process.env.PORT);
const serviceId = "oworker.saas.api";
const demoAccountId = process.env.DEMO_ACCOUNT_ID || "demo-account";
const serviceCapabilities = serviceMap.capabilities;
const startedAt = new Date();
const redisHealthTimeoutMs = 2000;
const storageHealthTimeoutMs = 3000;

const app = new Hono();

app.get("/health", (context) =>
  context.json({
    status: "ok",
    service: serviceId,
    runtime: "hono",
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  }),
);

app.get("/contracts/summary", (context) =>
  context.json({
    service: serviceId,
    contracts: [
      "health",
      "auth-session",
      "account",
      "storage",
      "cache",
      "queue",
      "email",
      "billing",
      "analytics",
    ],
    interfaces: ["service-map", "openapi", "aclip", "mcp", "skills"],
    capabilities: serviceCapabilities.map((capability) => ({
      id: capability.id,
      http: capability.http,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      aclip: capability.aclip,
      mcp: capability.mcp,
    })),
  }),
);

app.get("/anss/capabilities", (context) =>
  context.json({
    schema: "anss.capabilities/0.1",
    service: serviceMap.service.id,
    programmableServiceBoundary:
      serviceMap.service.programmableServiceBoundary.type,
    capabilities: serviceCapabilities,
  }),
);

app.get("/integrations/health", async (context) => {
  const summary = await getHealthSummary();
  return context.json({
    status: summary.status,
    service: serviceId,
    integrations: summary.integrations,
  });
});

app.get("/auth/status", (context) => {
  const auth = readBearerAuth(context);
  return context.json({
    schema: "anss.auth-status/0.1",
    service: serviceMap.service.id,
    authenticated: auth.authenticated,
    mode: auth.mode,
    principal: auth.authenticated
      ? { type: "service-token", id: "local-agent" }
      : null,
    instructions: {
      cliTokenEnv: "SAAS_API_TOKEN",
      serverTokenEnv: "SAAS_SERVICE_TOKEN",
      note: "This starter supports a minimal local service-token check for Agent/CLI validation. Production projects should replace it with the product's real auth model.",
    },
  });
});

app.get("/account/summary", async (context) => {
  return context.json(await readAccountSummary(demoAccountId));
});

app.get("/billing/plans", (context) => {
  const billing = getBillingConfiguration();
  return context.json({
    plans: billingPlans,
    provider: "stripe",
    status: billing.status,
  });
});

app.get("/billing/state", async (context) => {
  const summary = await readAccountSummary(demoAccountId);
  const billing = getBillingConfiguration();
  return context.json({
    provider: "stripe",
    status: billing.status,
    account: summary.account,
    subscription: summary.subscription,
  });
});

app.post("/billing/checkout", async (context) => {
  const body = await context.req.json().catch(() => ({}));
  const checkout = await createCheckoutSession({
    accountId: String(body.accountId || demoAccountId),
    email: typeof body.email === "string" ? body.email : undefined,
  });
  return context.json(checkout);
});

app.post("/storage/presigned-upload", async (context) => {
  const body = await context.req.json().catch(() => ({}));
  const input = presignedUploadSchema.safeParse(body);
  if (!input.success) {
    return context.json(
      {
        status: "error",
        detail: "Invalid presigned upload request.",
      },
      400,
    );
  }

  return context.json(await createPresignedUpload(input.data));
});

async function getHealthSummary() {
  const database = await runHealthCheck(
    "postgresql",
    () => checkPostgres(process.env.DATABASE_URL),
    {
      retries: 1,
    },
  );
  const cache = await runHealthCheck(
    "valkey",
    () => checkRedis(process.env.REDIS_URL),
  );
  const storage = await runHealthCheck(
    "minio",
    () => checkMinio(process.env.S3_ENDPOINT),
  );
  const queue = {
    provider: "bullmq",
    status: cache.status,
    detail:
      cache.status === "ok"
        ? "Redis-compatible queue backend is reachable."
        : cache.detail,
  };
  const integrations = {
    database,
    cache,
    queue,
    storage,
    email: {
      provider:
        process.env.RESEND_API_KEY && process.env.RESEND_FROM
          ? "resend"
          : "local-test",
      status: "ok",
      detail:
        process.env.RESEND_API_KEY && process.env.RESEND_FROM
          ? "Resend email delivery is configured."
          : "Email delivery is running in local-test mode.",
    },
    billing: getBillingConfiguration(),
    observability: {
      provider: process.env.LOG_FORMAT || "json",
      status: "ok",
      detail: "Structured logs are enabled.",
    },
  };
  const required = [database, cache, queue, storage];
  const status = required.some((item) => item.status === "error")
    ? "degraded"
    : "ok";

  return {
    status,
    service: serviceId,
    runtime: "hono",
    integrations,
  };
}

const billingPlans = [
  {
    id: "starter",
    name: "Starter",
    monthlyAmountCents: 0,
    benefits: [
      "Replace with starter benefit 1",
      "Replace with starter benefit 2",
      "Replace with starter benefit 3",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyAmountCents: 2900,
    benefits: [
      "Replace with pro benefit 1",
      "Replace with pro benefit 2",
      "Replace with pro benefit 3",
    ],
  },
];

const presignedUploadSchema = z.object({
  fileName: z.string().min(1).max(180),
  contentType: z.string().min(1).max(120).default("application/octet-stream"),
});

async function readAccountSummary(accountId) {
  const subscription = await query(
    `
      select
        plan,
        status,
        monthly_amount_cents as "monthlyAmountCents",
        stripe_customer_id as "stripeCustomerId",
        stripe_subscription_id as "stripeSubscriptionId",
        stripe_price_id as "stripePriceId",
        current_period_end as "currentPeriodEnd"
      from billing_subscription
      where account_id = $1
      order by updated_at desc
      limit 1
    `,
    [accountId],
  );

  return {
    account: {
      id: accountId,
      label: "Demo account",
    },
    subscription: subscription.rows[0] || null,
  };
}

async function createCheckoutSession({ accountId, email }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_PRO;
  const appUrl =
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";

  if (!secretKey || !priceId) {
    return {
      provider: "stripe",
      status: "not-configured",
      detail:
        "Stripe checkout requires STRIPE_SECRET_KEY and STRIPE_PRICE_PRO.",
      accountId,
    };
  }

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", `${appUrl}/account/billing?billing=success`);
  params.set("cancel_url", `${appUrl}/account/billing?billing=cancelled`);
  params.set("client_reference_id", accountId);
  params.set("metadata[accountId]", accountId);
  params.set("metadata[plan]", "pro");
  params.set("subscription_data[metadata][accountId]", accountId);
  params.set("subscription_data[metadata][plan]", "pro");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  if (email) {
    params.set("customer_email", email);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!response.ok) {
    return {
      provider: "stripe",
      status: "error",
      detail: await response.text(),
    };
  }
  const session = await response.json();
  return {
    provider: "stripe",
    url: session.url,
    accountId,
  };
}

function getBillingConfiguration() {
  const configured = Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO,
  );
  return {
    provider: "stripe",
    status: configured ? "ok" : "not-configured",
    detail: configured
      ? "Stripe checkout is configured."
      : "Stripe checkout requires STRIPE_SECRET_KEY and STRIPE_PRICE_PRO.",
  };
}

async function runHealthCheck(provider, check, options = {}) {
  const retries = options.retries || 0;
  let lastError;
  let lastResult;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await check();
      if (result.status !== "error") {
        return result;
      }
      lastResult = result;
      lastError = new Error(result.detail);
    } catch (error) {
      lastError = error;
      lastResult = undefined;
    }

    if (attempt < retries) {
      await sleep(100);
    }
  }

  if (lastResult) {
    return lastResult;
  }

  return failed(provider, lastError);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let postgresHealthPool;
let postgresHealthConnectionString;

async function getPostgresHealthPool(connectionString) {
  if (
    postgresHealthPool &&
    postgresHealthConnectionString === connectionString
  ) {
    return postgresHealthPool;
  }

  if (postgresHealthPool) {
    await postgresHealthPool.end().catch(() => {});
  }

  const { Pool } = await import("pg");
  postgresHealthPool = new Pool({
    application_name: "oworker_saas_health",
    connectionString,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    max: 1,
    query_timeout: 3000,
    statement_timeout: 3000,
  });
  postgresHealthPool.on("error", () => {});
  postgresHealthConnectionString = connectionString;

  return postgresHealthPool;
}

async function resetPostgresHealthPool() {
  if (postgresHealthPool) {
    await postgresHealthPool.end().catch(() => {});
  }
  postgresHealthPool = undefined;
  postgresHealthConnectionString = undefined;
}

async function checkPostgres(connectionString) {
  if (!connectionString) {
    return notConfigured("postgresql");
  }

  try {
    const pool = await getPostgresHealthPool(connectionString);
    await pool.query("select 1");
    return ok("postgresql", "PostgreSQL is reachable.");
  } catch (error) {
    await resetPostgresHealthPool();
    return failed("postgresql", error);
  }
}

async function checkRedis(redisUrl) {
  if (!redisUrl) {
    return notConfigured("valkey");
  }

  try {
    await pingRedis(redisUrl);
    return ok("valkey", "Redis-compatible cache is reachable.");
  } catch (error) {
    return failed("valkey", error);
  }
}

function pingRedis(redisUrl) {
  const parsed = new URL(redisUrl);
  const host = parsed.hostname || "127.0.0.1";
  const port = Number(parsed.port || 6379);
  const password = parsed.password ? decodeURIComponent(parsed.password) : "";
  const username = parsed.username ? decodeURIComponent(parsed.username) : "";
  const database = parsed.pathname.replace(/^\//, "");
  const commands = [];

  if (password && username) {
    commands.push(["AUTH", username, password]);
  } else if (password) {
    commands.push(["AUTH", password]);
  }
  if (database) {
    commands.push(["SELECT", database]);
  }
  commands.push(["PING"]);

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let settled = false;
    let buffer = "";

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.setTimeout(redisHealthTimeoutMs, () => {
      finish(new Error("Redis ping timed out."));
    });
    socket.once("error", finish);
    socket.once("connect", () => {
      socket.write(commands.map(encodeRedisCommand).join(""));
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.startsWith("-") || buffer.includes("\r\n-")) {
        finish(new Error(buffer.trim()));
        return;
      }
      if (buffer.includes("+PONG\r\n")) {
        finish();
      }
    });
    socket.once("end", () => {
      if (!settled) {
        finish(new Error("Redis connection ended before PONG."));
      }
    });
  });
}

function encodeRedisCommand(parts) {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join("")}`;
}

let bucketReady = false;

async function createPresignedUpload(input) {
  const config = getStorageConfig();
  await ensureBucket(config);

  const key = createObjectKey(input.fileName);
  const client = createS3Client({
    ...config,
    endpoint: config.publicEndpoint,
  });
  const expiresInSeconds = 15 * 60;
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: input.contentType,
  });

  return {
    provider: "s3-compatible",
    bucket: config.bucket,
    key,
    method: "PUT",
    url: await getSignedUrl(client, command, { expiresIn: expiresInSeconds }),
    headers: {
      "content-type": input.contentType,
    },
    expiresInSeconds,
  };
}

function getStorageConfig() {
  const endpoint = process.env.S3_ENDPOINT;
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint;
  const bucket = process.env.S3_BUCKET || "oworker-saas";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !publicEndpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required for presigned uploads.",
    );
  }

  return {
    endpoint,
    publicEndpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION || "us-east-1",
  };
}

async function ensureBucket(config) {
  if (bucketReady) {
    return;
  }

  const client = createS3Client(config);

  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    bucketReady = true;
    return;
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    bucketReady = true;
  }
}

function createS3Client(config) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function createObjectKey(fileName) {
  const safeName =
    fileName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "upload";

  return `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
}

let pool;

async function query(sql, params = []) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!pool) {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }
  return pool.query(sql, params);
}

async function checkMinio(endpoint) {
  if (!endpoint) {
    return notConfigured("minio");
  }
  try {
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/minio/health/live`,
      {
        signal: AbortSignal.timeout(storageHealthTimeoutMs),
      },
    );
    if (!response.ok) {
      return {
        provider: "minio",
        status: "error",
        detail: `MinIO health endpoint returned ${response.status}.`,
      };
    }
    return ok("minio", "S3-compatible object storage is reachable.");
  } catch (error) {
    return failed("minio", error);
  }
}

function ok(provider, detail) {
  return { provider, status: "ok", detail };
}

function notConfigured(provider) {
  return {
    provider,
    status: "not_configured",
    detail: "No runtime configuration was provided.",
  };
}

function failed(provider, error) {
  return {
    provider,
    status: "error",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function readBearerAuth(context) {
  const expected = process.env.SAAS_SERVICE_TOKEN;
  const header = context.req.header("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!expected) {
    return {
      authenticated: false,
      mode: "local-unconfigured",
    };
  }

  return {
    authenticated: token === expected,
    mode: "service-token",
  };
}

serve(
  {
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port,
  },
  (info) => {
    console.log(`${serviceId} listening on http://0.0.0.0:${info.port}`);
  },
);
