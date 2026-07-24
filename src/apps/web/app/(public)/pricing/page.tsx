import { createTranslator } from "next-intl"

import { PricingPlans } from "@/components/pricing-plans"
import { SiteHeader } from "@/components/site-header"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { getAccountConsoleData } from "@/lib/account"
import { getServerSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function PricingPage() {
  const [locale, session] = await Promise.all([
    getRequestLocale(),
    getServerSession().catch(() => null),
  ])
  const t = createTranslator({
    locale,
    messages: getMessages(locale),
    namespace: "Landing",
  })
  const account = session ? await getAccountConsoleData(session.user) : null

  return (
    <main className="min-h-svh bg-background text-foreground">
      <SiteHeader
        locale={locale}
        navItems={[
          { href: "/#features", label: t("nav.features") },
          { href: "/#modules", label: t("nav.modules") },
          { href: "/#integrations", label: t("nav.integrations") },
          { href: "/pricing", label: t("nav.pricing") },
        ]}
      />

      <section className="mx-auto grid max-w-4xl gap-8 px-6 py-14">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">
            Subscription Flow Example
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            A neutral plan surface wired to the starter billing flow. Replace the
            tiers and copy with your product model when the app has a real business domain.
          </p>
        </div>
        <PricingPlans
          authenticated={Boolean(session)}
          currentPlanId={account?.subscription.plan || null}
        />
      </section>
    </main>
  )
}
