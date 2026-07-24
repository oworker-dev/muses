import { NextResponse } from "next/server"

import { ensureAccountSubscription } from "@/lib/account"
import {
  BillingConfigurationError,
  createCheckoutRedirect,
  type BillingPlanId,
} from "@/lib/billing"
import { getServerSession } from "@/lib/auth"
import { getAppUrl } from "@/lib/urls"

export async function POST(request: Request) {
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

  const formData = await request.formData().catch(() => null)
  const planId = normalizePlanId(String(formData?.get("planId") || "pro"))
  if (!planId) {
    return NextResponse.redirect(
      new URL("/account/billing?billing=unsupported-plan", getAppUrl()),
      { status: 303 }
    )
  }

  await ensureAccountSubscription(session.user)
  let redirectUrl: string

  try {
    redirectUrl = await createCheckoutRedirect({
      accountId: session.user.id,
      email: session.user.email,
      planId,
    })
  } catch (error) {
    const state =
      error instanceof BillingConfigurationError ? "not-configured" : "checkout-error"
    return NextResponse.redirect(
      new URL(`/account/billing?billing=${state}`, getAppUrl()),
      { status: 303 }
    )
  }

  return NextResponse.redirect(redirectUrl, { status: 303 })
}

function normalizePlanId(value: string): BillingPlanId | null {
  if (value === "pro") {
    return value
  }
  return null
}
