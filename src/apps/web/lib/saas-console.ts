import { getPgPool } from "@/lib/database"
import { getEmailRuntime } from "@/lib/email"

export type AccountSummary = {
  id: string
  label: string
}

export type BillingSubscription = {
  plan: "starter" | "pro"
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | "paused"
    | "local_test"
  monthlyAmountCents: number
  currentPeriodEnd: string | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
}

export type IntegrationStatus = {
  provider: string
  status: "ok" | "not_configured" | "error"
  detail: string
}

export type SaaSConsole = {
  account: AccountSummary
  subscription: BillingSubscription
  integrations: Record<string, IntegrationStatus>
}

export async function getSaaSConsole(): Promise<SaaSConsole> {
  const pool = getPgPool()
  await ensureDemoAccountSubscription()

  const subscriptionResult = await pool.query<SubscriptionRow>(
    `
      select
        plan,
        status,
        monthly_amount_cents as "monthlyAmountCents",
        stripe_customer_id as "stripeCustomerId",
        stripe_subscription_id as "stripeSubscriptionId",
        current_period_end as "currentPeriodEnd"
      from billing_subscription
      where account_id = $1
      order by updated_at desc
      limit 1
    `,
    ["demo-account"]
  )

  return {
    account: {
      id: "demo-account",
      label: "Demo account",
    },
    subscription: normalizeSubscription(subscriptionResult.rows[0]),
    integrations: await getIntegrationStatuses(),
  }
}

async function ensureDemoAccountSubscription() {
  await getPgPool().query(`
    insert into billing_subscription (
      id,
      account_id,
      plan,
      status,
      monthly_amount_cents,
      current_period_end
    )
    values (
      'demo-subscription',
      'demo-account',
      'pro',
      'active',
      2900,
      now() + interval '30 days'
    )
    on conflict (id) do nothing
  `)
}

function normalizeSubscription(row?: SubscriptionRow): BillingSubscription {
  return {
    plan: normalizePlan(row?.plan),
    status: normalizeStatus(row?.status),
    monthlyAmountCents: Number(row?.monthlyAmountCents || 0),
    currentPeriodEnd: row?.currentPeriodEnd
      ? new Date(row.currentPeriodEnd).toISOString()
      : null,
    stripeCustomerId: row?.stripeCustomerId || null,
    stripeSubscriptionId: row?.stripeSubscriptionId || null,
  }
}

function normalizePlan(value?: string): BillingSubscription["plan"] {
  if (value === "starter") {
    return value
  }
  return "pro"
}

function normalizeStatus(value?: string): BillingSubscription["status"] {
  if (
    value === "trialing" ||
    value === "active" ||
    value === "past_due" ||
    value === "canceled" ||
    value === "incomplete" ||
    value === "incomplete_expired" ||
    value === "unpaid" ||
    value === "paused"
  ) {
    return value
  }
  return "local_test"
}

async function getIntegrationStatuses(): Promise<
  Record<string, IntegrationStatus>
> {
  const configuredStatuses = getConfiguredIntegrationStatuses()
  const runtimeStatuses = await getRuntimeIntegrationStatuses()

  return {
    ...runtimeStatuses,
    oauth: configuredStatuses.oauth,
  }
}

async function getRuntimeIntegrationStatuses(): Promise<
  Record<string, IntegrationStatus>
> {
  const baseUrl = getRuntimeHealthBaseUrl()

  try {
    const response = await fetch(`${baseUrl}/integrations/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      throw new Error(`Health endpoint returned ${response.status}.`)
    }

    const payload = (await response.json()) as RuntimeHealthPayload
    const integrations = isRecord(payload.integrations)
      ? payload.integrations
      : {}

    return {
      api: ok("hono", "Service API health endpoint is reachable."),
      ...Object.fromEntries(
        Object.entries(integrations).map(([name, status]) => [
          name,
          normalizeRuntimeIntegrationStatus(status),
        ])
      ),
    }
  } catch (error) {
    return {
      api: failed(
        "hono",
        `Service API health endpoint is not reachable: ${getErrorMessage(error)}`
      ),
    }
  }
}

function getConfiguredIntegrationStatuses(): Record<string, IntegrationStatus> {
  const email = getEmailRuntime()
  return {
    database: process.env.DATABASE_URL
      ? ok(
          "postgresql",
          "PostgreSQL is configured for account and billing state."
        )
      : notConfigured(
          "postgresql",
          "Set DATABASE_URL to enable persistent state."
        ),
    cache: process.env.REDIS_URL
      ? ok("valkey", "Redis-compatible cache is configured.")
      : notConfigured(
          "valkey",
          "Set REDIS_URL when cache or queue workloads need it."
        ),
    queue: process.env.REDIS_URL
      ? ok("bullmq", "BullMQ can use the configured Redis-compatible backend.")
      : notConfigured(
          "bullmq",
          "Set REDIS_URL before enabling background jobs."
        ),
    storage: process.env.S3_ENDPOINT
      ? ok("s3-compatible", "S3-compatible object storage is configured.")
      : notConfigured(
          "s3-compatible",
          "Set S3_ENDPOINT before enabling file uploads."
        ),
    email: {
      provider: email.provider,
      status: "ok",
      detail: email.detail,
    },
    billing:
      process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO
        ? ok("stripe", "Stripe checkout is configured.")
        : notConfigured(
            "stripe",
            "Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO before enabling subscription checkout."
          ),
    oauth:
      process.env.GITHUB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
        ? ok("better-auth", "At least one OAuth provider is configured.")
        : notConfigured("better-auth", "GitHub and Google OAuth are optional."),
    observability: ok(
      process.env.LOG_FORMAT || "json",
      "Structured logs are enabled."
    ),
  }
}

function getRuntimeHealthBaseUrl() {
  return (
    process.env.API_BASE_URL ||
    process.env.SAAS_API_BASE_URL ||
    process.env.API_PUBLIC_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "")
}

function normalizeRuntimeIntegrationStatus(value: unknown): IntegrationStatus {
  if (!isRecord(value)) {
    return failed("unknown", "Runtime health payload is malformed.")
  }

  return {
    provider: typeof value.provider === "string" ? value.provider : "unknown",
    status: normalizeIntegrationStatus(value.status),
    detail:
      typeof value.detail === "string"
        ? value.detail
        : "No runtime detail was provided.",
  }
}

function normalizeIntegrationStatus(
  value: unknown
): IntegrationStatus["status"] {
  if (value === "ok" || value === "error") {
    return value
  }
  if (value === "not_configured" || value === "not-configured") {
    return "not_configured"
  }
  return "error"
}

function ok(provider: string, detail: string): IntegrationStatus {
  return { provider, status: "ok", detail }
}

function notConfigured(provider: string, detail: string): IntegrationStatus {
  return { provider, status: "not_configured", detail }
}

function failed(provider: string, detail: string): IntegrationStatus {
  return { provider, status: "error", detail }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

type RuntimeHealthPayload = {
  integrations?: unknown
}

type SubscriptionRow = {
  plan: string
  status: string
  monthlyAmountCents: number
  currentPeriodEnd: Date | string | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
}
