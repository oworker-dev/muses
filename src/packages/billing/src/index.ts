export type BillingPlan = {
  id: "starter" | "pro";
  name: string;
  monthlyAmountCents: number;
  currency: "usd" | "cny";
  support: string;
  features: string[];
};

export type BillingSubscription = {
  plan: BillingPlan["id"];
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
  account: {
    id: string;
    label: string;
  } | null;
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

export type BillingPort = {
  listPlans(): Promise<BillingPlan[]>;
  getState(input: { accountId: string }): Promise<BillingState>;
  createCheckout(input: { accountId: string; email?: string }): Promise<{ url: string }>;
  createPortal(input: { customerId?: string }): Promise<{ url: string }>;
};
