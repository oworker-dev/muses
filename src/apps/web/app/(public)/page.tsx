import type { LucideIcon } from "lucide-react"
import {
  BoxesIcon,
  CheckIcon,
  CreditCardIcon,
  DatabaseIcon,
  FileTextIcon,
  GaugeIcon,
  KeyRoundIcon,
  MailIcon,
  PlugIcon,
  SearchCheckIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  UserCircleIcon,
  WorkflowIcon,
} from "lucide-react"
import Link from "next/link"
import { createTranslator } from "next-intl"

import { BrandLogo } from "@/components/brand-logo"
import { CommandCopy } from "@/components/command-copy"
import { PricingPlans } from "@/components/pricing-plans"
import { SiteHeader } from "@/components/site-header"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { getAccountConsoleData } from "@/lib/account"
import { getServerSession } from "@/lib/auth"

const principles = [
  {
    title: "Modular",
    detail:
      "Web, API, worker, provider ports, contracts, and generated interfaces stay separate.",
    icon: BoxesIcon,
  },
  {
    title: "Agent-readable",
    detail:
      "ANSS, OpenAPI, MCP, Skills manifests, and service maps make capabilities discoverable.",
    icon: SparklesIcon,
  },
  {
    title: "Secure by default",
    detail:
      "Email verification, protected routes, OAuth boundaries, and audit-ready mutations.",
    icon: ShieldCheckIcon,
  },
  {
    title: "Developer first",
    detail:
      "CLI creation, local development helpers, Docker helpers, checks, and replacement boundaries.",
    icon: TerminalIcon,
  },
  {
    title: "Operable",
    detail:
      "Admin, analytics, health, audit logs, and diagnostics are available without business lock-in.",
    icon: GaugeIcon,
  },
  {
    title: "Extensible",
    detail:
      "Provider ports keep database, cache, queue, storage, email, billing, and observability replaceable.",
    icon: PlugIcon,
  },
]

const modules = [
  {
    name: "Auth",
    detail: "Email, OAuth, sessions, reset, verification.",
    icon: KeyRoundIcon,
  },
  {
    name: "Account",
    detail: "Profile, avatar, security, connected accounts.",
    icon: UserCircleIcon,
  },
  {
    name: "Billing",
    detail: "Checkout, portal, webhooks, payment records.",
    icon: CreditCardIcon,
  },
  {
    name: "Admin",
    detail: "Users, revenue, subscriptions, health, diagnostics.",
    icon: ShieldCheckIcon,
  },
  {
    name: "Analytics",
    detail: "First-party events, rollups, top pages, devices.",
    icon: GaugeIcon,
  },
  {
    name: "API",
    detail: "Hono capability contracts and health endpoints.",
    icon: ServerIcon,
  },
  {
    name: "Worker",
    detail: "Queue-ready background processing boundary.",
    icon: WorkflowIcon,
  },
  {
    name: "ANSS",
    detail: "Service discovery, OpenAPI, MCP, Skills install.",
    icon: SearchCheckIcon,
  },
  {
    name: "Email",
    detail: "Verification and password reset delivery.",
    icon: MailIcon,
  },
  {
    name: "Storage",
    detail: "S3-compatible avatar and object boundary.",
    icon: DatabaseIcon,
  },
  {
    name: "CLI",
    detail: "Thin command adapter generated from contracts.",
    icon: TerminalIcon,
  },
  {
    name: "Docs",
    detail: "Agent guide, llms.txt, manifest, service map.",
    icon: FileTextIcon,
  },
]

const integrations = [
  ["Stripe", "Payments"],
  ["GitHub", "OAuth"],
  ["Google", "OAuth"],
  ["Resend", "Email"],
  ["PostgreSQL", "Database"],
  ["S3", "Storage"],
  ["Valkey", "Cache"],
  ["BullMQ", "Queue"],
  ["ANSS", "Discovery"],
  ["MCP", "Agent tools"],
  ["OpenAPI", "HTTP contract"],
  ["Skills", "Install manifest"],
]

const command = "oworker starter create saas"
export const dynamic = "force-dynamic"

export default async function HomePage() {
  const [locale, session] = await Promise.all([
    getRequestLocale(),
    getServerSession().catch(() => null),
  ])
  const account = session
    ? await getAccountConsoleData(session.user).catch(() => null)
    : null
  const t = createTranslator({
    locale,
    messages: getMessages(locale),
    namespace: "Landing",
  })

  return (
    <main className="min-h-svh overflow-x-hidden bg-background text-foreground">
      <SiteHeader
        locale={locale}
        navItems={[
          { href: "/#features", label: t("nav.features") },
          { href: "/#modules", label: t("nav.modules") },
          { href: "/#integrations", label: t("nav.integrations") },
          { href: "/pricing", label: t("nav.pricing") },
        ]}
      />

      <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-20 pb-16 text-center md:pt-28">
        <span className="rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {t("hero.badge")}
        </span>
        <h1 className="mt-6 w-full min-w-0 text-3xl leading-[1.08] font-semibold tracking-normal min-[420px]:text-4xl sm:text-5xl md:text-7xl">
          {t("hero.headlineLine1")}
          <br />
          {t("hero.headlineLine2")}
        </h1>
        <p className="mt-6 w-full max-w-2xl min-w-0 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
          {t("hero.description")}
        </p>
        <div className="mt-9 flex w-full justify-center">
          <CommandCopy command={command} />
        </div>
        <div className="mt-10 flex w-full min-w-0 flex-wrap justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
          {[
            "TypeScript first",
            "Open source",
            "MIT license",
            "Agent-ready",
          ].map((item) => (
            <span key={item} className="inline-flex items-center gap-2">
              <CheckIcon className="size-4" />
              {item}
            </span>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-6 py-12">
        <SectionHeading
          title="Architecture Principles"
          detail="Built with modern SaaS foundations and a deliberately neutral product surface."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {principles.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-6xl px-6 py-12">
        <SectionHeading
          title="Core Modules"
          detail="Stable baseline capabilities that can be kept, replaced, or extended by the product owner."
          align="left"
        />
        <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((item) => (
            <ModuleCard key={item.name} {...item} />
          ))}
        </div>
      </section>

      <section id="integrations" className="mx-auto max-w-6xl px-6 py-12">
        <SectionHeading
          title="Integrations"
          detail="Provider boundaries are visible by default and optional until configured."
          align="left"
        />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {integrations.map(([name, detail]) => (
            <div
              key={name}
              className="rounded-md border bg-card p-4 text-card-foreground shadow-sm"
            >
              <p className="font-medium">{name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-6 py-14">
        <SectionHeading
          title="Subscription Flow Example"
          detail="A neutral billing surface wired to the starter subscription flow. Replace the tiers and copy with the product owner's real model."
        />
        <div className="mx-auto mt-8 max-w-4xl">
          <PricingPlans
            authenticated={Boolean(session)}
            currentPlanId={account?.subscription.plan || null}
          />
        </div>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          These plans are example data for the starter. They demonstrate billing
          structure without defining OWorker SaaS Starter as a paid product.
        </p>
      </section>

      <footer className="mx-auto max-w-7xl border-t px-6 py-8 text-sm text-muted-foreground">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <BrandLogo
              alt=""
              width={40}
              height={24}
              className="h-6 w-10 shrink-0 object-contain"
            />
            <div>
              <p className="font-medium text-foreground">OWorker SaaS</p>
              <p>
                A neutral foundation for building high-quality SaaS
                applications.
              </p>
            </div>
          </div>
          <div className="flex gap-5">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#modules" className="hover:text-foreground">
              Modules
            </a>
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/support" className="hover:text-foreground">
              Support
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}

function SectionHeading({
  title,
  detail,
  align = "center",
}: {
  title: string
  detail: string
  align?: "left" | "center"
}) {
  return (
    <div
      className={
        align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"
      }
    >
      <h2 className="text-2xl font-semibold tracking-normal sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  )
}

function FeatureCard({
  title,
  detail,
  icon: Icon,
}: {
  title: string
  detail: string
  icon: LucideIcon
}) {
  return (
    <article className="rounded-md border bg-card p-6 text-card-foreground shadow-sm">
      <div className="grid size-10 place-items-center rounded-md border bg-muted">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-5 font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  )
}

function ModuleCard({
  name,
  detail,
  icon: Icon,
}: {
  name: string
  detail: string
  icon: LucideIcon
}) {
  return (
    <article className="rounded-md border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4" />
        <div>
          <h3 className="font-medium">{name}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {detail}
          </p>
        </div>
      </div>
    </article>
  )
}
