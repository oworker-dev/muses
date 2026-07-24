import type { LucideIcon } from "lucide-react"
import { CreditCardIcon, LinkIcon, ShieldCheckIcon } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { createTranslator } from "next-intl"
import type { ReactNode } from "react"

import { AccountDashboardShell } from "@/components/account-dashboard-shell"
import { AccountProfileCard } from "@/components/account-profile-card"
import {
  AccountSecurityPanel,
  type AccountSecurityFormsCopy,
} from "@/components/account-security-forms"
import type { AccountVerificationFormCopy } from "@/components/account-verification-form"
import { ConnectedAccountsPanel } from "@/components/connected-accounts-panel"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { getAccountConsoleData } from "@/lib/account"
import { isSiteAdmin } from "@/lib/admin"
import { getServerSession } from "@/lib/auth"
import { getEnabledOAuthProviders } from "@/lib/oauth"

export const dynamic = "force-dynamic"

export default async function AccountPage() {
  const [session, locale] = await Promise.all([
    getServerSession(),
    getRequestLocale(),
  ])

  if (!session) {
    redirect("/login?callbackURL=/account")
  }

  const enabledOAuthProviders = getEnabledOAuthProviders()
  const [account, siteAdmin] = await Promise.all([
    getAccountConsoleData(session.user),
    isSiteAdmin(session.user.id, session.user.email),
  ])
  const messages = getMessages(locale)
  const t = createTranslator({
    locale,
    messages,
    namespace: "Account",
  })
  const hasPasswordCredential = account.authProviders.some(
    (provider) => provider.provider === "credential" && provider.hasPassword
  )
  const lifecycle = getLifecycleState({
    emailVerified: session.user.emailVerified,
    hasPasswordCredential,
    providers: account.authProviders.map((provider) => provider.provider),
    locale,
    copy: {
      active: t("active"),
      emailVerificationPending: t("emailVerificationPending"),
      verifiedByProviders: (providers) =>
        t("verifiedByProviders", { providers }),
      verifiedByEmailOrProvider: (providers) =>
        t("verifiedByEmailOrProvider", { providers }),
      verifiedByEmail: t("verifiedByEmail"),
      accessUnlocked: t("accessUnlocked"),
      pendingDetail: t("pendingDetail"),
      pendingVerificationDetail: t("pendingVerificationDetail"),
    },
  })
  const signInMethodCount =
    (hasPasswordCredential ? 1 : 0) +
    account.authProviders.filter(
      (provider) =>
        provider.provider === "github" || provider.provider === "google"
    ).length
  const memberSince = account.authProviders[0]?.connectedAt || null
  const accountType = siteAdmin ? t("accountTypeAdmin") : t("accountTypeUser")
  const displayName = session.user.name || session.user.email.split("@")[0]
  const verificationCopy = {
    title: t("verification.title"),
    detail: t("verification.detail"),
    success: t("verification.success"),
    error: t("verification.error"),
    button: t("verification.button"),
  }
  const securityFormsCopy = {
    passwordsDoNotMatch: t("forms.passwordsDoNotMatch"),
    currentPassword: t("forms.currentPassword"),
    newPassword: t("forms.newPassword"),
    confirmNewPassword: t("forms.confirmNewPassword"),
    changePasswordTitle: t("forms.changePasswordTitle"),
    changePasswordDetail: t("forms.changePasswordDetail"),
    changePasswordButton: t("forms.changePasswordButton"),
    changePasswordSuccess: t("forms.changePasswordSuccess"),
    changePasswordError: t("forms.changePasswordError"),
    setPasswordTitle: t("forms.setPasswordTitle"),
    setPasswordDetail: t("forms.setPasswordDetail"),
    setPasswordButton: t("forms.setPasswordButton"),
    setPasswordSuccess: t("forms.setPasswordSuccess"),
    setPasswordError: t("forms.setPasswordError"),
    changeEmailTitle: t("forms.changeEmailTitle"),
    newEmail: t("forms.newEmail"),
    newEmailPlaceholder: t("forms.newEmailPlaceholder"),
    sendConfirmation: t("forms.sendConfirmation"),
    changeEmailSuccessPrefix: t("forms.changeEmailSuccessPrefix"),
    changeEmailSuccessSuffix: t("forms.changeEmailSuccessSuffix"),
    pendingChange: t("forms.pendingChange"),
    changeEmailError: t("forms.changeEmailError"),
  }

  return (
    <AccountDashboardShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      siteAdmin={siteAdmin}
      breadcrumbPage={t("headerEyebrow")}
      copy={{
        brand: "OWorker SaaS",
        console: t("headerEyebrow"),
        account: t("title"),
        overview: t("navOverview"),
        billing: t("navBilling"),
        settings: t("navSettings"),
        admin: t("navSiteAdmin"),
        support: t("navSupport"),
        upgradePlan: t("upgradePlan"),
        signOut: t("signOut"),
        openUserMenu: t("openUserMenu"),
      }}
    >
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">
            {t("welcomeTitle", { name: displayName })}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("description")}
          </p>
        </div>

        <div id="overview" className="grid gap-4">
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
            <AccountProfileCard
              id="profile"
              name={session.user.name}
              fallbackName={t("notProvided")}
              email={session.user.email}
              image={session.user.image}
              status={lifecycle.label}
              statusTone={lifecycle.tone}
              verified={Boolean(session.user.emailVerified)}
              verifiedLabel={t("verifiedStatus")}
              memberSince={
                memberSince ? formatDate(memberSince, locale) : t("notProvided")
              }
              accountId={shortId(session.user.id)}
              accountType={accountType}
              signInMethods={String(signInMethodCount)}
              labels={{
                memberSince: t("memberSince"),
                accountId: t("accountId"),
                accountType: t("accountType"),
                signInMethods: t("signInMethods"),
              }}
              copy={{
                title: t("identityTitle"),
                detail: t("identityDetail"),
                edit: t("profile.edit"),
                cancel: t("profile.cancel"),
                save: t("profile.save"),
                nameLabel: t("profile.nameLabel"),
                imageLabel: t("avatarUpload.imageLabel"),
                uploadAvatar: t("profile.uploadAvatar"),
                uploadingAvatar: t("profile.uploadingAvatar"),
                profileUpdated: t("profile.profileUpdated"),
                avatarUpdated: t("avatarUpload.success"),
                unsupportedType: t("avatarUpload.unsupportedType"),
                tooLarge: t("avatarUpload.tooLarge"),
                error: t("profile.error"),
              }}
            />

            <SubscriptionSummary
              title={t("subscriptionTitle")}
              detail={t("subscriptionDetail")}
              planId={account.subscription.plan}
              plan={formatDisplayLabel(account.subscription.plan)}
              status={formatDisplayLabel(
                account.subscription.status.replace("_", " ")
              )}
              renewsOn={
                account.subscription.currentPeriodEnd
                  ? formatDate(account.subscription.currentPeriodEnd, locale)
                  : t("notProvided")
              }
              amount={formatMoney(
                account.subscription.monthlyAmountCents,
                locale
              )}
              copy={{
                plan: t("plan"),
                status: t("status"),
                renewsOn: t("renewsOn"),
                amount: t("amount"),
                openBilling: t("openBilling"),
                upgradePlan: t("upgradePlan"),
                currentPlan: t("billing.currentPlan"),
              }}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SecuritySummary
              id="security"
              title={t("securityTitle")}
              detail={t("securityDetail")}
              currentEmail={session.user.email}
              emailVerified={Boolean(session.user.emailVerified)}
              verificationDetail={lifecycle.verificationDetail}
              hasPasswordCredential={hasPasswordCredential}
              copy={{
                passwordTab: t("securityTabs.password"),
                emailTab: t("securityTabs.email"),
                password: t("emailPassword"),
                email: t("emailVerification"),
                connected: t("connected.statusConnected"),
                pending: t("emailVerificationPending"),
                passwordSet: t("passwordSet"),
                oauthOnly: t("oauthOnly"),
                currentEmail: t("emailAddress"),
              }}
              formsCopy={securityFormsCopy}
              verificationCopy={verificationCopy}
            />

            <Panel id="connections" title={t("navConnections")} icon={LinkIcon}>
              <ConnectedAccountsPanel
                authProviders={account.authProviders}
                enabledOAuthProviders={enabledOAuthProviders}
                hasPasswordCredential={hasPasswordCredential}
                locale={locale}
                copy={{
                  statusConnected: t("connected.statusConnected"),
                  statusNotConnected: t("connected.statusNotConnected"),
                  statusAvailable: t("connected.statusAvailable"),
                  statusNotConfigured: t("connected.statusNotConfigured"),
                  providerConnected: t.raw("connected.providerConnected"),
                  providerConnectDetail: t.raw(
                    "connected.providerConnectDetail"
                  ),
                  providerNotConfiguredDetail: t(
                    "connected.providerNotConfiguredDetail"
                  ),
                  connect: t("connected.connect"),
                  disconnect: t("connected.disconnect"),
                  lastMethodWarning: t("connected.lastMethodWarning"),
                  connectedSuccess: t.raw("connected.connectedSuccess"),
                  disconnectedSuccess: t.raw("connected.disconnectedSuccess"),
                  connectError: t.raw("connected.connectError"),
                  disconnectError: t.raw("connected.disconnectError"),
                  recently: t("connected.recently"),
                }}
              />
            </Panel>
          </section>
        </div>
      </div>
    </AccountDashboardShell>
  )
}

function SubscriptionSummary({
  title,
  detail,
  planId,
  plan,
  status,
  renewsOn,
  amount,
  copy,
}: {
  title: string
  detail: string
  planId: string
  plan: string
  status: string
  renewsOn: string
  amount: string
  copy: {
    plan: string
    status: string
    renewsOn: string
    amount: string
    openBilling: string
    upgradePlan: string
    currentPlan: string
  }
}) {
  const canUpgrade = planId !== "pro"

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="px-5 py-0">
        <div className="flex items-center gap-3">
          <CreditCardIcon className="size-5" />
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="sr-only">{detail}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 px-5 py-0">
        <div className="grid gap-3.5">
          <SummaryRow label={copy.plan} value={plan} />
          <SummaryRow
            label={copy.status}
            value={<StatusBadge tone="ok">{status}</StatusBadge>}
          />
          <SummaryRow label={copy.renewsOn} value={renewsOn} />
          <SummaryRow label={copy.amount} value={amount} />
        </div>
        <div className="grid gap-2">
          {canUpgrade ? (
            <Button asChild className="w-full">
              <Link href="/pricing">
                <CreditCardIcon />
                {copy.upgradePlan}
              </Link>
            </Button>
          ) : (
            <Button className="w-full" disabled variant="outline">
              <CreditCardIcon />
              {copy.currentPlan}
            </Button>
          )}
          <Button asChild className="w-full" variant="outline">
            <Link href="/account/billing">
              <CreditCardIcon />
              {copy.openBilling}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SecuritySummary({
  id,
  title,
  detail,
  currentEmail,
  emailVerified,
  verificationDetail,
  hasPasswordCredential,
  copy,
  formsCopy,
  verificationCopy,
}: {
  id: string
  title: string
  detail: string
  currentEmail: string
  emailVerified: boolean
  verificationDetail: string
  hasPasswordCredential: boolean
  copy: {
    passwordTab: string
    emailTab: string
    password: string
    email: string
    connected: string
    pending: string
    passwordSet: string
    oauthOnly: string
    currentEmail: string
  }
  formsCopy: AccountSecurityFormsCopy
  verificationCopy: AccountVerificationFormCopy
}) {
  return (
    <Panel id={id} title={title} detail={detail} icon={ShieldCheckIcon}>
      <AccountSecurityPanel
        currentEmail={currentEmail}
        emailVerified={emailVerified}
        verificationDetail={verificationDetail || currentEmail}
        hasPasswordCredential={hasPasswordCredential}
        copy={copy}
        formsCopy={formsCopy}
        verificationCopy={verificationCopy}
      />
    </Panel>
  )
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function getLifecycleState({
  emailVerified,
  hasPasswordCredential,
  providers,
  locale,
  copy,
}: {
  emailVerified?: boolean | null
  hasPasswordCredential: boolean
  providers: string[]
  locale: string
  copy: {
    active: string
    emailVerificationPending: string
    verifiedByProviders: (providers: string) => string
    verifiedByEmailOrProvider: (providers: string) => string
    verifiedByEmail: string
    accessUnlocked: string
    pendingDetail: string
    pendingVerificationDetail: string
  }
}) {
  if (emailVerified) {
    const socialProviders = providers
      .filter((provider) => provider === "github" || provider === "google")
      .map((provider) => (provider === "github" ? "GitHub" : "Google"))
    const socialProviderList = new Intl.ListFormat(locale, {
      type: "conjunction",
    }).format(socialProviders)
    const verificationDetail =
      socialProviders.length > 0 && !hasPasswordCredential
        ? copy.verifiedByProviders(socialProviderList)
        : socialProviders.length > 0
          ? copy.verifiedByEmailOrProvider(socialProviderList)
          : copy.verifiedByEmail

    return {
      label: copy.active,
      detail: `${verificationDetail} ${copy.accessUnlocked}`,
      verificationDetail,
      tone: "ok" as const,
    }
  }

  return {
    label: copy.emailVerificationPending,
    detail: copy.pendingDetail,
    verificationDetail: copy.pendingVerificationDetail,
    tone: "warning" as const,
  }
}

function Panel({
  id,
  title,
  detail,
  icon: Icon,
  children,
}: {
  id?: string
  title: string
  detail?: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <Card id={id} className="overflow-hidden">
      <CardHeader className="px-5 py-0">
        <div className="flex items-center gap-3">
          <Icon className="size-5" />
          <div>
            <CardTitle>{title}</CardTitle>
            {detail ? (
              <CardDescription className="sr-only">{detail}</CardDescription>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 py-0">{children}</CardContent>
    </Card>
  )
}

function shortId(value: string) {
  if (value.length <= 12) {
    return value
  }

  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(new Date(value))
}

function formatMoney(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDisplayLabel(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (part) =>
        `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
    )
    .join(" ")
}
