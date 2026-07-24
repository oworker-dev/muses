import { randomUUID } from "node:crypto"

import { cookies, headers } from "next/headers"
import { NextResponse } from "next/server"

import { recordAnalyticsEvent } from "@/lib/analytics"
import { getServerSession } from "@/lib/auth"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    eventName?: string
    path?: string
    feature?: string | null
    referrer?: string | null
    device?: string | null
  }
  const cookieStore = await cookies()
  const headerStore = await headers()
  const existingSessionId = cookieStore.get("saas_anon_id")?.value
  const sessionId = existingSessionId || randomUUID()
  const session = hasLikelyAuthCookie(cookieStore)
    ? await getServerSession().catch(() => null)
    : null

  const recorded = await recordAnalyticsEvent({
    eventName: body.eventName || "page_view",
    path: body.path || "/",
    feature: body.feature,
    referrer: body.referrer,
    device: body.device,
    country: getCountry(headerStore),
    userId: session?.user.id || null,
    sessionId,
  })
    .then(() => true)
    .catch((error) => {
      console.error("Analytics event could not be recorded.", error)
      return false
    })

  const response = NextResponse.json({ ok: true, recorded })
  if (!existingSessionId) {
    response.cookies.set("saas_anon_id", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  return response
}

function getCountry(headerStore: Headers) {
  return (
    headerStore.get("x-vercel-ip-country") ||
    headerStore.get("cf-ipcountry") ||
    headerStore.get("x-country-code") ||
    null
  )
}

function hasLikelyAuthCookie(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore
    .getAll()
    .some((cookie) => cookie.name.includes("better-auth") || cookie.name.includes("session"))
}
