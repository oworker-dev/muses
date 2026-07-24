import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth-card"
import { VerifyEmailPanel } from "@/components/verify-email-panel"
import { getServerSession } from "@/lib/auth"
import { normalizeInternalPath } from "@/lib/urls"

export const dynamic = "force-dynamic"

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession()
  const params = await searchParams
  const callbackURL = normalizeInternalPath(
    typeof params?.callbackURL === "string" ? params.callbackURL : null,
    "/"
  )

  if (session?.user.emailVerified) {
    redirect(callbackURL)
  }

  const email = typeof params?.email === "string" ? params.email : session?.user.email || ""
  const resent = params?.resent === "true"

  return (
    <AuthCard
      title="Verify your email"
      description="Protected account actions stay locked until this address is verified."
    >
      <VerifyEmailPanel initialEmail={email} resent={resent} callbackURL={callbackURL} />
    </AuthCard>
  )
}
