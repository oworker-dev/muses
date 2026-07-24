import { cookies, headers } from "next/headers"

import {
  defaultLocale,
  isAppLocale,
  localeCookieName,
  type AppLocale,
} from "@/i18n/config"

export async function getRequestLocale(): Promise<AppLocale> {
  const locale = (await cookies()).get(localeCookieName)?.value || ""
  if (isAppLocale(locale)) {
    return locale
  }

  return getPreferredLocale((await headers()).get("accept-language"))
}

function getPreferredLocale(acceptLanguage: string | null): AppLocale {
  if (!acceptLanguage) {
    return defaultLocale
  }

  const requestedLocales = acceptLanguage
    .split(",")
    .map((entry) => entry.trim().split(";")[0]?.toLowerCase())
    .filter(Boolean)

  if (
    requestedLocales.some(
      (locale) =>
        locale === "zh-cn" || locale === "zh" || locale.startsWith("zh-")
    )
  ) {
    return "zh-CN"
  }

  if (
    requestedLocales.some(
      (locale) => locale === "en" || locale.startsWith("en-")
    )
  ) {
    return "en"
  }

  return defaultLocale
}
