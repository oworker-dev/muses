import { getEmailRuntime } from "@/lib/email"

export const dynamic = "force-dynamic"

export function GET() {
  return Response.json({
    status: "ok",
    service: "oworker.saas-starter",
    database: process.env.DATABASE_URL ? "configured" : "missing",
    auth: "better-auth",
    oauth: {
      github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
    billing:
      process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO
        ? "stripe"
        : "not-configured",
    email: getEmailRuntime(),
    analytics: "first-party",
    admin: process.env.SITE_ADMIN_EMAILS ? "configured" : "first-user-bootstrap",
  })
}
