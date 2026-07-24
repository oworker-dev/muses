"use client"

import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"

import type { AppLocale } from "@/i18n/config"
import { getMessages } from "@/i18n/messages"

export function I18nProvider({
  children,
  locale,
}: {
  children: ReactNode
  locale: AppLocale
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={getMessages(locale)}
    >
      {children}
    </NextIntlClientProvider>
  )
}
