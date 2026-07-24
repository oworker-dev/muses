export type ApplicationHealth = {
  status: "ok" | "degraded";
  service: string;
};

export type IntegrationStatus = {
  provider: string;
  status: "ok" | "not_configured" | "error";
  detail?: string;
};

export type SaaSHealth = ApplicationHealth & {
  runtime: "next" | "hono" | "mcp" | "worker";
  integrations?: Record<string, IntegrationStatus>;
};

export type AccountSummary = {
  id: string;
  label: string;
};

export type BillingPlanId = "starter" | "pro";

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  monthlyAmountCents: number;
  support: string;
  features: string[];
};

export type BillingSubscription = {
  plan: BillingPlanId;
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | "paused"
    | "local_test";
  monthlyAmountCents: number;
  currentPeriodEnd: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export type BillingState = {
  provider: "stripe" | "local-test";
  account: AccountSummary | null;
  subscription: BillingSubscription | null;
};

export type PaymentRecord = {
  id: string;
  provider: string;
  amountCents: number;
  currency: string;
  status: string;
  description: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type AnalyticsSummary = {
  since: string;
  until: string;
  pageViews: number;
  uniqueVisitors: number;
  signedInVisitors: number;
  activeVisitors: number;
  topPaths: Array<{ path: string; count: number }>;
  topFeatures: Array<{ feature: string; count: number }>;
  devices: Array<{ device: string; count: number }>;
  countries: Array<{ country: string; count: number }>;
  dailyTrend: Array<{ date: string; pageViews: number }>;
};

export type AnalyticsEventResult = {
  ok: boolean;
  recorded: boolean;
};

export type PresignedUpload = {
  provider: "s3-compatible";
  bucket: string;
  key: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
};

export type AvatarUpload = PresignedUpload & {
  maxBytes: number;
};

export type SaaSConsole = {
  account: AccountSummary;
  subscription: BillingSubscription;
  integrations: Record<string, IntegrationStatus>;
};

export const APPLICATION_SERVICE_ID = "oworker.saas-starter";
