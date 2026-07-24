import { NextRequest, NextResponse } from "next/server"

import { handleStripeBillingEvent, parseStripeBillingEvent } from "@/lib/billing"

export async function POST(request: NextRequest) {
  const payload = await request.text()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event
  try {
    event = parseStripeBillingEvent({
      payload,
      signature: request.headers.get("stripe-signature"),
      secret: webhookSecret,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid Stripe webhook payload",
      },
      { status: 400 }
    )
  }

  try {
    return NextResponse.json(await handleStripeBillingEvent(event))
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not process Stripe webhook",
      },
      { status: 500 }
    )
  }
}
