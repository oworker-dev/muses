import type { LucideIcon } from "lucide-react"
import { ArrowUpRightIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Site Admin
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-normal">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function AdminMetricCard({
  label,
  value,
  detail,
  icon: Icon,
  trend,
  tone = "neutral",
}: {
  label: string
  value: string
  detail?: string
  icon: LucideIcon
  trend?: string
  tone?: "neutral" | "ok" | "warning"
}) {
  return (
    <Card size="sm" className="min-h-32">
      <CardHeader>
        <CardTitle className="text-sm">{label}</CardTitle>
        <CardAction>
          <div className="grid size-9 place-items-center rounded-md border bg-muted">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-normal tabular-nums">
          {value}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {trend ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                tone === "ok"
                  ? "text-success-foreground"
                  : tone === "warning"
                    ? "text-warning-foreground"
                    : "text-muted-foreground"
              )}
            >
              <ArrowUpRightIcon className="size-3" />
              {trend}
            </span>
          ) : null}
          {detail ? <span>{detail}</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function AdminPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function AdminRankedList({
  rows,
  emptyLabel,
}: {
  rows: Array<{ label: string; value: number; detail?: string }>
  emptyLabel: string
}) {
  const max = Math.max(...rows.map((row) => row.value), 1)

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="grid gap-3">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="font-medium tabular-nums">
              {row.value.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Progress
              value={Math.round((row.value / max) * 100)}
              className="h-1.5"
            />
            {row.detail ? (
              <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                {row.detail}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AdminStatusDot({
  tone,
}: {
  tone: "ok" | "warning" | "error" | "neutral"
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        tone === "ok"
          ? "bg-success"
          : tone === "warning"
            ? "bg-warning"
            : tone === "error"
              ? "bg-destructive"
              : "bg-muted-foreground/50"
      )}
    />
  )
}

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <Badge variant="secondary" className="rounded-full">
      {children}
    </Badge>
  )
}
