"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { LinkIcon, Loader2Icon, UnlinkIcon } from "lucide-react"
import type { IconType } from "react-icons"
import { FcGoogle } from "react-icons/fc"
import { SiGithub } from "react-icons/si"

import type { AccountAuthProvider } from "@/lib/account"
import type { OAuthProvider } from "@/lib/oauth"
import { StatusBadge } from "@/components/status-badge"
import { SuccessAlert } from "@/components/status-alert"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

const socialProviders: Array<{
  id: OAuthProvider
  name: string
  icon: IconType
}> = [
  { id: "github", name: "GitHub", icon: SiGithub },
  { id: "google", name: "Google", icon: FcGoogle },
]

export type ConnectedAccountsPanelCopy = {
  statusConnected: string
  statusNotConnected: string
  statusAvailable: string
  statusNotConfigured: string
  providerConnected: string
  providerConnectDetail: string
  providerNotConfiguredDetail: string
  connect: string
  disconnect: string
  lastMethodWarning: string
  connectedSuccess: string
  disconnectedSuccess: string
  connectError: string
  disconnectError: string
  recently: string
}

const defaultCopy: ConnectedAccountsPanelCopy = {
  statusConnected: "Connected",
  statusNotConnected: "Not connected",
  statusAvailable: "Available",
  statusNotConfigured: "Not configured",
  providerConnected: "Connected {date}.",
  providerConnectDetail: "Connect {provider} as an additional sign-in method.",
  providerNotConfiguredDetail:
    "Configure provider credentials to enable this sign-in method.",
  connect: "Connect",
  disconnect: "Disconnect",
  lastMethodWarning:
    "Add another sign-in method before disconnecting this account.",
  connectedSuccess: "{provider} connected.",
  disconnectedSuccess: "{provider} disconnected.",
  connectError: "Could not connect {provider}.",
  disconnectError: "Could not disconnect {provider}.",
  recently: "recently",
}

export function ConnectedAccountsPanel({
  authProviders,
  enabledOAuthProviders,
  hasPasswordCredential,
  copy = defaultCopy,
  locale = "en",
}: {
  authProviders: AccountAuthProvider[]
  enabledOAuthProviders: OAuthProvider[]
  hasPasswordCredential: boolean
  copy?: ConnectedAccountsPanelCopy
  locale?: string
}) {
  const signInMethodCount =
    (hasPasswordCredential ? 1 : 0) +
    authProviders.filter((provider) => isSocialProvider(provider.provider))
      .length

  return (
    <div className="divide-y border-y">
      {socialProviders.map((provider) => {
        const account = authProviders.find(
          (item) => item.provider === provider.id
        )
        return (
          <SocialProviderRow
            key={provider.id}
            provider={provider}
            account={account}
            configured={enabledOAuthProviders.includes(provider.id)}
            canDisconnect={Boolean(account) && signInMethodCount > 1}
            copy={copy}
            locale={locale}
          />
        )
      })}
    </div>
  )
}

function SocialProviderRow({
  provider,
  account,
  configured,
  canDisconnect,
  copy,
  locale,
}: {
  provider: (typeof socialProviders)[number]
  account?: AccountAuthProvider
  configured: boolean
  canDisconnect: boolean
  copy: ConnectedAccountsPanelCopy
  locale: string
}) {
  const router = useRouter()
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()
  const connected = Boolean(account)
  const Icon = provider.icon

  function connect() {
    setMessage("")
    setError("")

    startTransition(async () => {
      const response = await fetch("/api/auth/link-social", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          provider: provider.id,
          callbackURL: "/account?account=linked",
          errorCallbackURL: "/account?account=link-error",
        }),
      })

      if (!response.ok) {
        setError(
          await readError(
            response,
            formatCopy(copy.connectError, { provider: provider.name })
          )
        )
        return
      }

      const payload = (await response.json().catch(() => null)) as {
        url?: string
        redirect?: boolean
      } | null
      if (payload?.url) {
        window.location.href = payload.url
        return
      }

      setMessage(formatCopy(copy.connectedSuccess, { provider: provider.name }))
      router.refresh()
    })
  }

  function disconnect() {
    if (!account || !canDisconnect) {
      return
    }

    setMessage("")
    setError("")

    startTransition(async () => {
      const response = await fetch("/api/auth/unlink-account", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          providerId: provider.id,
          accountId: account.accountId || undefined,
        }),
      })

      if (!response.ok) {
        setError(
          await readError(
            response,
            formatCopy(copy.disconnectError, { provider: provider.name })
          )
        )
        return
      }

      setMessage(
        formatCopy(copy.disconnectedSuccess, { provider: provider.name })
      )
      router.refresh()
    })
  }

  return (
    <div className="grid gap-3 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full border bg-background">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-medium">{provider.name}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {connected
              ? formatCopy(copy.providerConnected, {
                  date: formatDate(account?.connectedAt, locale, copy.recently),
                })
              : configured
                ? formatCopy(copy.providerConnectDetail, {
                    provider: provider.name,
                  })
                : copy.providerNotConfiguredDetail}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <StatusBadge tone={connected ? "ok" : "warning"}>
          {connected
            ? copy.statusConnected
            : configured
              ? copy.statusAvailable
              : copy.statusNotConfigured}
        </StatusBadge>
        {connected ? (
          <Button
            type="button"
            variant="outline"
            onClick={disconnect}
            disabled={isPending || !canDisconnect}
          >
            {isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <UnlinkIcon />
            )}
            {copy.disconnect}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={connect}
            disabled={isPending || !configured}
          >
            {isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <LinkIcon />
            )}
            {copy.connect}
          </Button>
        )}
      </div>
      {connected && !canDisconnect ? (
        <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
          {copy.lastMethodWarning}
        </p>
      ) : null}
      {message ? (
        <SuccessAlert className="sm:col-span-2">{message}</SuccessAlert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="sm:col-span-2">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}

function isSocialProvider(provider: string) {
  return socialProviders.some((item) => item.id === provider)
}

function formatDate(
  value: string | undefined,
  locale: string,
  fallback: string
) {
  if (!value) {
    return fallback
  }

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value)
  )
}

function formatCopy(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template
  )
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return payload?.message || payload?.error?.message || fallback
}
