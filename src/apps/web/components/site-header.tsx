import Link from "next/link"
import { SiGithub } from "react-icons/si"

import { BrandLogo } from "@/components/brand-logo"
import { LanguageSwitcher } from "@/components/language-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserMenu } from "@/components/user-menu"
import type { AppLocale } from "@/i18n/config"
import { cn } from "@/lib/utils"

const sourceUrl = "https://github.com/oworker-dev/oworker"

export type SiteHeaderNavItem = {
  href: string
  label: string
}

export function SiteHeader({
  locale,
  navItems = [],
  className,
  contentClassName,
  maxWidth = "max-w-7xl",
  sticky = true,
}: {
  locale: AppLocale
  navItems?: SiteHeaderNavItem[]
  className?: string
  contentClassName?: string
  maxWidth?: string
  sticky?: boolean
}) {
  return (
    <header
      className={cn(
        "border-b bg-background/95 backdrop-blur",
        sticky ? "sticky top-0 z-20" : null,
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6",
          maxWidth,
          contentClassName
        )}
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap sm:gap-3 sm:text-base"
        >
          <BrandLogo
            alt=""
            width={44}
            height={28}
            className="h-7 w-11 shrink-0 object-contain"
            priority
          />
          OWorker SaaS
        </Link>

        {navItems.length > 0 ? (
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href={sourceUrl}
            className="hidden size-9 place-items-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:grid"
            aria-label="GitHub repository"
          >
            <SiGithub className="size-4" aria-hidden="true" />
          </Link>
          <LanguageSwitcher locale={locale} />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
