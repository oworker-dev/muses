"use client"

import Link from "next/link"
import { FormEvent, useState, useTransition } from "react"
import { ArrowLeftIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert } from "@/components/ui/alert"

export function VerifyEmailPanel({
  initialEmail,
  resent,
  callbackURL = "/",
}: {
  initialEmail: string
  resent: boolean
  callbackURL?: string
}) {
  const [email, setEmail] = useState(initialEmail)
  const [message, setMessage] = useState(
    resent
      ? "A new verification email was sent. Check your inbox before signing in again."
      : "Check your inbox for the verification link sent during registration."
  )
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setMessage("")

    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setError("Enter the email address you used to register.")
      return
    }

    startTransition(async () => {
      const response = await fetch("/api/email-verification/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          callbackURL,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        setError(payload?.message || "Could not send verification email.")
        return
      }

      setMessage("Verification email sent. Open the link in your inbox to continue.")
    })
  }

  return (
    <div className="grid gap-5">
      {message ? (
        <Alert>
          {message}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            {error}
          </Alert>
        ) : null}

        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          Resend verification email
        </Button>
      </form>

      <Button asChild variant="outline" className="w-full">
        <Link href={`/login?callbackURL=${encodeURIComponent(callbackURL)}`}>
          <ArrowLeftIcon />
          Back to sign in
        </Link>
      </Button>
    </div>
  )
}
