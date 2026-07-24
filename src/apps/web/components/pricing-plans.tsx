import { CheckIcon, CreditCardIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { billingPlans, type BillingPlanId } from "@/lib/billing"

export function PricingPlans({
  authenticated,
  currentPlanId,
}: {
  authenticated: boolean
  currentPlanId?: BillingPlanId | null
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {billingPlans.map((plan) => {
        const current = currentPlanId === plan.id
        const proPlan = plan.id === "pro"

        return (
          <article
            key={plan.id}
            className="rounded-md border bg-card p-6 text-card-foreground shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {proPlan
                    ? "A neutral example tier for the upgrade path."
                    : "A neutral example tier for the default plan surface."}
                </p>
              </div>
              {current ? (
                <span className="inline-flex shrink-0 items-center rounded-full border bg-muted px-2.5 py-1 text-xs leading-none font-medium whitespace-nowrap">
                  Current plan
                </span>
              ) : null}
            </div>

            <p className="mt-6 text-4xl font-semibold">
              {formatMoney(plan.monthlyAmountCents)}
              <span className="text-sm font-medium text-muted-foreground">
                {" "}
                /mo
              </span>
            </p>

            <ul className="mt-6 grid gap-3 text-sm">
              {plan.benefits.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckIcon className="size-4" />
                  {item}
                </li>
              ))}
            </ul>

            <PlanAction
              authenticated={authenticated}
              current={current}
              planId={plan.id}
            />
          </article>
        )
      })}
    </div>
  )
}

function PlanAction({
  authenticated,
  current,
  planId,
}: {
  authenticated: boolean
  current: boolean
  planId: BillingPlanId
}) {
  if (current) {
    return (
      <Button className="mt-6 w-full" disabled variant="outline">
        Current plan
      </Button>
    )
  }

  if (!authenticated) {
    return (
      <Button
        asChild
        className="mt-6 w-full"
        variant={planId === "pro" ? "default" : "outline"}
      >
        <Link href="/login?callbackURL=/pricing">Get started</Link>
      </Button>
    )
  }

  if (planId !== "pro") {
    return <div className="mt-6 h-9" aria-hidden="true" />
  }

  return (
    <form action="/api/billing/checkout" method="post" className="mt-6">
      <input type="hidden" name="planId" value={planId} />
      <Button className="w-full" type="submit">
        <CreditCardIcon />
        Upgrade plan
      </Button>
    </form>
  )
}

function formatMoney(cents: number) {
  if (cents === 0) {
    return "$0"
  }

  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
