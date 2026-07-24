"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { FormEvent, useMemo, useState, useTransition } from "react"
import { ArrowLeftIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react"

import { SuccessAlert } from "@/components/status-alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert } from "@/components/ui/alert"

export function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") || ""
  const tokenError = searchParams.get("error") || ""
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()
  const initialError = useMemo(() => getTokenErrorMessage(tokenError, token), [tokenError, token])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")

    const formData = new FormData(event.currentTarget)
    const newPassword = String(formData.get("newPassword") || "")
    const confirmPassword = String(formData.get("confirmPassword") || "")

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    startTransition(async () => {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token,
          newPassword,
        }),
      })

      if (!response.ok) {
        setError(await readError(response, "Could not reset this password."))
        return
      }

      setMessage("Password reset. Sign in with your new password.")
    })
  }

  if (initialError) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          {initialError}
        </Alert>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new reset link</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="newPassword" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      {message ? (
        <SuccessAlert>
          {message}
        </SuccessAlert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          {error}
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" size="lg" disabled={isPending || Boolean(message)}>
        {isPending ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />}
        Reset password
      </Button>

      <Button asChild variant="outline" className="w-full">
        <Link href="/login">
          <ArrowLeftIcon />
          Back to sign in
        </Link>
      </Button>
    </form>
  )
}

function getTokenErrorMessage(error: string, token: string) {
  if (error) {
    return "This password reset link is invalid or expired."
  }

  if (!token) {
    return "Open the password reset link from your email to continue."
  }

  return ""
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return payload?.message || payload?.error?.message || fallback
}
