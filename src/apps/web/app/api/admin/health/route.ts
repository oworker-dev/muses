import { getServerSession } from "@/lib/auth"
import { getAdminHealth, isSiteAdmin } from "@/lib/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession()
  if (!session) {
    return Response.json(
      { message: "Authentication required." },
      { status: 401 }
    )
  }
  if (!session.user.emailVerified) {
    return Response.json(
      { message: "Email verification required." },
      { status: 403 }
    )
  }
  if (!(await isSiteAdmin(session.user.id, session.user.email))) {
    return Response.json(
      { message: "Site admin access required." },
      { status: 403 }
    )
  }

  return Response.json(
    {
      checkedAt: new Date().toISOString(),
      integrations: await getAdminHealth(),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  )
}
