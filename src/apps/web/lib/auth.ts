import { headers } from "next/headers"
import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { PostgresDialect } from "kysely"

import { getPgPool } from "@/lib/database"
import {
  sendEmailChangeConfirmationMessage,
  sendPasswordResetEmailMessage,
  sendVerificationEmailMessage,
} from "@/lib/email"

export function getAuthSecret() {
  return (
    process.env.BETTER_AUTH_SECRET ||
    "oworker-saas-starter-dev-secret-change-before-production"
  )
}

export function getAuthBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  )
}

function getTrustedOrigins() {
  const origins = new Set(
    (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  const baseUrl = getAuthBaseUrl()
  origins.add(baseUrl)

  try {
    const url = new URL(baseUrl)
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1"
      origins.add(url.origin)
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost"
      origins.add(url.origin)
    }
  } catch {
    // Keep Better Auth's own validation as the source of truth for malformed URLs.
  }

  return Array.from(origins)
}

const authRateLimit = {
  enabled: true,
  storage: "database" as const,
  window: 60,
  max: 120,
  customRules: {
    "/sign-in/email": { window: 60, max: 10 },
    "/sign-up/email": { window: 60, max: 5 },
    "/send-verification-email": { window: 60, max: 3 },
    "/request-password-reset": { window: 60, max: 3 },
    "/reset-password": { window: 60, max: 5 },
    "/change-password": { window: 60, max: 5 },
    "/change-email": { window: 60, max: 5 },
  },
}

function createAuthInstance() {
  const database = new PostgresDialect({ pool: getPgPool() })
  const socialProviders = {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  }

  return betterAuth({
    database,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await sendPasswordResetEmailMessage({
          to: user.email,
          userName: user.name,
          url,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      async sendVerificationEmail({ user, url }) {
        await sendVerificationEmailMessage({
          to: user.email,
          userName: user.name,
          url,
        })
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        async sendChangeEmailConfirmation({ user, newEmail, url }) {
          await sendEmailChangeConfirmationMessage({
            to: user.email,
            userName: user.name,
            newEmail,
            url,
          })
        },
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        requireLocalEmailVerified: true,
        updateUserInfoOnLink: true,
      },
    },
    socialProviders,
    secret: getAuthSecret(),
    baseURL: getAuthBaseUrl(),
    trustedOrigins: getTrustedOrigins(),
    rateLimit: authRateLimit,
    plugins: [nextCookies()],
  })
}

let authInstance: ReturnType<typeof createAuthInstance> | null = null

export function getAuth() {
  if (authInstance) {
    return authInstance
  }

  authInstance = createAuthInstance()
  return authInstance
}

export async function getServerSession() {
  return getAuth().api.getSession({
    headers: await headers(),
  })
}
