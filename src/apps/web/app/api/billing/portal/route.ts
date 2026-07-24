import { NextResponse } from "next/server"

import { ensureAccountSubscription } from "@/lib/account"
import { createPortalRedirect } from "@/lib/billing"
import { getServerSession } from "@/lib/auth"
import { getAppUrl } from "@/lib/urls"

export async function POST() {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.redirect(new URL("/login?callbackURL=/account/billing", getAppUrl()), { status: 303 })
  }
  if (!session.user.emailVerified) {
    return NextResponse.redirect(
      new URL(
        `/verify-email?email=${encodeURIComponent(session.user.email)}&callbackURL=/account/billing`,
        getAppUrl()
      ),
      { status: 303 }
    )
  }

  await ensureAccountSubscription(session.user)
  return NextResponse.redirect(await createPortalRedirect({ accountId: session.user.id }), {
    status: 303,
  })
}
