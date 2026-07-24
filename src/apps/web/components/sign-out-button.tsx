"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { LogOutIcon } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

export function SignOutButton({
  className,
  label = "Sign out",
  variant = "outline",
}: {
  className?: string
  label?: string
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await authClient.signOut()
          router.push("/login")
          router.refresh()
        })
      }}
    >
      <LogOutIcon />
      {label}
    </Button>
  )
}
