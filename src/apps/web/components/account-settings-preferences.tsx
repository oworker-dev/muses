"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  ChevronDownIcon,
  LanguagesIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import type { AppLocale } from "@/i18n/config"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type LanguagePreference = AppLocale | "auto"

export type AccountSettingsPreferencesCopy = {
  appearanceTitle: string
  appearanceDetail: string
  themeLabel: string
  themeSystem: string
  themeLight: string
  themeDark: string
  languageTitle: string
  languageDetail: string
  languageLabel: string
  languageAuto: string
  languageEnglish: string
  languageChinese: string
}

export function AccountSettingsPreferences({
  currentLocale,
  languagePreference,
  copy,
}: {
  currentLocale: AppLocale
  languagePreference: LanguagePreference
  copy: AccountSettingsPreferencesCopy
}) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [selectedLanguage, setSelectedLanguage] =
    useState<LanguagePreference>(languagePreference)
  const [isChangingLanguage, startChangingLanguage] = useTransition()
  const selectedTheme = theme || "system"
  const languageLabels: Record<LanguagePreference, string> = {
    auto: copy.languageAuto,
    en: copy.languageEnglish,
    "zh-CN": copy.languageChinese,
  }

  function changeLanguage(nextLanguage: string) {
    const normalizedLanguage = isLanguagePreference(nextLanguage)
      ? nextLanguage
      : "auto"

    setSelectedLanguage(normalizedLanguage)
    startChangingLanguage(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: normalizedLanguage === "auto" ? null : normalizedLanguage,
        }),
      })
      router.refresh()
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-muted p-2">
              <MonitorIcon className="size-4" />
            </div>
            <div>
              <CardTitle>{copy.appearanceTitle}</CardTitle>
              <CardDescription>{copy.appearanceDetail}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <p className="text-sm font-medium">{copy.themeLabel}</p>
            <Tabs
              value={selectedTheme}
              onValueChange={(value) => setTheme(value)}
            >
              <TabsList className="w-full sm:w-fit">
                <TabsTrigger value="system" className="min-w-24">
                  <MonitorIcon />
                  {copy.themeSystem}
                </TabsTrigger>
                <TabsTrigger value="light" className="min-w-24">
                  <SunIcon />
                  {copy.themeLight}
                </TabsTrigger>
                <TabsTrigger value="dark" className="min-w-24">
                  <MoonIcon />
                  {copy.themeDark}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-muted p-2">
              <LanguagesIcon className="size-4" />
            </div>
            <div>
              <CardTitle>{copy.languageTitle}</CardTitle>
              <CardDescription>{copy.languageDetail}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <p className="text-sm font-medium">{copy.languageLabel}</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between sm:w-64"
                  disabled={isChangingLanguage}
                >
                  <span className="inline-flex items-center gap-2">
                    <LanguagesIcon />
                    {languageLabels[selectedLanguage] ||
                      languageLabels[currentLocale]}
                  </span>
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                <DropdownMenuRadioGroup
                  value={selectedLanguage}
                  onValueChange={changeLanguage}
                >
                  <DropdownMenuRadioItem value="auto">
                    {copy.languageAuto}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="en">
                    {copy.languageEnglish}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zh-CN">
                    {copy.languageChinese}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function isLanguagePreference(value: string): value is LanguagePreference {
  return value === "auto" || value === "en" || value === "zh-CN"
}
