import type { ReactNode } from "react"
import { CheckCircle2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type StatusBadgeTone = "ok" | "warning" | "neutral"

const toneClassName: Record<StatusBadgeTone, string> = {
  ok: "border-success-border bg-success-soft text-success-foreground",
  warning: "border-warning-border bg-warning-soft text-warning-foreground",
  neutral: "border-border bg-secondary text-secondary-foreground",
}

export function StatusBadge({
  tone = "neutral",
  icon = tone === "ok",
  className,
  children,
}: {
  tone?: StatusBadgeTone
  icon?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Badge variant="outline" className={cn(toneClassName[tone], className)}>
      {icon ? <CheckCircle2Icon className="size-3" /> : null}
      {children}
    </Badge>
  )
}
