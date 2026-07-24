import { CreditCardIcon, ReceiptTextIcon } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { createTranslator } from "next-intl"

import { AccountDashboardShell } from "@/components/account-dashboard-shell"
import { StatusBadge } from "@/components/status-badge"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { getAccountConsoleData } from "@/lib/account"
import { isSiteAdmin } from "@/lib/admin"
import { getServerSession } from "@/lib/auth"
import { billingPlans } from "@/lib/billing"

export const dynamic = "force-dynamic"

export default async function AccountBillingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const [session, locale] = await Promise.all([
    getServerSession(),
    getRequestLocale(),
  ])
  if (!session) {
    redirect("/login?callbackURL=/account/billing")
  }

  const [account, params, siteAdmin] = await Promise.all([
    getAccountConsoleData(session.user),
    searchParams,
    isSiteAdmin(session.user.id, session.user.email),
  ])
  const t = createTranslator({
    locale,
    messages: getMessages(locale),
    namespace: "Account",
  })
  const billingState =
    typeof params?.billing === "string" ? params.billing : null
  const currentPlan =
    billingPlans.find((plan) => plan.id === account.subscription.plan) ||
    billingPlans[0]

  return (
    <AccountDashboardShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      siteAdmin={siteAdmin}
      breadcrumbPage={t("billing.title")}
      copy={{
        brand: "OWorker SaaS",
        console: t("headerEyebrow"),
        account: t("title"),
        overview: t("navOverview"),
        billing: t("navBilling"),
        settings: t("navSettings"),
        admin: t("navSiteAdmin"),
        support: t("navSupport"),
        upgradePlan: t("upgradePlan"),
        signOut: t("signOut"),
        openUserMenu: t("openUserMenu"),
      }}
    >
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <p className="text-sm text-muted-foreground">{t("headerEyebrow")}</p>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t("billing.title")}
          </h1>
        </div>

        {billingState ? (
          <Alert className="px-4 py-3">
            {t("billing.result", { state: billingState })}
          </Alert>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="rounded-md border bg-muted p-2">
                  <CreditCardIcon className="size-4" />
                </div>
                <div>
                  <CardTitle>{t("billing.currentPlan")}</CardTitle>
                  <CardDescription>
                    {t("billing.currentPlanDetail")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label={t("plan")} value={currentPlan.name} />
                <Metric
                  label={t("status")}
                  value={account.subscription.status.replace("_", " ")}
                  badge={account.subscription.status === "active"}
                />
                <Metric
                  label={t("monthly")}
                  value={formatMoney(
                    account.subscription.monthlyAmountCents,
                    locale
                  )}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {currentPlan.id === "pro" ? (
                  <Button className="w-full" disabled variant="outline">
                    <CreditCardIcon />
                    {t("billing.currentPlan")}
                  </Button>
                ) : (
                  <Button asChild className="w-full">
                    <Link href="/pricing">
                      <CreditCardIcon />
                      {t("billing.checkout")}
                    </Link>
                  </Button>
                )}
                <form action="/api/billing/portal" method="post">
                  <Button className="w-full" type="submit" variant="outline">
                    {t("billing.managePortal")}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="rounded-md border bg-muted p-2">
                  <ReceiptTextIcon className="size-4" />
                </div>
                <div>
                  <CardTitle>{t("billing.payments")}</CardTitle>
                  <CardDescription>
                    {t("billing.paymentsDetail")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {account.payments.length > 0 ? (
                  account.payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <p className="font-medium">
                          {payment.description || payment.provider}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {payment.paidAt
                            ? formatDate(payment.paidAt, locale)
                            : t("billing.pending")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-start gap-3 sm:justify-end">
                        <StatusBadge
                          tone={isPaidStatus(payment.status) ? "ok" : "neutral"}
                          icon={isPaidStatus(payment.status)}
                        >
                          {payment.status}
                        </StatusBadge>
                        <p className="font-semibold">
                          {formatMoney(payment.amountCents, locale)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <Alert>{t("billing.noPayments")}</Alert>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AccountDashboardShell>
  )
}

function Metric({
  label,
  value,
  badge = false,
}: {
  label: string
  value: string
  badge?: boolean
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      {badge ? (
        <StatusBadge tone="ok" className="mt-2 capitalize">
          {value}
        </StatusBadge>
      ) : (
        <p className="mt-1 font-medium capitalize">{value}</p>
      )}
    </div>
  )
}

function isPaidStatus(status: string) {
  return status === "paid" || status === "succeeded"
}

function formatMoney(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
