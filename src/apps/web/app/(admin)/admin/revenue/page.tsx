import {
  CreditCardIcon,
  ReceiptTextIcon,
  TrendingUpIcon,
  WalletCardsIcon,
} from "lucide-react"

import { AdminBarChart } from "@/components/admin-charts"
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
import { getAdminRevenue } from "@/lib/admin"

export default async function AdminRevenuePage() {
  const revenue = await getAdminRevenue()
  const paidRows = revenue.rows.filter((row) => isPaid(row.status))
  const unpaidRows = revenue.rows.filter((row) => !isPaid(row.status))
  const average =
    paidRows.length > 0 ? Math.round(revenue.totalCents / paidRows.length) : 0

  return (
    <>
      <AdminPageHeader
        title="Revenue"
        description="Inspect recent provider payment records and the aggregate paid amount captured by the billing boundary."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Paid amount"
          value={formatMoney(revenue.totalCents)}
          detail="From paid records"
          tone="ok"
          icon={TrendingUpIcon}
        />
        <AdminMetricCard
          label="Paid records"
          value={formatNumber(paidRows.length)}
          detail={`${formatNumber(revenue.rows.length)} records loaded`}
          icon={ReceiptTextIcon}
        />
        <AdminMetricCard
          label="Average payment"
          value={formatMoney(average)}
          detail="Paid records only"
          icon={CreditCardIcon}
        />
        <AdminMetricCard
          label="Needs review"
          value={formatNumber(unpaidRows.length)}
          detail="Non-paid statuses"
          tone={unpaidRows.length > 0 ? "warning" : "neutral"}
          icon={WalletCardsIcon}
        />
      </section>

      <AdminPanel
        title="Revenue movement"
        description="Recent payments grouped by recorded date."
        action={<CountBadge>{formatMoney(revenue.totalCents)}</CountBadge>}
      >
        <AdminBarChart
          data={groupPaymentsByDay(paidRows)}
          valueLabel="Revenue"
        />
      </AdminPanel>

      <AdminPanel
        title="Payment records"
        description="Provider records are stored without exposing card secrets."
        action={<CountBadge>{revenue.rows.length} records</CountBadge>}
      >
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revenue.rows.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="max-w-56 truncate">
                    {payment.customerEmail || payment.accountId}
                  </TableCell>
                  <TableCell className="max-w-64 truncate">
                    {payment.description || "Provider payment"}
                  </TableCell>
                  <TableCell className="capitalize">
                    {payment.provider}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={isPaid(payment.status) ? "ok" : "neutral"}
                    >
                      {payment.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {formatDate(payment.paidAt || payment.createdAt)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoney(payment.amountCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </AdminPanel>
    </>
  )
}

function groupPaymentsByDay(
  rows: Array<{ paidAt: string | null; createdAt: string; amountCents: number }>
) {
  const grouped = new Map<string, number>()

  for (const row of rows) {
    const date = new Date(row.paidAt || row.createdAt)
    const key = date.toISOString().slice(0, 10)
    grouped.set(key, (grouped.get(key) || 0) + row.amountCents)
  }

  const data = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, cents]) => ({
      label: formatDay(date),
      value: Math.round(cents / 100),
    }))

  return data.length > 0 ? data : [{ label: "Today", value: 0 }]
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value))
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}
