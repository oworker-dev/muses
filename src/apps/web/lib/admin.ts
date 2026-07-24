import { redirect } from "next/navigation"

import { getAnalyticsSummary } from "@/lib/analytics"
import { getServerSession } from "@/lib/auth"
import { getPgPool } from "@/lib/database"
import { getSaaSConsole, type IntegrationStatus } from "@/lib/saas-console"

export type SiteAdminSession = NonNullable<
  Awaited<ReturnType<typeof getServerSession>>
>

export async function requireSiteAdmin() {
  const session = await getServerSession()
  if (!session) {
    redirect("/login?callbackURL=/admin")
  }
  if (!session.user.emailVerified) {
    redirect(
      `/verify-email?email=${encodeURIComponent(session.user.email)}&callbackURL=/admin`
    )
  }

  if (!(await isSiteAdmin(session.user.id, session.user.email))) {
    redirect("/account")
  }

  return session as SiteAdminSession
}

export async function isSiteAdmin(userId: string, email: string) {
  const configuredAdmins = getConfiguredSiteAdmins()
  if (configuredAdmins.size > 0) {
    return configuredAdmins.has(email.toLowerCase())
  }

  const firstUser = await getPgPool().query<{ id: string }>(
    'select id from "user" order by "createdAt" asc limit 1'
  )
  return firstUser.rows[0]?.id === userId
}

export async function getAdminOverview() {
  const [users, revenue, subscriptions, todayAnalytics, weekAnalytics] =
    await Promise.all([
      getPgPool().query<{ total: number; verified: number; newToday: number }>(
        `
        select
          count(*)::int as total,
          count(*) filter (where "emailVerified")::int as verified,
          count(*) filter (where "createdAt" >= current_date)::int as "newToday"
        from "user"
      `
      ),
      getPgPool().query<{
        amountCents: number
        payments: number
        todayAmountCents: number
      }>(
        `
        select
          coalesce(sum(amount_cents), 0)::int as "amountCents",
          count(*)::int as payments,
          coalesce(sum(amount_cents) filter (where created_at >= current_date), 0)::int as "todayAmountCents"
        from payment_record
        where status in ('paid', 'succeeded') and created_at >= now() - interval '30 days'
      `
      ),
      getPgPool().query<{ active: number }>(
        "select count(*)::int as active from billing_subscription where status in ('active', 'trialing')"
      ),
      getAnalyticsSummary(1),
      getAnalyticsSummary(7),
    ])

  return {
    users: users.rows[0] || { total: 0, verified: 0, newToday: 0 },
    revenue: revenue.rows[0] || {
      amountCents: 0,
      payments: 0,
      todayAmountCents: 0,
    },
    activeSubscriptions: Number(subscriptions.rows[0]?.active || 0),
    analytics: {
      today: todayAnalytics,
      week: weekAnalytics,
    },
  }
}

export async function getAdminUsers() {
  const result = await getPgPool().query<AdminUserRow>(
    `
      select
        u.id,
        u.name,
        u.email,
        u."emailVerified" as "emailVerified",
        u."createdAt" as "createdAt",
        coalesce(array_remove(array_agg(distinct a."providerId"), null), '{}') as providers,
        coalesce(bs.plan, 'starter') as "subscriptionPlan",
        coalesce(bs.status, 'none') as "subscriptionStatus",
        activity.last_seen_at as "lastSeenAt",
        activity.last_country as "lastCountry",
        activity.last_device as "lastDevice",
        activity.last_path as "lastPath",
        recent_audit.action as "lastAuditAction",
        recent_audit.created_at as "lastAuditAt"
      from "user" u
      left join account a on a."userId" = u.id
      left join lateral (
        select plan, status
        from billing_subscription
        where account_id = u.id
        order by updated_at desc
        limit 1
      ) bs on true
      left join account_activity_summary activity on activity.user_id = u.id
      left join lateral (
        select action, created_at
        from audit_log
        where actor_user_id = u.id
        order by created_at desc
        limit 1
      ) recent_audit on true
      group by
        u.id,
        bs.plan,
        bs.status,
        activity.last_seen_at,
        activity.last_country,
        activity.last_device,
        activity.last_path,
        recent_audit.action,
        recent_audit.created_at
      order by u."createdAt" desc
      limit 100
    `
  )

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name || null,
    email: row.email,
    emailVerified: Boolean(row.emailVerified),
    authMode: getAuthMode(row.providers || []),
    providers: normalizeProviders(row.providers || []),
    subscriptionPlan: row.subscriptionPlan,
    subscriptionStatus: row.subscriptionStatus,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
    lastCountry: row.lastCountry || "unknown",
    lastDevice: row.lastDevice || "unknown",
    lastPath: row.lastPath || null,
    lastAuditAction: row.lastAuditAction || null,
    lastAuditAt: row.lastAuditAt
      ? new Date(row.lastAuditAt).toISOString()
      : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }))
}

export async function getAdminRevenue() {
  const result = await getPgPool().query<PaymentRow>(
    `
      select
        pr.id,
        pr.account_id as "accountId",
        pr.provider,
        pr.customer_email as "customerEmail",
        pr.amount_cents as "amountCents",
        pr.currency,
        pr.status,
        pr.description,
        pr.paid_at as "paidAt",
        pr.created_at as "createdAt"
      from payment_record pr
      order by pr.paid_at desc nulls last, pr.created_at desc
      limit 100
    `
  )
  const rows = result.rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    provider: row.provider,
    customerEmail: row.customerEmail || null,
    amountCents: Number(row.amountCents || 0),
    currency: row.currency,
    status: row.status,
    description: row.description || null,
    paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }))

  return {
    rows,
    totalCents: rows
      .filter((row) => row.status === "paid" || row.status === "succeeded")
      .reduce((sum, row) => sum + row.amountCents, 0),
  }
}

export async function getAdminSubscriptions() {
  const result = await getPgPool().query<SubscriptionRow>(
    `
      select
        bs.id,
        bs.account_id as "accountId",
        bs.plan,
        bs.status,
        bs.monthly_amount_cents as "monthlyAmountCents",
        bs.stripe_customer_id as "stripeCustomerId",
        bs.stripe_subscription_id as "stripeSubscriptionId",
        bs.current_period_end as "currentPeriodEnd",
        bs.updated_at as "updatedAt"
      from billing_subscription bs
      order by bs.updated_at desc
      limit 100
    `
  )

  return result.rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    plan: row.plan,
    status: row.status,
    monthlyAmountCents: Number(row.monthlyAmountCents || 0),
    stripeCustomerId: row.stripeCustomerId || null,
    stripeSubscriptionId: row.stripeSubscriptionId || null,
    currentPeriodEnd: row.currentPeriodEnd
      ? new Date(row.currentPeriodEnd).toISOString()
      : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }))
}

export async function getAdminHealth(): Promise<
  Record<string, IntegrationStatus>
> {
  const consoleData = await getSaaSConsole()
  return consoleData.integrations
}

export async function getAdminAuditLogs() {
  const result = await getPgPool().query<AuditRow>(
    `
      select
        id,
        actor_email as "actorEmail",
        action,
        target_type as "targetType",
        target_id as "targetId",
        metadata,
        created_at as "createdAt"
      from audit_log
      order by created_at desc
      limit 100
    `
  )

  return result.rows.map((row) => ({
    id: row.id,
    actorEmail: row.actorEmail || "system",
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId || null,
    metadata: row.metadata || {},
    createdAt: new Date(row.createdAt).toISOString(),
  }))
}

export async function getAdminDiagnostics() {
  const result = await getPgPool().query<WebhookEventRow>(
    `
      select
        provider,
        event_id as "eventId",
        event_type as "eventType",
        status,
        error,
        received_at as "receivedAt",
        processed_at as "processedAt"
      from billing_webhook_event
      order by received_at desc
      limit 100
    `
  )

  return result.rows.map((row) => ({
    provider: row.provider,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    error: row.error || null,
    receivedAt: new Date(row.receivedAt).toISOString(),
    processedAt: row.processedAt
      ? new Date(row.processedAt).toISOString()
      : null,
  }))
}

function getConfiguredSiteAdmins() {
  return new Set(
    (process.env.SITE_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

function normalizeProviders(providers: string[]) {
  return providers
    .map((provider) => provider.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

function getAuthMode(providers: string[]) {
  const normalized = normalizeProviders(providers)
  const hasCredential =
    normalized.includes("credential") || normalized.includes("email")
  const hasSocial = normalized.some(
    (provider) => provider !== "credential" && provider !== "email"
  )

  if (hasCredential && hasSocial) {
    return "password + oauth"
  }
  if (hasCredential) {
    return "password"
  }
  if (hasSocial) {
    return "oauth"
  }
  return "unknown"
}

type AdminUserRow = {
  id: string
  name: string | null
  email: string
  emailVerified: boolean
  providers: string[]
  subscriptionPlan: string
  subscriptionStatus: string
  lastSeenAt: Date | string | null
  lastCountry: string | null
  lastDevice: string | null
  lastPath: string | null
  lastAuditAction: string | null
  lastAuditAt: Date | string | null
  createdAt: Date | string
}

type PaymentRow = {
  id: string
  accountId: string
  provider: string
  customerEmail: string | null
  amountCents: number
  currency: string
  status: string
  description: string | null
  paidAt: Date | string | null
  createdAt: Date | string
}

type SubscriptionRow = {
  id: string
  accountId: string
  plan: string
  status: string
  monthlyAmountCents: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | string | null
  updatedAt: Date | string
}

type AuditRow = {
  id: string
  actorEmail: string | null
  action: string
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown>
  createdAt: Date | string
}

type WebhookEventRow = {
  provider: string
  eventId: string
  eventType: string
  status: string
  error: string | null
  receivedAt: Date | string
  processedAt: Date | string | null
}
