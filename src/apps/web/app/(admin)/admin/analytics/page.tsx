import {
  ActivityIcon,
  EyeIcon,
  RadioIcon,
  TrendingUpIcon,
  UserCheckIcon,
} from "lucide-react"

import { AdminAreaChart } from "@/components/admin-charts"
import {
  AdminMetricCard,
  AdminPageHeader,
  AdminPanel,
  AdminRankedList,
} from "@/components/admin-dashboard-widgets"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { getAnalyticsSummary } from "@/lib/analytics"

export default async function AdminAnalyticsPage() {
  const [today, week, month] = await Promise.all([
    getAnalyticsSummary(1),
    getAnalyticsSummary(7),
    getAnalyticsSummary(30),
  ])
  const dau = today.uniqueVisitors
  const wau = week.uniqueVisitors
  const mau = month.uniqueVisitors
  const deviceTotal = sumCounts(week.devices)
  const countryTotal = sumCounts(week.countries)

  return (
    <>
      <AdminPageHeader
        title="Analytics"
        description="First-party aggregate activity without raw IP storage, session replay, or advertising attribution."
        action={<Badge variant="secondary">Last 30 days</Badge>}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AdminMetricCard
          label="Page views"
          value={formatNumber(month.pageViews)}
          detail="Last 30 days"
          trend={`${formatNumber(today.pageViews)} today`}
          tone="ok"
          icon={EyeIcon}
        />
        <AdminMetricCard
          label="Visitors"
          value={formatNumber(month.uniqueVisitors)}
          detail="Anonymous sessions"
          trend={`${formatNumber(week.uniqueVisitors)} this week`}
          tone="ok"
          icon={ActivityIcon}
        />
        <AdminMetricCard
          label="Signed-in visitors"
          value={formatNumber(month.signedInVisitors)}
          detail="Hashed account association"
          trend={`${formatNumber(today.signedInVisitors)} today`}
          tone="ok"
          icon={UserCheckIcon}
        />
        <AdminMetricCard
          label="Active now"
          value={formatNumber(today.activeVisitors)}
          detail="Seen in five minutes"
          trend="Live"
          tone="ok"
          icon={RadioIcon}
        />
        <AdminMetricCard
          label="Conversion signal"
          value={formatPercent(
            getRatio(month.signedInVisitors, month.uniqueVisitors)
          )}
          detail="Signed-in / visitors"
          trend="neutral"
          icon={TrendingUpIcon}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <AdminPanel
          title="Page views trend"
          description="Daily page views from the analytics rollup table."
          action={<Badge variant="secondary">Daily</Badge>}
        >
          <AdminAreaChart
            data={normalizeTrend(month.dailyTrend)}
            valueLabel="Page views"
          />
        </AdminPanel>

        <AdminPanel title="DAU / WAU / MAU" description="Activity ratios.">
          <div className="grid gap-5">
            <RatioRow label="DAU" value={dau} total={mau} caption="DAU / MAU" />
            <RatioRow label="WAU" value={wau} total={mau} caption="WAU / MAU" />
            <RatioRow label="DAU" value={dau} total={wau} caption="DAU / WAU" />
          </div>
        </AdminPanel>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <AdminPanel title="Top pages">
          <AdminRankedList
            emptyLabel="No page views yet."
            rows={week.topPaths.map((row) => ({
              label: row.path,
              value: row.count,
              detail: formatPercent(getRatio(row.count, week.pageViews)),
            }))}
          />
        </AdminPanel>
        <AdminPanel title="Neutral events">
          <AdminRankedList
            emptyLabel="No events yet."
            rows={week.topFeatures.map((row) => ({
              label: row.feature,
              value: row.count,
            }))}
          />
        </AdminPanel>
        <AdminPanel title="Devices">
          <AdminRankedList
            emptyLabel="No devices yet."
            rows={week.devices.map((row) => ({
              label: row.device,
              value: row.count,
              detail: formatPercent(getRatio(row.count, deviceTotal)),
            }))}
          />
        </AdminPanel>
        <AdminPanel title="Countries">
          <AdminRankedList
            emptyLabel="No countries yet."
            rows={week.countries.map((row) => ({
              label: row.country,
              value: row.count,
              detail: formatPercent(getRatio(row.count, countryTotal)),
            }))}
          />
        </AdminPanel>
      </section>
    </>
  )
}

function RatioRow({
  label,
  value,
  total,
  caption,
}: {
  label: string
  value: number
  total: number
  caption: string
}) {
  const ratio = getRatio(value, total)

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatNumber(value)}
          </p>
        </div>
        <span className="text-sm text-muted-foreground">{caption}</span>
      </div>
      <Progress value={Math.round(ratio * 100)} />
      <p className="text-sm font-medium tabular-nums">{formatPercent(ratio)}</p>
    </div>
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

function getRatio(value: number, total: number) {
  return total > 0 ? Math.min(value / total, 1) : 0
}

function sumCounts(rows: Array<{ count: number }>) {
  return rows.reduce((sum, row) => sum + row.count, 0)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}
