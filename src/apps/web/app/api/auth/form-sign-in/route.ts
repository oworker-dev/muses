import { NextResponse } from "next/server"

import { getAuth } from "@/lib/auth"
import {
  classifyFormSignInFailure,
  type FormSignInErrorCode,
} from "@/lib/auth-error-classification"
import { normalizeInternalPath } from "@/lib/urls"

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
      const payload = await authResponse
        .clone()
        .json()
        .catch(() => null)
      return redirectToLogin(
        request,
        callbackURL,
        classifyFormSignInFailure(authResponse.status, payload)
      )
    }

    const responseHeaders = new Headers(authResponse.headers)
    responseHeaders.set(
      "location",
      new URL(callbackURL, request.url).toString()
    )
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

function redirectToLogin(
  request: Request,
  callbackURL: string,
  authError: FormSignInErrorCode
) {
  const loginURL = new URL("/login", request.url)
  loginURL.searchParams.set("callbackURL", callbackURL)
  loginURL.searchParams.set("authError", authError)

  const response = NextResponse.redirect(loginURL, { status: 303 })
  response.headers.set("cache-control", "no-store")
  response.headers.set("referrer-policy", "no-referrer")
  return response
}
