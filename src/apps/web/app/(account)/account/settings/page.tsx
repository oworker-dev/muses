import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createTranslator } from "next-intl"

import { AccountDashboardShell } from "@/components/account-dashboard-shell"
import { AccountSettingsPreferences } from "@/components/account-settings-preferences"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { isSiteAdmin } from "@/lib/admin"
import { getServerSession } from "@/lib/auth"
import { isAppLocale, localeCookieName } from "@/i18n/config"

export const dynamic = "force-dynamic"

export default async function AccountSettingsPage() {
  const [session, locale] = await Promise.all([
    getServerSession(),
    getRequestLocale(),
  ])

  if (!session) {
    redirect("/login?callbackURL=/account/settings")
  }

  const [siteAdmin, cookieStore] = await Promise.all([
    isSiteAdmin(session.user.id, session.user.email),
    cookies(),
  ])
  const t = createTranslator({
    locale,
    messages: getMessages(locale),
    namespace: "Account",
  })
  const localePreference = cookieStore.get(localeCookieName)?.value || ""

  return (
    <AccountDashboardShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      siteAdmin={siteAdmin}
      breadcrumbPage={t("settings.title")}
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
            {t("settings.title")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>
        </div>

        <AccountSettingsPreferences
          currentLocale={locale}
          languagePreference={
            isAppLocale(localePreference) ? localePreference : "auto"
          }
          copy={{
            appearanceTitle: t("settings.appearanceTitle"),
            appearanceDetail: t("settings.appearanceDetail"),
            themeLabel: t("settings.themeLabel"),
            themeSystem: t("settings.themeSystem"),
            themeLight: t("settings.themeLight"),
            themeDark: t("settings.themeDark"),
            languageTitle: t("settings.languageTitle"),
            languageDetail: t("settings.languageDetail"),
            languageLabel: t("settings.languageLabel"),
            languageAuto: t("settings.languageAuto"),
            languageEnglish: t("settings.languageEnglish"),
            languageChinese: t("settings.languageChinese"),
          }}
        />
      </div>
    </AccountDashboardShell>
  )
}
