import { redirect } from "next/navigation"
import { Suspense } from "react"

import { AuthCard } from "@/components/auth-card"
import { ResetPasswordForm } from "@/components/reset-password-form"
import { Alert } from "@/components/ui/alert"
import { getServerSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function ResetPasswordPage() {
  const session = await getServerSession()

  if (session) {
    redirect("/account")
  }

  return (
    <AuthCard
      title="Set a new password"
      description="Use the reset link from your email to update your password."
    >
        <Suspense
          fallback={
            <Alert>
              Loading reset form...
            </Alert>
          }
        >
          <ResetPasswordForm />
        </Suspense>
    </AuthCard>
  )
}
