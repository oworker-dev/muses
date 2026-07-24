import { createEmailVerificationToken } from "better-auth/api"

import { getAuthBaseUrl, getAuthSecret } from "@/lib/auth"
import { getPgPool } from "@/lib/database"
import { sendVerificationEmailMessage } from "@/lib/email"

type VerificationUser = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
}

export async function sendAccountVerificationEmail(input: {
  email: string
  callbackURL?: string
}) {
  const email = input.email.trim().toLowerCase()

  if (!email) {
    throw new Error("Email is required.")
  }

  const user = await findVerificationUser(email)

  if (!user || user.emailVerified) {
    return {
      status: true,
      sent: false,
    }
  }

  const callbackURL = normalizeCallbackURL(input.callbackURL)
  const token = await createEmailVerificationToken(
    getAuthSecret(),
    user.email,
    undefined,
    60 * 60
  )
  const url = `${getAuthEndpointBaseUrl()}/verify-email?token=${encodeURIComponent(
    token
  )}&callbackURL=${encodeURIComponent(callbackURL)}`

  await sendVerificationEmailMessage({
    to: user.email,
    userName: user.name,
    url,
  })

  return {
    status: true,
    sent: true,
  }
}

async function findVerificationUser(email: string) {
  const result = await getPgPool().query<VerificationUser>(
    `
      select id, email, name, "emailVerified"
      from "user"
      where lower(email) = lower($1)
      limit 1
    `,
    [email]
  )

  return result.rows[0] || null
}

function getAuthEndpointBaseUrl() {
  const baseUrl = getAuthBaseUrl().replace(/\/$/, "")

  if (baseUrl.endsWith("/api/auth")) {
    return baseUrl
  }

  return `${baseUrl}/api/auth`
}

function normalizeCallbackURL(callbackURL?: string) {
  if (!callbackURL || !callbackURL.startsWith("/") || callbackURL.startsWith("//")) {
    return "/"
  }

  return callbackURL
}
