import { NextResponse } from "next/server"

import { getAuth } from "@/lib/auth"
import { normalizeInternalPath } from "@/lib/urls"

type AuthErrorCode =
  | "invalid-credentials"
  | "email-not-verified"
  | "too-many-attempts"
  | "auth-unavailable"

export async function POST(request: Request) {
  let formData: FormData

  try {
    formData = await request.formData()
  } catch {
    return redirectToLogin(request, "/", "invalid-credentials")
  }

  const email = String(formData.get("email") || "").trim()
  const password = String(formData.get("password") || "")
  const callbackURL = normalizeInternalPath(
    String(formData.get("callbackURL") || ""),
    "/"
  )

  if (!email || !password) {
    return redirectToLogin(request, callbackURL, "invalid-credentials")
  }

  try {
    const headers = new Headers(request.headers)
    headers.set("content-type", "application/json")
    headers.delete("content-length")

    const authResponse = await getAuth().handler(
      new Request(new URL("/api/auth/sign-in/email", request.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ email, password, callbackURL }),
      })
    )

    if (!authResponse.ok) {
      return redirectToLogin(
        request,
        callbackURL,
        mapAuthError(authResponse.status)
      )
    }

    const responseHeaders = new Headers(authResponse.headers)
    responseHeaders.set("location", new URL(callbackURL, request.url).toString())
    responseHeaders.set("cache-control", "no-store")
    responseHeaders.set("referrer-policy", "no-referrer")
    responseHeaders.delete("content-length")
    responseHeaders.delete("content-type")

    return new Response(null, {
      status: 303,
      headers: responseHeaders,
    })
  } catch {
    return redirectToLogin(request, callbackURL, "auth-unavailable")
  }
}

function mapAuthError(status: number): AuthErrorCode {
  switch (status) {
    case 401:
      return "invalid-credentials"
    case 403:
      return "email-not-verified"
    case 429:
      return "too-many-attempts"
    default:
      return "auth-unavailable"
  }
}

function redirectToLogin(
  request: Request,
  callbackURL: string,
  authError: AuthErrorCode
) {
  const loginURL = new URL("/login", request.url)
  loginURL.searchParams.set("callbackURL", callbackURL)
  loginURL.searchParams.set("authError", authError)

  const response = NextResponse.redirect(loginURL, { status: 303 })
  response.headers.set("cache-control", "no-store")
  response.headers.set("referrer-policy", "no-referrer")
  return response
}
