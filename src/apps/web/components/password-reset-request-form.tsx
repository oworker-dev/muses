"use client"

import Link from "next/link"
import { FormEvent, useState, useTransition } from "react"
import { ArrowLeftIcon, Loader2Icon, MailIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert } from "@/components/ui/alert"

export function PasswordResetRequestForm() {
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get("email") || "").trim()

    startTransition(async () => {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          redirectTo: "/reset-password",
        }),
      })

      if (!response.ok) {
        setError(await readError(response, "Could not send the password reset email."))
        return
      }

      setMessage("If this email exists, a password reset link has been sent.")
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </div>

      {message ? (
        <Alert>
          {message}
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          {error}
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
        Send reset link
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

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return payload?.message || payload?.error?.message || fallback
}
