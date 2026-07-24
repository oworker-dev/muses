"use client"

import { Loader2Icon, MailCheckIcon, RefreshCwIcon } from "lucide-react"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"

export type AccountVerificationFormCopy = {
  title: string
  detail: string
  success: string
  error: string
  button: string
}

const defaultCopy: AccountVerificationFormCopy = {
  title: "Verify this email address",
  detail: "Protected SaaS routes stay locked until this account is verified.",
  success: "Verification email sent. Open the link in your inbox to continue.",
  error: "Could not send verification email.",
  button: "Resend verification email",
}

export function AccountVerificationForm({
  email,
  copy = defaultCopy,
}: {
  email: string
  copy?: AccountVerificationFormCopy
}) {
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  function resendVerificationEmail() {
    setMessage("")
    setError("")

    startTransition(async () => {
      const response = await fetch("/api/email-verification/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          callbackURL: "/account",
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        setError(payload?.message || copy.error)
        return
      }

      setMessage(copy.success)
    })
  }

  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md border bg-background p-2">
          <MailCheckIcon className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="font-medium">{copy.title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.detail}
          </p>
        </div>
      </div>

      {message ? (
        <Alert variant="default" className="bg-background">
          {message}
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          {error}
        </Alert>
      ) : null}

      <Button type="button" onClick={resendVerificationEmail} disabled={isPending}>
        {isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
        {copy.button}
      </Button>
    </div>
  )
}
