import en from "../messages/en.json"
import zhCN from "../messages/zh-CN.json"

import type { AppLocale } from "./config"

const messagesByLocale = {
  en,
  "zh-CN": zhCN,
} as const

export function getMessages(locale: AppLocale) {
  return messagesByLocale[locale]
}
