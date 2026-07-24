import {
  AlertTriangleIcon,
  FileClockIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from "lucide-react"

import {
  AdminMetricCard,
  AdminPageHeader,
  AdminPanel,
  CountBadge,
} from "@/components/admin-dashboard-widgets"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getAdminAuditLogs } from "@/lib/admin"

export default async function AdminAuditLogsPage() {
  const logs = await getAdminAuditLogs()
  const actors = new Set(logs.map((log) => log.actorEmail)).size
  const targets = new Set(logs.map((log) => log.targetType)).size
  const highRisk = logs.filter((log) => getRisk(log.action) === "high").length

  return (
    <>
      <AdminPageHeader
        title="Security Audit"
        description="Sensitive account, billing, and administrative mutations. Regular page views are kept in aggregate analytics."
        action={<CountBadge>{logs.length} latest entries</CountBadge>}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Entries"
          value={formatNumber(logs.length)}
          detail="Loaded for review"
          icon={FileClockIcon}
        />
        <AdminMetricCard
          label="Actors"
          value={formatNumber(actors)}
          detail="Unique actor emails"
          icon={UserCircleIcon}
        />
        <AdminMetricCard
          label="Target types"
          value={formatNumber(targets)}
          detail="Affected record groups"
          icon={ShieldCheckIcon}
        />
        <AdminMetricCard
          label="High risk"
          value={formatNumber(highRisk)}
          detail="Derived from action type"
          tone={highRisk > 0 ? "warning" : "neutral"}
          icon={AlertTriangleIcon}
        />
      </section>

      <AdminPanel
        title="Audit entries"
        description="Metadata is intentionally summarized and should not include secrets or sensitive input."
      >
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const risk = getRisk(log.action)
                return (
                  <TableRow key={log.id}>
                    <TableCell>{formatDate(log.createdAt)}</TableCell>
                    <TableCell className="max-w-56 truncate">
                      {log.actorEmail}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatAction(log.action)}
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      {log.targetType}
                      {log.targetId ? `:${log.targetId}` : ""}
                    </TableCell>
                    <TableCell>
                      <RiskBadge risk={risk} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {Object.keys(log.metadata).length} fields
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </AdminPanel>
    </>
  )
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  if (risk === "high") {
    return <StatusBadge tone="warning">High</StatusBadge>
  }
  if (risk === "medium") {
    return <StatusBadge tone="neutral">Medium</StatusBadge>
  }
  return <StatusBadge tone="ok">Low</StatusBadge>
}

function getRisk(action: string): "low" | "medium" | "high" {
  const normalized = action.toLowerCase()
  if (
    normalized.includes("delete") ||
    normalized.includes("disable") ||
    normalized.includes("refund") ||
    normalized.includes("export")
  ) {
    return "high"
  }
  if (
    normalized.includes("password") ||
    normalized.includes("email") ||
    normalized.includes("subscription") ||
    normalized.includes("oauth")
  ) {
    return "medium"
  }
  return "low"
}

function formatAction(value: string) {
  return value.replaceAll(".", " ")
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
