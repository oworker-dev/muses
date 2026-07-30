"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FormEvent, useState, useTransition } from "react"
import { ArrowRightIcon, Loader2Icon } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import type { OAuthProvider } from "@/lib/oauth"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OAuthButtons } from "@/components/oauth-buttons"
import { isEmailVerificationRequiredError } from "@/lib/auth-error-classification"

type AuthMode = "login" | "register"

export type AuthFormCopy = {
  nameLabel: string
  emailLabel: string
  passwordLabel: string
  forgotPassword: string
  createAccount: string
  signIn: string
  alreadyHaveAccount: string
  needAccount: string
  register: string
  authFailed: string
  couldNotSendVerification: string
  verificationNotSent: string
  accountCreatedBut: string
  oauthGithub: string
  oauthGoogle: string
  oauthDivider: string
}

const defaultCopy: AuthFormCopy = {
  nameLabel: "Name",
  emailLabel: "Email",
  passwordLabel: "Password",
  forgotPassword: "Forgot password?",
  createAccount: "Create account",
  signIn: "Sign in",
  alreadyHaveAccount: "Already have an account?",
  needAccount: "Need an account?",
  register: "Register",
  authFailed: "Authentication failed",
  couldNotSendVerification: "could not send the verification email.",
  verificationNotSent: "No verification email was sent. Try signing in again.",
  accountCreatedBut: "Account created, but",
  oauthGithub: "Continue with GitHub",
  oauthGoogle: "Continue with Google",
  oauthDivider: "Email",
}

export function AuthForm({
  mode,
  oauthProviders,
  callbackURL = "/",
  copy = defaultCopy,
  initialError = "",
}: {
  mode: AuthMode
  oauthProviders: OAuthProvider[]
  callbackURL?: string
  copy?: AuthFormCopy
  initialError?: string
}) {
  const router = useRouter()
  const [error, setError] = useState(initialError)
  const [isPending, startTransition] = useTransition()
  const isRegister = mode === "register"

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get("email") || "").trim()
    const password = String(formData.get("password") || "")
    const name = String(formData.get("name") || "")

    startTransition(async () => {
      const result = isRegister
        ? await authClient.signUp.email({
            email,
            password,
            name,
            callbackURL,
          })
        : await authClient.signIn.email({
            email,
            password,
            callbackURL,
          })

      if (result.error) {
        if (!isRegister && isEmailVerificationRequiredError(result.error)) {
          const verification = await requestVerificationEmail(
            email,
            callbackURL,
            copy.couldNotSendVerification
          )
          if (verification.error) {
            setError(verification.error)
            return
          }
          if (!verification.sent) {
            setError(copy.verificationNotSent)
            return
          }

          router.push(
            `/verify-email?email=${encodeURIComponent(email)}&resent=true&callbackURL=${encodeURIComponent(callbackURL)}`
          )
          router.refresh()
          return
        }

        setError(result.error.message || copy.authFailed)
        return
      }

      if (isRegister) {
        const verification = await requestVerificationEmail(
          email,
          callbackURL,
          copy.couldNotSendVerification
        )
        if (verification.error) {
          setError(`${copy.accountCreatedBut} ${verification.error}`)
          return
        }
        if (!verification.sent) {
          setError(`${copy.accountCreatedBut} ${copy.verificationNotSent}`)
          return
        }

        router.push(
          `/verify-email?email=${encodeURIComponent(email)}&callbackURL=${encodeURIComponent(callbackURL)}`
        )
        router.refresh()
        return
      }

      router.push(callbackURL)
      router.refresh()
    })
  }

  return (
    <form
      action={isRegister ? "/api/auth/sign-up/email" : "/api/auth/form-sign-in"}
      method="post"
      onSubmit={onSubmit}
      className="space-y-4"
    >
      <input type="hidden" name="callbackURL" value={callbackURL} />
      <OAuthButtons
        enabledProviders={oauthProviders}
        callbackURL={callbackURL}
        dividerLabel={copy.oauthDivider}
        labels={{
          github: copy.oauthGithub,
          google: copy.oauthGoogle,
        }}
      />
      {isRegister ? (
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {copy.nameLabel}
          </label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            required
          />
        </div>
      ) : null}
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          {copy.emailLabel}
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
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="password" className="text-sm font-medium">
            {copy.passwordLabel}
          </label>
          {!isRegister ? (
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {copy.forgotPassword}
            </Link>
          ) : null}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          minLength={8}
          required
        />
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? <Loader2Icon className="animate-spin" /> : null}
        {isRegister ? copy.createAccount : copy.signIn}
        {!isPending ? <ArrowRightIcon /> : null}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {isRegister ? copy.alreadyHaveAccount : copy.needAccount}{" "}
        <Link
          href={
            isRegister
              ? `/login?callbackURL=${encodeURIComponent(callbackURL)}`
              : `/register?callbackURL=${encodeURIComponent(callbackURL)}`
          }
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {isRegister ? copy.signIn : copy.register}
        </Link>
      </p>
    </form>
  )
}

async function requestVerificationEmail(
  email: string,
  callbackURL = "/",
  fallback = "could not send the verification email."
) {
  const response = await fetch("/api/email-verification/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      callbackURL,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    return { sent: false, error: payload?.message || fallback }
  }
  return { sent: payload?.sent === true, error: "" }
}
