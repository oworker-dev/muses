import { NextResponse } from "next/server"

import { getAuth } from "@/lib/auth"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { newPassword?: unknown } | null
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : ""

  if (!newPassword) {
    return NextResponse.json({ message: "New password is required." }, { status: 400 })
  }

  try {
    const result = await getAuth().api.setPassword({
      headers: request.headers,
      body: { newPassword },
    })

    return NextResponse.json(result)
  } catch (error) {
    return toAuthErrorResponse(error)
  }
}

function toAuthErrorResponse(error: unknown) {
  const payload = error as {
    status?: number | string
    statusCode?: number
    body?: { message?: string }
    message?: string
  }
  const status =
    payload.statusCode ||
    (typeof payload.status === "number" ? payload.status : mapStatus(payload.status)) ||
    400
  const message = payload.body?.message || payload.message || "Could not set this password."

  return NextResponse.json({ message }, { status })
}

function mapStatus(status?: string) {
  switch (status) {
    case "UNAUTHORIZED":
      return 401
    case "FORBIDDEN":
      return 403
    case "NOT_FOUND":
      return 404
    case "TOO_MANY_REQUESTS":
      return 429
    case "BAD_REQUEST":
      return 400
    default:
      return 0
  }
}
