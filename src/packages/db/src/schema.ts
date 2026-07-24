import { boolean, date, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const billingSubscription = pgTable("billing_subscription", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  monthlyAmountCents: integer("monthly_amount_cents").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const billingWebhookEvent = pgTable("billing_webhook_event", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull(),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true })
});

export const paymentRecord = pgTable("payment_record", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  providerEventId: text("provider_event_id"),
  customerEmail: text("customer_email"),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull(),
  description: text("description"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const analyticsEvent = pgTable("analytics_event", {
  id: text("id").primaryKey(),
  eventName: text("event_name").notNull(),
  path: text("path").notNull(),
  feature: text("feature"),
  referrer: text("referrer"),
  device: text("device"),
  country: text("country"),
  userIdHash: text("user_id_hash"),
  sessionIdHash: text("session_id_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const analyticsDailyRollup = pgTable("analytics_daily_rollup", {
  bucketDate: date("bucket_date").notNull(),
  eventName: text("event_name").notNull(),
  path: text("path").notNull(),
  feature: text("feature").notNull().default("none"),
  device: text("device").notNull().default("unknown"),
  country: text("country").notNull().default("unknown"),
  authenticated: boolean("authenticated").notNull().default(false),
  eventCount: integer("event_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const analyticsHourlyRollup = pgTable("analytics_hourly_rollup", {
  bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  eventName: text("event_name").notNull(),
  path: text("path").notNull(),
  feature: text("feature").notNull().default("none"),
  device: text("device").notNull().default("unknown"),
  country: text("country").notNull().default("unknown"),
  authenticated: boolean("authenticated").notNull().default(false),
  eventCount: integer("event_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const analyticsDailyVisitor = pgTable("analytics_daily_visitor", {
  bucketDate: date("bucket_date").notNull(),
  sessionIdHash: text("session_id_hash").notNull(),
  userIdHash: text("user_id_hash"),
  authenticated: boolean("authenticated").notNull().default(false),
  country: text("country").notNull().default("unknown"),
  device: text("device").notNull().default("unknown"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
});

export const analyticsVisitorActivity = pgTable("analytics_visitor_activity", {
  sessionIdHash: text("session_id_hash").primaryKey(),
  userIdHash: text("user_id_hash"),
  authenticated: boolean("authenticated").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastCountry: text("last_country").notNull().default("unknown"),
  lastDevice: text("last_device").notNull().default("unknown"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const accountActivitySummary = pgTable("account_activity_summary", {
  userId: text("user_id").primaryKey(),
  userIdHash: text("user_id_hash").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastCountry: text("last_country").notNull().default("unknown"),
  lastDevice: text("last_device").notNull().default("unknown"),
  lastPath: text("last_path").notNull().default("/"),
  lastEventName: text("last_event_name").notNull().default("page_view"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
