import type { ReactNode } from "react"

import { LanguageSwitcher } from "@/components/language-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { getRequestLocale } from "@/i18n/server"

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale()

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-muted/30 px-4 py-20 sm:p-6">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2 sm:right-6 sm:top-6">
        <LanguageSwitcher locale={locale} />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}
