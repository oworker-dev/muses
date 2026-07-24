"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { LanguagesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { isAppLocale, localeCookieName, type AppLocale } from "@/i18n/config"

type LanguagePreference = AppLocale | "auto"

export function LanguageSwitcher({ locale }: { locale: AppLocale }) {
  const router = useRouter()
  const [selectedLanguage, setSelectedLanguage] = useState<LanguagePreference>(
    () => readLocalePreference()
  )
  const [isPending, startTransition] = useTransition()

  function changeLocale(nextLocale: string) {
    const normalizedLocale = isLanguagePreference(nextLocale)
      ? nextLocale
      : "auto"

    if (normalizedLocale === selectedLanguage) {
      return
    }

    setSelectedLanguage(normalizedLocale)
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: normalizedLocale === "auto" ? null : normalizedLocale,
        }),
      })
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="rounded-full"
          aria-label={`Change language, current locale ${locale}`}
          disabled={isPending}
        >
          <LanguagesIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={selectedLanguage}
          onValueChange={changeLocale}
        >
          <DropdownMenuRadioItem value="auto">Auto</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh-CN">中文</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function isLanguagePreference(value: string): value is LanguagePreference {
  return value === "auto" || isAppLocale(value)
}

function readLocalePreference(): LanguagePreference {
  if (typeof document === "undefined") {
    return "auto"
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${localeCookieName}=`))
  const value = cookie ? decodeURIComponent(cookie.split("=")[1] || "") : ""

  return isAppLocale(value) ? value : "auto"
}
