import {
  ActivityIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
import Link from "next/link"

import { AdminBarChart } from "@/components/admin-charts"
import {
  AdminMetricCard,
  AdminPageHeader,
  AdminPanel,
  CountBadge,
} from "@/components/admin-dashboard-widgets"
import {
  AdminOperationalIssuesPanel,
  AdminServiceHealthSummary,
} from "@/components/admin-health-client"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { getAdminOverview, getAdminRevenue, getAdminUsers } from "@/lib/admin"

export default async function AdminOverviewPage() {
  const [overview, users, revenue] = await Promise.all([
    getAdminOverview(),
    getAdminUsers(),
    getAdminRevenue(),
  ])
  const today = overview.analytics.today
  const week = overview.analytics.week
  const recentUsers = users.slice(0, 5)
  const recentPayments = revenue.rows.slice(0, 5)

  return (
    <>
      <AdminPageHeader
        title="Admin Console"
        description="Monitor acquisition, accounts, revenue, service health, and operational issues from one neutral SaaS control surface."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Visitors today"
          value={formatNumber(today.uniqueVisitors)}
          detail={`${formatNumber(today.pageViews)} page views`}
          trend="live rollup"
          tone="ok"
          icon={ActivityIcon}
        />
        <AdminMetricCard
          label="Signed-in visitors"
          value={formatNumber(today.signedInVisitors)}
          detail={`${formatNumber(today.activeVisitors)} active now`}
          trend="authenticated"
          tone="ok"
          icon={ShieldCheckIcon}
        />
        <AdminMetricCard
          label="New users"
          value={formatNumber(overview.users.newToday)}
          detail={`${formatNumber(overview.users.verified)} verified total`}
          trend={`${formatNumber(overview.users.total)} accounts`}
          tone="neutral"
          icon={UsersIcon}
        />
        <AdminMetricCard
          label="Revenue 30d"
          value={formatMoney(overview.revenue.amountCents)}
          detail={`${formatNumber(overview.revenue.payments)} paid records`}
          trend={`${formatMoney(overview.revenue.todayAmountCents)} today`}
          tone="ok"
          icon={CreditCardIcon}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <AdminPanel
          title="Site movement"
          description="Page-view movement from the last seven calendar days."
          action={<CountBadge>{formatNumber(week.pageViews)} views</CountBadge>}
        >
          <AdminBarChart
            data={normalizeTrend(week.dailyTrend)}
            valueLabel="Page views"
          />
        </AdminPanel>

        <AdminServiceHealthSummary />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <AdminPanel
          title="Recent signups"
          description="Latest account lifecycle records."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/users">View all</Link>
            </Button>
          }
          className="xl:col-span-1"
        >
          <div className="divide-y rounded-md border">
            {recentUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {user.name || user.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </p>
                </div>
                <StatusBadge
                  tone={user.emailVerified ? "ok" : "warning"}
                  className="shrink-0 whitespace-nowrap"
                >
                  {user.emailVerified ? "Verified" : "Pending"}
                </StatusBadge>
              </div>
            ))}
          </div>
        </AdminPanel>

        <AdminPanel
          title="Recent payments"
          description="Latest provider payment records."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/revenue">View all</Link>
            </Button>
          }
          className="xl:col-span-1"
        >
          <div className="divide-y rounded-md border">
            {recentPayments.map((payment) => (
              <div
                key={payment.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {payment.customerEmail || payment.accountId}
                  </p>
                  <StatusBadge
                    tone={isPaid(payment.status) ? "ok" : "neutral"}
                    className="mt-1 w-fit max-w-full whitespace-nowrap"
                  >
                    {payment.status}
                  </StatusBadge>
                </div>
                <span className="font-medium tabular-nums">
                  {formatMoney(payment.amountCents)}
                </span>
              </div>
            ))}
          </div>
        </AdminPanel>

        <AdminOperationalIssuesPanel />
      </section>
    </>
  )
}

function normalizeTrend(rows: Array<{ date: string; pageViews: number }>) {
  if (rows.length === 0) {
    return [{ label: "Today", value: 0 }]
  }

  return rows.map((row) => ({
    label: formatDay(row.date),
    value: row.pageViews,
  }))
}

function isPaid(status: string) {
  return status === "paid" || status === "succeeded"
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}
