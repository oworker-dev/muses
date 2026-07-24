import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { getPgPool } from "@/lib/database"

export const billingPlans = [
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
] as const

export type BillingPlan = (typeof billingPlans)[number]
export type BillingPlanId = BillingPlan["id"]
export type BillingConfigurationIssue = "missing-secret" | "missing-price"

export class BillingConfigurationError extends Error {
  code: BillingConfigurationIssue

  constructor(code: BillingConfigurationIssue) {
    super(
      code === "missing-secret"
        ? "Stripe secret key is not configured."
        : "Stripe price is not configured for this plan."
    )
    this.name = "BillingConfigurationError"
    this.code = code
  }
}

export type StripeBillingEvent = {
  id?: string
  type?: string
  data?: {
    object?: StripeBillingObject
  }
}

type StripeBillingObject = {
  id?: string
  customer?: string | { id?: string }
  customer_email?: string | null
  customer_details?: {
    email?: string | null
  }
  client_reference_id?: string
  metadata?: Record<string, string | undefined>
  subscription?: string | { id?: string }
  status?: string
  payment_status?: string
  amount_paid?: number
  amount_total?: number
  currency?: string
  current_period_end?: number
  items?: {
    data?: Array<{
      price?: {
        id?: string
      }
    }>
  }
  lines?: {
    data?: Array<{
      period?: {
        end?: number
      }
    }>
  }
}

export async function createCheckoutRedirect(input: {
  accountId: string
  email?: string | null
  planId?: BillingPlanId
}) {
  const appUrl = getAppUrl()
  const secretKey = process.env.STRIPE_SECRET_KEY
  const planId = input.planId || "pro"
  const priceId = getStripePriceId(planId)

  if (!secretKey) {
    throw new BillingConfigurationError("missing-secret")
  }

  if (!priceId) {
    throw new BillingConfigurationError("missing-price")
  }

  const customerId = await readStripeCustomerId(input.accountId)
  const params = new URLSearchParams()
  params.set("mode", "subscription")
  params.set("success_url", `${appUrl}/account/billing?billing=success`)
  params.set("cancel_url", `${appUrl}/account/billing?billing=cancelled`)
  params.set("client_reference_id", input.accountId)
  params.set("metadata[accountId]", input.accountId)
  params.set("metadata[plan]", planId)
  params.set("subscription_data[metadata][accountId]", input.accountId)
  params.set("subscription_data[metadata][plan]", planId)
  params.set("line_items[0][price]", priceId)
  params.set("line_items[0][quantity]", "1")
  params.set("allow_promotion_codes", "true")

  if (customerId) {
    params.set("customer", customerId)
  } else if (input.email) {
    params.set("customer_email", input.email)
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Stripe checkout failed: ${message}`)
  }

  const session = (await response.json()) as { url?: string }
  if (!session.url) {
    throw new Error("Stripe checkout did not return a redirect URL")
  }
  return session.url
}

export async function createPortalRedirect(input: { accountId: string }) {
  const appUrl = getAppUrl()
  const secretKey = process.env.STRIPE_SECRET_KEY
  const customerId = await readStripeCustomerId(input.accountId)

  if (!secretKey) {
    return `${appUrl}/account/billing?billing=portal-not-configured`
  }

  if (!customerId) {
    return `${appUrl}/account/billing?billing=no-billing-customer`
  }

  const params = new URLSearchParams()
  params.set("customer", customerId)
  params.set("return_url", `${appUrl}/account/billing?billing=portal-return`)

  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Stripe portal failed: ${message}`)
  }

  const session = (await response.json()) as { url?: string }
  if (!session.url) {
    throw new Error("Stripe portal did not return a redirect URL")
  }
  return session.url
}

export function parseStripeBillingEvent(input: {
  payload: string
  signature: string | null
  secret?: string
}) {
  if (input.secret) {
    const valid = verifyStripeWebhookSignature({
      payload: input.payload,
      signature: input.signature,
      secret: input.secret,
    })
    if (!valid) {
      throw new Error("Invalid Stripe signature")
    }
  }

  return JSON.parse(input.payload) as StripeBillingEvent
}

export function verifyStripeWebhookSignature(input: {
  payload: string
  signature: string | null
  secret: string
  toleranceSeconds?: number
}) {
  if (!input.signature) {
    return false
  }

  const parts = new Map(
    input.signature.split(",").map((part) => {
      const [key, value] = part.split("=")
      return [key, value]
    })
  )
  const timestamp = parts.get("t")
  const expected = parts.get("v1")
  if (!timestamp || !expected) {
    return false
  }

  const timestampSeconds = Number(timestamp)
  const toleranceSeconds = input.toleranceSeconds ?? 300
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds
  ) {
    return false
  }

  const signedPayload = `${timestamp}.${input.payload}`
  const digest = createHmac("sha256", input.secret).update(signedPayload).digest("hex")
  const actualBuffer = Buffer.from(digest, "hex")
  const expectedBuffer = Buffer.from(expected, "hex")
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

export async function handleStripeBillingEvent(event: StripeBillingEvent) {
  const eventId = event.id || `local-${randomUUID()}`
  const eventType = event.type || "unknown"
  const started = await startWebhookEvent(eventId, eventType, event)

  if (started.duplicate) {
    return {
      received: true,
      duplicate: true,
      eventId,
      eventType,
    }
  }

  try {
    switch (eventType) {
      case "checkout.session.completed":
        await applyCheckoutSessionCompleted(event)
        break
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await applySubscriptionChanged(event)
        break
      case "customer.subscription.deleted":
        await applySubscriptionChanged(event, "canceled")
        break
      case "invoice.payment_succeeded":
        await applyInvoicePaymentSucceeded(event)
        break
      default:
        break
    }

    await finishWebhookEvent(eventId, "processed")
    return {
      received: true,
      duplicate: false,
      eventId,
      eventType,
    }
  } catch (error) {
    await finishWebhookEvent(
      eventId,
      "failed",
      error instanceof Error ? error.message : String(error)
    )
    throw error
  }
}

async function applyCheckoutSessionCompleted(event: StripeBillingEvent) {
  const object = event.data?.object
  const accountId = await resolveAccountId(object)
  if (!accountId) {
    return
  }

  const planId = resolvePlanId(object?.metadata?.plan, getPriceIdFromObject(object))
  await upsertBillingSubscription({
    id: getStripeId(object?.subscription) || `subscription-${accountId}`,
    accountId,
    planId,
    status: object?.payment_status === "paid" || object?.status === "complete" ? "active" : "trialing",
    stripeCustomerId: getStripeId(object?.customer),
    stripeSubscriptionId: getStripeId(object?.subscription),
    stripeCheckoutSessionId: object?.id,
    stripePriceId: getPriceIdFromObject(object),
  })

  await recordPayment({
    accountId,
    providerEventId: event.id,
    providerPaymentId: object?.id,
    amountCents: object?.amount_total || 0,
    currency: object?.currency || "usd",
    status: object?.payment_status === "paid" ? "paid" : object?.payment_status || "completed",
    customerEmail: object?.customer_details?.email || object?.customer_email || null,
    description: "Checkout session completed",
    paidAt: new Date(),
  })
}

async function applySubscriptionChanged(event: StripeBillingEvent, forcedStatus?: string) {
  const object = event.data?.object
  const accountId = await resolveAccountId(object)
  if (!accountId) {
    return
  }

  await upsertBillingSubscription({
    id: object?.id || `subscription-${accountId}`,
    accountId,
    planId: resolvePlanId(object?.metadata?.plan, getPriceIdFromObject(object)),
    status: normalizeSubscriptionStatus(forcedStatus || object?.status),
    stripeCustomerId: getStripeId(object?.customer),
    stripeSubscriptionId: object?.id,
    stripePriceId: getPriceIdFromObject(object),
    currentPeriodEnd: unixSecondsToDate(object?.current_period_end),
  })
}

async function applyInvoicePaymentSucceeded(event: StripeBillingEvent) {
  const object = event.data?.object
  const subscriptionId = getStripeId(object?.subscription)
  if (!subscriptionId) {
    return
  }

  const accountId = await resolveAccountId(object)

  const periodEnd = object?.lines?.data?.[0]?.period?.end
  await getPgPool().query(
    `
      update billing_subscription
      set status = 'active',
          current_period_end = coalesce($2, current_period_end),
          updated_at = now()
      where stripe_subscription_id = $1
    `,
    [subscriptionId, unixSecondsToDate(periodEnd)]
  )

  if (accountId) {
    await recordPayment({
      accountId,
      providerEventId: event.id,
      providerPaymentId: object?.id,
      amountCents: object?.amount_paid || 0,
      currency: object?.currency || "usd",
      status: "paid",
      customerEmail: object?.customer_email || object?.customer_details?.email || null,
      description: "Invoice payment succeeded",
      paidAt: new Date(),
    })
  }
}

async function recordPayment(input: {
  accountId: string
  providerEventId?: string | null
  providerPaymentId?: string | null
  amountCents: number
  currency: string
  status: string
  customerEmail?: string | null
  description?: string | null
  paidAt?: Date | null
}) {
  await getPgPool().query(
    `
      insert into payment_record (
        id,
        account_id,
        provider,
        provider_payment_id,
        provider_event_id,
        customer_email,
        amount_cents,
        currency,
        status,
        description,
        paid_at
      )
      values ($1, $2, 'stripe', $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (provider, provider_event_id) where provider_event_id is not null do update
      set status = excluded.status,
          amount_cents = excluded.amount_cents,
          currency = excluded.currency,
          customer_email = coalesce(excluded.customer_email, payment_record.customer_email),
          paid_at = coalesce(excluded.paid_at, payment_record.paid_at)
    `,
    [
      `stripe-payment-${input.providerEventId || input.providerPaymentId || randomUUID()}`,
      input.accountId,
      input.providerPaymentId || null,
      input.providerEventId || null,
      input.customerEmail || null,
      input.amountCents,
      input.currency.toLowerCase(),
      input.status,
      input.description || null,
      input.paidAt || null,
    ]
  )
}

async function upsertBillingSubscription(input: {
  id: string
  accountId: string
  planId: BillingPlanId
  status: string
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripeCheckoutSessionId?: string | null
  stripePriceId?: string | null
  currentPeriodEnd?: Date | null
}) {
  const plan = getBillingPlan(input.planId)
  await getPgPool().query(
    `
      insert into billing_subscription (
        id,
        account_id,
        plan,
        status,
        monthly_amount_cents,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        stripe_checkout_session_id,
        current_period_end
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (id) do update
      set account_id = excluded.account_id,
          plan = excluded.plan,
          status = excluded.status,
          monthly_amount_cents = excluded.monthly_amount_cents,
          stripe_customer_id = coalesce(excluded.stripe_customer_id, billing_subscription.stripe_customer_id),
          stripe_subscription_id = coalesce(excluded.stripe_subscription_id, billing_subscription.stripe_subscription_id),
          stripe_price_id = coalesce(excluded.stripe_price_id, billing_subscription.stripe_price_id),
          stripe_checkout_session_id = coalesce(excluded.stripe_checkout_session_id, billing_subscription.stripe_checkout_session_id),
          current_period_end = coalesce(excluded.current_period_end, billing_subscription.current_period_end),
          updated_at = now()
    `,
    [
      input.id,
      input.accountId,
      plan.id,
      input.status,
      plan.monthlyAmountCents,
      input.stripeCustomerId || null,
      input.stripeSubscriptionId || null,
      input.stripePriceId || null,
      input.stripeCheckoutSessionId || null,
      input.currentPeriodEnd || null,
    ]
  )
}

async function readStripeCustomerId(accountId: string) {
  const result = await getPgPool().query<{ stripeCustomerId: string | null }>(
    `
      select stripe_customer_id as "stripeCustomerId"
      from billing_subscription
      where account_id = $1 and stripe_customer_id is not null
      order by updated_at desc
      limit 1
    `,
    [accountId]
  )
  return result.rows[0]?.stripeCustomerId || null
}

async function resolveAccountId(object?: StripeBillingObject) {
  const accountId = object?.metadata?.accountId || object?.client_reference_id
  if (accountId) {
    return accountId
  }

  const objectId = object?.id || null
  const subscriptionId = getStripeId(object?.subscription) || (objectId?.startsWith("sub_") ? objectId : null)
  const customerId = getStripeId(object?.customer)
  if (!subscriptionId && !customerId) {
    return null
  }

  const result = await getPgPool().query<{ accountId: string }>(
    `
      select account_id as "accountId"
      from billing_subscription
      where ($1::text is not null and stripe_subscription_id = $1)
         or ($2::text is not null and stripe_customer_id = $2)
      order by updated_at desc
      limit 1
    `,
    [subscriptionId || null, customerId || null]
  )
  return result.rows[0]?.accountId || null
}

async function startWebhookEvent(
  eventId: string,
  eventType: string,
  payload: StripeBillingEvent
) {
  const result = await getPgPool().query<{ status: string; processedAt: Date | null }>(
    `
      insert into billing_webhook_event (id, provider, event_id, event_type, status, payload)
      values ($1, 'stripe', $2, $3, 'processing', $4::jsonb)
      on conflict (provider, event_id) do update
      set received_at = now(),
          status = case
            when billing_webhook_event.status = 'failed' then 'processing'
            else billing_webhook_event.status
          end,
          error = case
            when billing_webhook_event.status = 'failed' then null
            else billing_webhook_event.error
          end
      returning status, processed_at as "processedAt"
    `,
    [`stripe-${eventId}`, eventId, eventType, JSON.stringify(payload)]
  )
  const row = result.rows[0]
  return {
    duplicate: Boolean(row?.processedAt || row?.status === "processed"),
  }
}

async function finishWebhookEvent(eventId: string, status: "processed" | "failed", error?: string) {
  await getPgPool().query(
    `
      update billing_webhook_event
      set status = $2,
          error = $3,
          processed_at = case when $2 = 'processed' then now() else processed_at end
      where provider = 'stripe' and event_id = $1
    `,
    [eventId, status, error || null]
  )
}

function getBillingPlan(planId: BillingPlanId) {
  return billingPlans.find((plan) => plan.id === planId) || billingPlans[1]
}

function getStripePriceId(planId: BillingPlanId) {
  if (planId === "starter") {
    return process.env.STRIPE_PRICE_STARTER
  }

  return process.env.STRIPE_PRICE_PRO
}

function resolvePlanId(value?: string, priceId?: string | null): BillingPlanId {
  if (value === "starter" || value === "pro") {
    return value
  }

  if (priceId && priceId === process.env.STRIPE_PRICE_STARTER) {
    return "starter"
  }

  return "pro"
}

function normalizeSubscriptionStatus(value?: string) {
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

function getStripeId(value?: string | { id?: string }) {
  if (typeof value === "string") {
    return value
  }
  return value?.id || null
}

function getPriceIdFromObject(object?: StripeBillingObject) {
  return object?.items?.data?.[0]?.price?.id || null
}

function unixSecondsToDate(value?: number) {
  return typeof value === "number" ? new Date(value * 1000) : null
}

function getAppUrl() {
  return process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"
}
