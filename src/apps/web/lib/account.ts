import { recordAuditLog } from "@/lib/audit"
import { billingPlans } from "@/lib/billing"
import { getPgPool } from "@/lib/database"

export type SessionUser = {
  id: string
  email: string
  name?: string | null
  image?: string | null
  emailVerified?: boolean | null
}

export type AccountPaymentRecord = {
  id: string
  provider: string
  amountCents: number
  currency: string
  status: string
  description: string | null
  paidAt: string | null
  createdAt: string
}

export type AccountAuthProvider = {
  provider: string
  accountId: string | null
  hasPassword: boolean
  connectedAt: string
}

export type AccountSubscription = {
  plan: "starter" | "pro"
  status: string
  monthlyAmountCents: number
  currentPeriodEnd: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export type AccountConsoleData = {
  subscription: AccountSubscription
  authProviders: AccountAuthProvider[]
  payments: AccountPaymentRecord[]
}

export async function getAccountConsoleData(user: SessionUser): Promise<AccountConsoleData> {
  await ensureAccountSubscription(user)

  const [subscription, authProviders, payments] = await Promise.all([
    readAccountSubscription(user.id),
    readAuthProviders(user.id),
    readPaymentRecords(user.id),
  ])

  return {
    subscription,
    authProviders,
    payments,
  }
}

export async function ensureAccountSubscription(user: SessionUser) {
  const starterPlan = billingPlans[0]
  const subscriptionId = `subscription-${user.id}`

  const result = await getPgPool().query<{ id: string }>(
    `
      insert into billing_subscription (
        id,
        account_id,
        plan,
        status,
        monthly_amount_cents,
        current_period_end
      )
      values ($1, $2, 'starter', 'active', $3, now() + interval '30 days')
      on conflict (id) do nothing
      returning id
    `,
    [subscriptionId, user.id, starterPlan.monthlyAmountCents]
  )

  if (result.rows[0]) {
    await recordAuditLog({
      actor: { userId: user.id, email: user.email },
      action: "billing.subscription.created",
      targetType: "billing_subscription",
      targetId: subscriptionId,
      metadata: {
        accountId: user.id,
        plan: "starter",
      },
    })
  }
}

async function readAccountSubscription(accountId: string): Promise<AccountSubscription> {
  const result = await getPgPool().query<SubscriptionRow>(
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
    [accountId]
  )
  const row = result.rows[0]

  return {
    plan: normalizePlan(row?.plan),
    status: row?.status || "active",
    monthlyAmountCents: Number(row?.monthlyAmountCents || 0),
    currentPeriodEnd: row?.currentPeriodEnd ? new Date(row.currentPeriodEnd).toISOString() : null,
    stripeCustomerId: row?.stripeCustomerId || null,
    stripeSubscriptionId: row?.stripeSubscriptionId || null,
  }
}

async function readAuthProviders(userId: string): Promise<AccountAuthProvider[]> {
  const result = await getPgPool().query<AuthProviderRow>(
    `
      select
        "providerId" as provider,
        "accountId" as "accountId",
        password is not null as "hasPassword",
        "createdAt" as "connectedAt"
      from account
      where "userId" = $1
      order by
        case "providerId"
          when 'credential' then 0
          when 'github' then 1
          when 'google' then 2
          else 3
        end,
        "createdAt" asc
    `,
    [userId]
  )

  return result.rows.map((row) => ({
    provider: row.provider,
    accountId: row.accountId || null,
    hasPassword: Boolean(row.hasPassword),
    connectedAt: new Date(row.connectedAt).toISOString(),
  }))
}

async function readPaymentRecords(accountId: string): Promise<AccountPaymentRecord[]> {
  const result = await getPgPool().query<PaymentRow>(
    `
      select
        id,
        provider,
        amount_cents as "amountCents",
        currency,
        status,
        description,
        paid_at as "paidAt",
        created_at as "createdAt"
      from payment_record
      where account_id = $1
      order by paid_at desc nulls last, created_at desc
      limit 10
    `,
    [accountId]
  )

  return result.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    amountCents: Number(row.amountCents || 0),
    currency: row.currency,
    status: row.status,
    description: row.description || null,
    paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }))
}

function normalizePlan(value?: string | null): AccountSubscription["plan"] {
  if (value === "starter") {
    return value
  }

  return "pro"
}

type SubscriptionRow = {
  plan: string
  status: string
  monthlyAmountCents: number
  currentPeriodEnd: Date | string | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
}

type AuthProviderRow = {
  provider: string
  accountId: string | null
  hasPassword: boolean
  connectedAt: Date | string
}

type PaymentRow = {
  id: string
  provider: string
  amountCents: number
  currency: string
  status: string
  description: string | null
  paidAt: Date | string | null
  createdAt: Date | string
}
