import { NextResponse } from "next/server"

import { isAppLocale, localeCookieName } from "@/i18n/config"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    locale?: string | null
  } | null
  const locale = body?.locale

  if (!locale || locale === "auto") {
    const response = NextResponse.json({ locale: null })
    response.cookies.set(localeCookieName, "", {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })

    return response
  }

  if (!isAppLocale(locale)) {
    return NextResponse.json({ error: "Unsupported locale." }, { status: 400 })
  }

  const response = NextResponse.json({ locale })
  response.cookies.set(localeCookieName, locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  return response
}
