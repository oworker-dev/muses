import { render } from "@react-email/render"
import { createElement } from "react"

import {
  EmailChangeConfirmationEmail,
  getEmailChangeConfirmationText,
} from "@/emails/email-change-confirmation-email"
import {
  getPasswordResetEmailText,
  PasswordResetEmail,
} from "@/emails/password-reset-email"
import {
  getVerificationEmailText,
  VerificationEmail,
} from "@/emails/verification-email"

export type EmailResult = {
  provider: "local-test" | "resend"
  status: "sent" | "skipped"
  id: string
  detail: string
}

export type EmailMessage = {
  to?: string | null
  subject: string
  text: string
  html?: string
}

export function getEmailRuntime() {
  const hasResendCredentials = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM)

  return {
    provider: hasResendCredentials ? "resend" : "local-test",
    status: "ok",
    detail: hasResendCredentials
      ? "Resend email delivery is configured."
      : "Email delivery is running in local-test mode.",
  }
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const recipient = message.to?.trim()
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM

  if (!recipient) {
    return {
      provider: "local-test",
      status: "skipped",
      id: "local-email-no-recipient",
      detail: "No recipient email was available.",
    }
  }

  if (!apiKey || !from) {
    console.info("[email:local-test]", {
      to: recipient,
      subject: message.subject,
      text: message.text,
    })

    return {
      provider: "local-test",
      status: "sent",
      id: `local-email-${Date.now()}`,
      detail: `Local-test email accepted for ${recipient}.`,
    }
  }

  const response = await sendResendRequest(apiKey, {
    from,
    to: [recipient],
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  })

  if (!response.ok) {
    console.error("[email:resend-error]", {
      status: response.status,
      detail: getSafeResendErrorMessage(response.status),
    })
    throw new Error(getSafeResendErrorMessage(response.status))
  }

  const payload = (await response.json()) as { id?: string }
  return {
    provider: "resend",
    status: "sent",
    id: payload.id || "resend-email",
    detail: `Resend accepted email for ${recipient}.`,
  }
}

async function sendResendRequest(
  apiKey: string,
  payload: {
    from: string
    to: string[]
    subject: string
    text: string
    html?: string
  }
) {
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (response.ok || !isRetryableEmailStatus(response.status) || attempt === 3) {
        return response
      }

      lastError = new Error(getSafeResendErrorMessage(response.status))
    } catch (error) {
      lastError = error
      if (attempt === 3) {
        console.error("[email:resend-network-error]", {
          detail: error instanceof Error ? error.message : String(error),
        })
        throw new Error(
          "Email provider network request failed. Check outbound network access and try again."
        )
      }
    }

    await wait(attempt * 500)
  }

  throw lastError instanceof Error ? lastError : new Error("Resend email failed.")
}

function isRetryableEmailStatus(status: number) {
  return status === 429 || status >= 500
}

function getSafeResendErrorMessage(status: number) {
  if (status === 401) {
    return "Email provider authentication failed. Check RESEND_API_KEY."
  }

  if (status === 403) {
    return "Email provider rejected this sender or recipient. Verify the Resend sender domain or use an allowed test recipient."
  }

  if (status === 429) {
    return "Email provider rate limit exceeded. Try again later."
  }

  if (status >= 500) {
    return "Email provider is temporarily unavailable. Try again later."
  }

  return "Email provider rejected the request. Check email provider configuration."
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendVerificationEmailMessage(input: {
  to: string
  userName?: string | null
  url: string
}) {
  const subject = "Verify your account"
  const template = createElement(VerificationEmail, {
    userName: input.userName,
    url: input.url,
  })
  const html = await render(template)
  const text = getVerificationEmailText({
    userName: input.userName,
    url: input.url,
  })

  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
  })
}

export async function sendPasswordResetEmailMessage(input: {
  to: string
  userName?: string | null
  url: string
}) {
  const subject = "Reset your password"
  const template = createElement(PasswordResetEmail, {
    userName: input.userName,
    url: input.url,
  })
  const html = await render(template)
  const text = getPasswordResetEmailText({
    userName: input.userName,
    url: input.url,
  })

  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
  })
}

export async function sendEmailChangeConfirmationMessage(input: {
  to: string
  userName?: string | null
  newEmail: string
  url: string
}) {
  const subject = "Confirm your email change"
  const template = createElement(EmailChangeConfirmationEmail, {
    userName: input.userName,
    newEmail: input.newEmail,
    url: input.url,
  })
  const html = await render(template)
  const text = getEmailChangeConfirmationText({
    userName: input.userName,
    newEmail: input.newEmail,
    url: input.url,
  })

  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
  })
}
