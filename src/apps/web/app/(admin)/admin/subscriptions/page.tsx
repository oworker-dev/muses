import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleOffIcon,
  FlaskConicalIcon,
  RefreshCcwIcon,
} from "lucide-react"

import { AdminDonutChart } from "@/components/admin-charts"
import {
  AdminMetricCard,
  AdminPageHeader,
  AdminPanel,
  CountBadge,
} from "@/components/admin-dashboard-widgets"
import { StatusBadge } from "@/components/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getAdminSubscriptions } from "@/lib/admin"

export default async function AdminSubscriptionsPage() {
  const subscriptions = await getAdminSubscriptions()
  const counts = countByStatus(subscriptions)
  const active = getStatusCount(counts, "active")
  const trialing = getStatusCount(counts, "trialing")
  const pastDue = getStatusCount(counts, "past_due")
  const canceled = getStatusCount(counts, "canceled")
  const localTest = subscriptions.filter(
    (row) => !row.stripeSubscriptionId
  ).length

  return (
    <>
      <AdminPageHeader
        title="Subscriptions"
        description="Inspect subscription state synchronized by checkout, portal, webhook, and local-test flows."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AdminMetricCard
          label="Active"
          value={formatNumber(active)}
          detail="Current subscribers"
          tone="ok"
          icon={CheckCircle2Icon}
        />
        <AdminMetricCard
          label="Trialing"
          value={formatNumber(trialing)}
          detail="Trial state"
          icon={RefreshCcwIcon}
        />
        <AdminMetricCard
          label="Past due"
          value={formatNumber(pastDue)}
          detail="Payment issue"
          tone={pastDue > 0 ? "warning" : "neutral"}
          icon={AlertTriangleIcon}
        />
        <AdminMetricCard
          label="Canceled"
          value={formatNumber(canceled)}
          detail="Canceled records"
          icon={CircleOffIcon}
        />
        <AdminMetricCard
          label="Local test"
          value={formatNumber(localTest)}
          detail="No provider id"
          icon={FlaskConicalIcon}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
        <AdminPanel
          title="Status mix"
          description="Current status distribution."
          action={<CountBadge>{subscriptions.length} total</CountBadge>}
        >
          <AdminDonutChart
            data={Object.entries(counts).map(([label, value]) => ({
              label: label.replaceAll("_", " "),
              value,
              color: getStatusColor(label),
            }))}
          />
        </AdminPanel>

        <AdminPanel
          title="Subscription records"
          description="Provider identifiers are shown only as operational references."
          action={<CountBadge>{subscriptions.length} records</CountBadge>}
        >
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Current period end</TableHead>
                  <TableHead>Provider subscription</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((subscription) => (
                  <TableRow key={subscription.id}>
                    <TableCell className="max-w-48 truncate">
                      {subscription.accountId}
                    </TableCell>
                    <TableCell className="capitalize">
                      {subscription.plan}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          subscription.status === "active" ? "ok" : "neutral"
                        }
                        className="capitalize"
                      >
                        {subscription.status.replaceAll("_", " ")}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {formatMoney(subscription.monthlyAmountCents)}
                    </TableCell>
                    <TableCell>
                      {subscription.currentPeriodEnd
                        ? formatDate(subscription.currentPeriodEnd)
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      {subscription.stripeSubscriptionId ||
                        "local subscription"}
                    </TableCell>
                    <TableCell>{formatDate(subscription.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </AdminPanel>
      </section>
    </>
  )
}

function countByStatus(rows: Array<{ status: string }>) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1
    return counts
  }, {})
}

function getStatusCount(counts: Record<string, number>, status: string) {
  return counts[status] || 0
}

function getStatusColor(status: string) {
  if (status === "active") {
    return "var(--success)"
  }
  if (status === "past_due" || status === "unpaid") {
    return "var(--warning)"
  }
  if (status === "canceled") {
    return "var(--muted-foreground)"
  }
  return "var(--chart-2)"
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
    new Date(value)
  )
}
