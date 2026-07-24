import Link from "next/link"
import type { ReactNode } from "react"

import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { getRequestLocale } from "@/i18n/server"

export async function PublicContentShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const locale = await getRequestLocale()

  return (
    <main className="min-h-svh bg-background text-foreground">
      <SiteHeader locale={locale} maxWidth="max-w-5xl" sticky={false} />

      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 sm:py-16">
        <section className="grid max-w-3xl gap-4">
          <Badge variant="secondary">Template page</Badge>
          <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">{title}</h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {description}
          </p>
        </section>

        <section className="grid max-w-3xl gap-0">{children}</section>

        <footer className="flex max-w-3xl flex-wrap items-center gap-4 border-t pt-6 text-sm text-muted-foreground">
          <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
            Home
          </Link>
          <Link href="/support" className="underline-offset-4 hover:text-foreground hover:underline">
            Support
          </Link>
          <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
            Terms
          </Link>
        </footer>
      </div>
    </main>
  )
}

export function ContentSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <article className="border-t py-6 first:border-t-0 first:pt-0">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </article>
  )
}
