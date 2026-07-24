"use client"

import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import type { IconType } from "react-icons"
import { FcGoogle } from "react-icons/fc"
import { SiGithub } from "react-icons/si"

import { authClient } from "@/lib/auth-client"
import type { OAuthProvider } from "@/lib/oauth"
import { Button } from "@/components/ui/button"

const providers: Array<{
  id: OAuthProvider
  label: string
  icon: IconType
}> = [
  {
    id: "github",
    label: "Continue with GitHub",
    icon: SiGithub,
  },
  {
    id: "google",
    label: "Continue with Google",
    icon: FcGoogle,
  },
]

export function OAuthButtons({
  enabledProviders,
  callbackURL = "/",
  labels,
  dividerLabel = "Email",
}: {
  enabledProviders: OAuthProvider[]
  callbackURL?: string
  labels?: Partial<Record<OAuthProvider, string>>
  dividerLabel?: string
}) {
  const enabled = providers.filter((provider) =>
    enabledProviders.includes(provider.id)
  )
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(
    null
  )

  if (enabled.length === 0) {
    return null
  }

  async function signIn(provider: OAuthProvider) {
    setPendingProvider(provider)
    await authClient.signIn.social({
      provider,
      callbackURL,
    })
    setPendingProvider(null)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {enabled.map((provider) => (
          <OAuthButton
            key={provider.id}
            provider={provider}
            label={labels?.[provider.id] || provider.label}
            pending={pendingProvider === provider.id}
            disabled={pendingProvider !== null}
            onClick={() => signIn(provider.id)}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>{dividerLabel}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}

function OAuthButton({
  provider,
  label,
  pending,
  disabled,
  onClick,
}: {
  provider: (typeof providers)[number]
  label: string
  pending: boolean
  disabled: boolean
  onClick: () => void
}) {
  const Icon = provider.icon

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      disabled={disabled}
      onClick={onClick}
    >
      {pending ? (
        <Loader2Icon className="animate-spin" />
      ) : (
        <Icon className="size-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  )
}
