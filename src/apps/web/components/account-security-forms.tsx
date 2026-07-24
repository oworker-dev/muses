"use client"

import { FormEvent, useState, useTransition } from "react"
import {
  KeyRoundIcon,
  Loader2Icon,
  MailIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"

import {
  AccountVerificationForm,
  type AccountVerificationFormCopy,
} from "@/components/account-verification-form"
import { StatusBadge } from "@/components/status-badge"
import { SuccessAlert } from "@/components/status-alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert } from "@/components/ui/alert"

export type AccountSecurityFormsCopy = {
  passwordsDoNotMatch: string
  currentPassword: string
  newPassword: string
  confirmNewPassword: string
  changePasswordTitle: string
  changePasswordDetail: string
  changePasswordButton: string
  changePasswordSuccess: string
  changePasswordError: string
  setPasswordTitle: string
  setPasswordDetail: string
  setPasswordButton: string
  setPasswordSuccess: string
  setPasswordError: string
  changeEmailTitle: string
  newEmail: string
  newEmailPlaceholder: string
  sendConfirmation: string
  changeEmailSuccessPrefix: string
  changeEmailSuccessSuffix: string
  pendingChange: string
  changeEmailError: string
}

export type AccountSecurityPanelCopy = {
  passwordTab: string
  emailTab: string
  password: string
  email: string
  connected: string
  pending: string
  passwordSet: string
  oauthOnly: string
  currentEmail: string
}

type SecurityTab = "password" | "email"
type SecurityEditMode = "password" | "email" | null

const defaultCopy: AccountSecurityFormsCopy = {
  passwordsDoNotMatch: "Passwords do not match.",
  currentPassword: "Current password",
  newPassword: "New password",
  confirmNewPassword: "Confirm new password",
  changePasswordTitle: "Change password",
  changePasswordDetail:
    "Update the credential password and revoke other sessions.",
  changePasswordButton: "Change password",
  changePasswordSuccess: "Password changed. Other sessions were revoked.",
  changePasswordError: "Could not change this password.",
  setPasswordTitle: "Password not set",
  setPasswordDetail:
    "This account is currently using OAuth only. Set a local password to add email/password as another sign-in method.",
  setPasswordButton: "Set password",
  setPasswordSuccess:
    "Password set. You can now sign in with email/password and manage this password here.",
  setPasswordError:
    "Could not set this password. Sign in again and retry if the session is no longer fresh.",
  changeEmailTitle: "Change email",
  newEmail: "New email",
  newEmailPlaceholder: "new@example.com",
  sendConfirmation: "Send confirmation",
  changeEmailSuccessPrefix: "Confirmation sent for",
  changeEmailSuccessSuffix:
    "Confirm the current email first, then verify the new email to finish the change.",
  pendingChange: "Pending change",
  changeEmailError: "Could not start the email change.",
}

export function AccountSecurityForms({
  currentEmail,
  hasPasswordCredential,
  copy = defaultCopy,
}: {
  currentEmail: string
  hasPasswordCredential: boolean
  copy?: AccountSecurityFormsCopy
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {hasPasswordCredential ? (
        <ChangePasswordForm copy={copy} />
      ) : (
        <PasswordSetupNotice copy={copy} />
      )}
      <ChangeEmailForm currentEmail={currentEmail} copy={copy} />
    </div>
  )
}

export function AccountSecurityPanel({
  currentEmail,
  emailVerified,
  verificationDetail,
  hasPasswordCredential,
  copy,
  formsCopy = defaultCopy,
  verificationCopy,
}: {
  currentEmail: string
  emailVerified: boolean
  verificationDetail: string
  hasPasswordCredential: boolean
  copy: AccountSecurityPanelCopy
  formsCopy?: AccountSecurityFormsCopy
  verificationCopy: AccountVerificationFormCopy
}) {
  const [tab, setTab] = useState<SecurityTab>("password")
  const [editMode, setEditMode] = useState<SecurityEditMode>(null)

  function selectTab(nextTab: SecurityTab) {
    setTab(nextTab)
    setEditMode(null)
  }

  return (
    <div className="grid gap-4">
      <div
        role="tablist"
        aria-label="Security"
        className="flex gap-8 border-b text-sm font-medium text-muted-foreground"
      >
        <TabButton
          active={tab === "password"}
          onClick={() => selectTab("password")}
        >
          {copy.passwordTab}
        </TabButton>
        <TabButton active={tab === "email"} onClick={() => selectTab("email")}>
          {copy.emailTab}
        </TabButton>
      </div>

      {tab === "password" ? (
        <div className="divide-y border-y">
          <div className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">{copy.password}</p>
              <p className="font-medium">
                {hasPasswordCredential ? "••••••••••••" : copy.oauthOnly}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <StatusBadge tone={hasPasswordCredential ? "ok" : "warning"}>
                {hasPasswordCredential ? copy.passwordSet : copy.oauthOnly}
              </StatusBadge>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setEditMode(editMode === "password" ? null : "password")
                }
              >
                <KeyRoundIcon />
                {hasPasswordCredential
                  ? formsCopy.changePasswordButton
                  : formsCopy.setPasswordButton}
              </Button>
            </div>
          </div>
          {editMode === "password" ? (
            <div className="py-3">
              {hasPasswordCredential ? (
                <ChangePasswordForm copy={formsCopy} />
              ) : (
                <PasswordSetupNotice copy={formsCopy} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "email" ? (
        <div className="divide-y border-y">
          <div className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">
                {copy.currentEmail}
              </p>
              <p className="font-medium break-all">{currentEmail}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditMode(editMode === "email" ? null : "email")}
            >
              <MailIcon />
              {formsCopy.changeEmailTitle}
            </Button>
          </div>
          {editMode === "email" ? (
            <div className="py-3">
              <ChangeEmailForm currentEmail={currentEmail} copy={formsCopy} />
            </div>
          ) : null}
          <div className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="grid gap-1">
              <p className="font-medium">{copy.email}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                {verificationDetail}
              </p>
            </div>
            <StatusBadge tone={emailVerified ? "ok" : "warning"}>
              {emailVerified ? copy.connected : copy.pending}
            </StatusBadge>
          </div>
          {!emailVerified ? (
            <div className="py-3">
              <AccountVerificationForm
                email={currentEmail}
                copy={verificationCopy}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className="border-b-2 border-transparent pb-3 text-left transition-colors hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ChangePasswordForm({ copy }: { copy: AccountSecurityFormsCopy }) {
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")

    const form = event.currentTarget
    const formData = new FormData(form)
    const currentPassword = String(formData.get("currentPassword") || "")
    const newPassword = String(formData.get("newPassword") || "")
    const confirmPassword = String(formData.get("confirmPassword") || "")

    if (newPassword !== confirmPassword) {
      setError(copy.passwordsDoNotMatch)
      return
    }

    startTransition(async () => {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        }),
      })

      if (!response.ok) {
        setError(await readError(response, copy.changePasswordError))
        return
      }

      form.reset()
      setMessage(copy.changePasswordSuccess)
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <h3 className="sr-only">{copy.changePasswordTitle}</h3>
      <Field
        id="currentPassword"
        label={copy.currentPassword}
        autoComplete="current-password"
      />
      <Field
        id="newPassword"
        label={copy.newPassword}
        autoComplete="new-password"
      />
      <Field
        id="confirmPassword"
        label={copy.confirmNewPassword}
        autoComplete="new-password"
      />

      <FormMessage message={message} error={error} />

      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <ShieldCheckIcon />
        )}
        {copy.changePasswordButton}
      </Button>
    </form>
  )
}

function PasswordSetupNotice({ copy }: { copy: AccountSecurityFormsCopy }) {
  const router = useRouter()
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")

    const form = event.currentTarget
    const formData = new FormData(form)
    const newPassword = String(formData.get("setPassword") || "")
    const confirmPassword = String(formData.get("confirmSetPassword") || "")

    if (newPassword !== confirmPassword) {
      setError(copy.passwordsDoNotMatch)
      return
    }

    startTransition(async () => {
      const response = await fetch("/api/account/set-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ newPassword }),
      })

      if (!response.ok) {
        setError(await readError(response, copy.setPasswordError))
        return
      }

      form.reset()
      setMessage(copy.setPasswordSuccess)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <h3 className="font-medium">{copy.setPasswordTitle}</h3>
      <p className="text-sm leading-6 text-muted-foreground">
        {copy.setPasswordDetail}
      </p>
      <Field
        id="setPassword"
        label={copy.newPassword}
        autoComplete="new-password"
      />
      <Field
        id="confirmSetPassword"
        label={copy.confirmNewPassword}
        autoComplete="new-password"
      />

      <FormMessage message={message} error={error} />

      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <ShieldCheckIcon />
        )}
        {copy.setPasswordButton}
      </Button>
    </form>
  )
}

function ChangeEmailForm({
  currentEmail,
  copy,
}: {
  currentEmail: string
  copy: AccountSecurityFormsCopy
}) {
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pendingEmail, setPendingEmail] = useState("")
  const [isPending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")

    const form = event.currentTarget
    const formData = new FormData(form)
    const newEmail = String(formData.get("newEmail") || "").trim()

    startTransition(async () => {
      const response = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          newEmail,
          callbackURL: "/account",
        }),
      })

      if (!response.ok) {
        setError(await readError(response, copy.changeEmailError))
        return
      }

      setPendingEmail(newEmail)
      setMessage(
        `${copy.changeEmailSuccessPrefix} ${newEmail}. ${copy.changeEmailSuccessSuffix}`
      )
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <h3 className="sr-only">{copy.changeEmailTitle}</h3>
      <div className="space-y-2">
        <label htmlFor="newEmail" className="text-sm font-medium">
          {copy.newEmail}
        </label>
        <Input
          id="newEmail"
          name="newEmail"
          type="email"
          autoComplete="email"
          placeholder={copy.newEmailPlaceholder}
          defaultValue={pendingEmail}
          required
        />
      </div>

      {pendingEmail ? (
        <p className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
          {copy.pendingChange}: {currentEmail} {"->"} {pendingEmail}
        </p>
      ) : null}

      <FormMessage message={message} error={error} />

      <Button type="submit" disabled={isPending}>
        {isPending ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
        {copy.sendConfirmation}
      </Button>
    </form>
  )
}

function Field({
  id,
  label,
  autoComplete,
}: {
  id: string
  label: string
  autoComplete: string
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        minLength={8}
        required
      />
    </div>
  )
}

function FormMessage({ message, error }: { message: string; error: string }) {
  return (
    <>
      {message ? <SuccessAlert>{message}</SuccessAlert> : null}

      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </>
  )
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return payload?.message || payload?.error?.message || fallback
}
