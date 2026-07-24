import { NextResponse } from "next/server"

import { sendAccountVerificationEmail } from "@/lib/email-verification"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string
      callbackURL?: string
    }

    const result = await sendAccountVerificationEmail({
      email: body.email || "",
      callbackURL: body.callbackURL,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not send verification email."

    return NextResponse.json({ status: false, message }, { status: 400 })
  }
}
