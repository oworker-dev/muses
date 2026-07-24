import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  SearchIcon,
  WebhookIcon,
} from "lucide-react"

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
import { getAdminDiagnostics } from "@/lib/admin"

export default async function AdminDiagnosticsPage() {
  const events = await getAdminDiagnostics()
  const processed = events.filter(
    (event) => event.status === "processed"
  ).length
  const pending = events.filter((event) => event.status !== "processed").length
  const errors = events.filter((event) => event.error).length
  const providers = new Set(events.map((event) => event.provider)).size

  return (
    <>
      <AdminPageHeader
        title="Diagnostics"
        description="Recent provider and webhook processing records for integration debugging."
        action={<CountBadge>{events.length} latest events</CountBadge>}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Events"
          value={formatNumber(events.length)}
          detail="Loaded from webhook records"
          icon={WebhookIcon}
        />
        <AdminMetricCard
          label="Processed"
          value={formatNumber(processed)}
          detail="Completed events"
          tone="ok"
          icon={CheckCircle2Icon}
        />
        <AdminMetricCard
          label="Needs review"
          value={formatNumber(pending)}
          detail="Non-processed events"
          tone={pending > 0 ? "warning" : "neutral"}
          icon={AlertTriangleIcon}
        />
        <AdminMetricCard
          label="Providers"
          value={formatNumber(providers)}
          detail={`${formatNumber(errors)} errors recorded`}
          icon={SearchIcon}
        />
      </section>

      <AdminPanel
        title="Provider events"
        description="Troubleshooting view for webhook and provider delivery records."
      >
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Event type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Processed</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={`${event.provider}-${event.eventId}`}>
                  <TableCell className="capitalize">{event.provider}</TableCell>
                  <TableCell className="max-w-64 truncate">
                    {event.eventType}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={event.status === "processed" ? "ok" : "warning"}
                      className="capitalize"
                    >
                      {event.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{formatDate(event.receivedAt)}</TableCell>
                  <TableCell>
                    {event.processedAt ? formatDate(event.processedAt) : "—"}
                  </TableCell>
                  <TableCell className="max-w-80 truncate text-muted-foreground">
                    {event.error || "—"}
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
