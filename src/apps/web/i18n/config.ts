export const locales = ["en", "zh-CN"] as const

export type AppLocale = (typeof locales)[number]

export function isAppLocale(value: string): value is AppLocale {
  return locales.includes(value as AppLocale)
}

const configuredDefaultLocale = process.env.DEFAULT_LOCALE || ""

export const defaultLocale: AppLocale = isAppLocale(configuredDefaultLocale)
  ? configuredDefaultLocale
  : "en"

export const localeCookieName = "oworker-locale"
