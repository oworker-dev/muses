"use client"

import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  AdminMetricCard,
  AdminPanel,
  AdminRankedList,
  AdminStatusDot,
  CountBadge,
} from "@/components/admin-dashboard-widgets"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { IntegrationStatus } from "@/lib/saas-console"

type AdminHealthResponse = {
  checkedAt: string
  integrations: Record<string, IntegrationStatus>
}

type HealthState =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ready"; data: AdminHealthResponse; error?: undefined }
  | { status: "error"; data?: undefined; error: string }

let inFlightHealthRequest: Promise<AdminHealthResponse> | null = null

export function AdminServiceHealthSummary() {
  const health = useAdminHealth()
  const rows =
    health.status === "ready" ? Object.entries(health.data.integrations) : []
  const issues = getIssues(rows)

  return (
    <AdminPanel
      title="Service health"
      description="Live runtime checks for provider boundaries."
      action={
        <CountBadge>
          {health.status === "loading"
            ? "Checking"
            : health.status === "error"
              ? "Unavailable"
              : issues.length === 0
                ? "All clear"
                : `${issues.length} issues`}
        </CountBadge>
      }
    >
      {health.status === "loading" ? (
        <HealthLoadingRows />
      ) : health.status === "error" ? (
        <HealthErrorMessage message={health.error} />
      ) : (
        <div className="grid gap-3">
          {rows.slice(0, 8).map(([name, status]) => (
            <ServiceStatusRow key={name} name={name} status={status} />
          ))}
        </div>
      )}
    </AdminPanel>
  )
}

export function AdminOperationalIssuesPanel() {
  const health = useAdminHealth()
  const rows =
    health.status === "ready" ? Object.entries(health.data.integrations) : []
  const issues = getIssues(rows)

  return (
    <AdminPanel
      title="Operational issues"
      description="Provider boundaries that need attention."
      action={
        <CountBadge>{health.status === "ready" ? issues.length : 0}</CountBadge>
      }
    >
      {health.status === "loading" ? (
        <p className="text-sm text-muted-foreground">
          Checking runtime boundaries...
        </p>
      ) : health.status === "error" ? (
        <HealthErrorMessage message={health.error} />
      ) : (
        <AdminRankedList
          emptyLabel="No degraded provider boundary."
          rows={issues.map(([name, status]) => ({
            label: name.replaceAll("_", " "),
            value: 1,
            detail: status.status.replaceAll("_", " "),
          }))}
        />
      )}
    </AdminPanel>
  )
}

export function AdminHealthRuntimePanel() {
  const health = useAdminHealth()
  const rows = useMemo(
    () =>
      health.status === "ready" ? Object.entries(health.data.integrations) : [],
    [health]
  )
  const ok = rows.filter(([, status]) => status.status === "ok").length
  const degraded = rows.filter(
    ([, status]) => status.status !== "ok" && status.status !== "not_configured"
  ).length
  const notConfigured = rows.filter(
    ([, status]) => status.status === "not_configured"
  ).length

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="OK"
          value={health.status === "ready" ? formatNumber(ok) : "-"}
          detail="Healthy services"
          tone="ok"
          icon={CheckCircle2Icon}
        />
        <AdminMetricCard
          label="Degraded"
          value={health.status === "ready" ? formatNumber(degraded) : "-"}
          detail="Needs attention"
          tone={degraded > 0 ? "warning" : "neutral"}
          icon={AlertTriangleIcon}
        />
        <AdminMetricCard
          label="Not configured"
          value={health.status === "ready" ? formatNumber(notConfigured) : "-"}
          detail="Optional providers"
          icon={CircleDashedIcon}
        />
        <AdminMetricCard
          label="Checks"
          value={health.status === "ready" ? formatNumber(rows.length) : "-"}
          detail="Runtime boundaries"
          icon={ActivityIcon}
        />
      </section>

      <AdminPanel
        title="Service status"
        description={
          health.status === "ready"
            ? `Last checked ${formatTime(health.data.checkedAt)}.`
            : "Provider boundary status and next-step context."
        }
      >
        {health.status === "loading" ? (
          <HealthLoadingRows />
        ) : health.status === "error" ? (
          <HealthErrorMessage message={health.error} />
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(([name, status]) => (
                  <TableRow key={name}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium capitalize">
                        <AdminStatusDot tone={getStatusTone(status.status)} />
                        {name.replaceAll("_", " ")}
                      </div>
                    </TableCell>
                    <TableCell>{status.provider}</TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={status.status === "ok" ? "ok" : "warning"}
                        icon={status.status === "ok"}
                        className="capitalize"
                      >
                        {status.status.replaceAll("_", " ")}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="min-w-72 text-muted-foreground">
                      {status.detail}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </AdminPanel>
    </>
  )
}

function useAdminHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false

    requestAdminHealth()
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", data })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}

function requestAdminHealth() {
  if (!inFlightHealthRequest) {
    inFlightHealthRequest = fetch("/api/admin/health", {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health request returned ${response.status}.`)
        }
        return (await response.json()) as AdminHealthResponse
      })
      .finally(() => {
        inFlightHealthRequest = null
      })
  }

  return inFlightHealthRequest
}

function ServiceStatusRow({
  name,
  status,
}: {
  name: string
  status: IntegrationStatus
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <AdminStatusDot tone={getStatusTone(status.status)} />
        <span className="truncate font-medium capitalize">
          {name.replaceAll("_", " ")}
        </span>
      </div>
      <span className="text-muted-foreground capitalize">
        {status.status.replaceAll("_", " ")}
      </span>
      <span className="text-right text-muted-foreground">
        {status.provider}
      </span>
    </div>
  )
}

function HealthLoadingRows() {
  return (
    <div className="grid gap-3">
      {["API", "Database", "Cache", "Storage"].map((label) => (
        <div
          key={label}
          className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Checking
          </span>
        </div>
      ))}
    </div>
  )
}

function HealthErrorMessage({ message }: { message: string }) {
  return (
    <div className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="font-medium text-destructive">Health status unavailable.</p>
      <p className="text-muted-foreground">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => window.location.reload()}
      >
        Retry
      </Button>
    </div>
  )
}

function getIssues(rows: Array<[string, IntegrationStatus]>) {
  return rows.filter(([, status]) => status.status !== "ok")
}

function getStatusTone(status: IntegrationStatus["status"]) {
  if (status === "ok") {
    return "ok"
  }
  if (status === "error") {
    return "error"
  }
  return "warning"
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}
