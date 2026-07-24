import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth-card"
import { PasswordResetRequestForm } from "@/components/password-reset-request-form"
import { getServerSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function ForgotPasswordPage() {
  const session = await getServerSession()

  if (session) {
    redirect("/account")
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Send a secure reset link through the configured transactional email boundary."
    >
      <PasswordResetRequestForm />
    </AuthCard>
  )
}
