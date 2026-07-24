import { NextResponse } from "next/server"

import { recordAuditLog } from "@/lib/audit"
import { getServerSession } from "@/lib/auth"
import { getPgPool } from "@/lib/database"

export async function PATCH(request: Request) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ message: "Session required." }, { status: 401 })
  }
  if (!session.user.emailVerified) {
    return NextResponse.json({ message: "Email verification required." }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name || name.length > 80) {
    return NextResponse.json({ message: "Name must be between 1 and 80 characters." }, { status: 400 })
  }

  await getPgPool().query(
    `
      update "user"
      set name = $2,
          "updatedAt" = now()
      where id = $1
    `,
    [session.user.id, name]
  )
  await recordAuditLog({
    actor: { userId: session.user.id, email: session.user.email },
    action: "account.profile.updated",
    targetType: "user",
    targetId: session.user.id,
    metadata: { fields: ["name"] },
  })

  return NextResponse.json({ name })
}
