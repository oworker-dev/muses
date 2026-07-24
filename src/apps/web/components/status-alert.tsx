import type { ComponentProps } from "react"

import { Alert } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

export function SuccessAlert({
  className,
  ...props
}: ComponentProps<typeof Alert>) {
  return (
    <Alert
      className={cn(
        "border-success-border bg-success-soft text-success-foreground",
        className
      )}
      {...props}
    />
  )
}
