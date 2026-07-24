import type { ReactNode } from "react"

import { BrandLogo } from "@/components/brand-logo"

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <section className="w-full rounded-md border bg-background p-6 shadow-sm">
      <div className="mb-6 flex items-start gap-3">
        <BrandLogo
          width={44}
          height={28}
          alt=""
          className="h-7 w-11 shrink-0 object-contain"
          priority
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">OWorker SaaS</p>
          <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  )
}
