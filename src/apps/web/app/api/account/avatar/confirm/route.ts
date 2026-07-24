import { NextResponse } from "next/server"

import {
  assertAvatarKeyForUser,
  ensureAvatarObjectExists,
  getAvatarImagePath,
} from "@/lib/avatar-storage"
import { recordAuditLog } from "@/lib/audit"
import { getServerSession } from "@/lib/auth"
import { getPgPool } from "@/lib/database"

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ message: "Session required." }, { status: 401 })
  }
  if (!session.user.emailVerified) {
    return NextResponse.json({ message: "Email verification required." }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const key = typeof body.key === "string" ? body.key : ""
  if (!key) {
    return NextResponse.json({ message: "Avatar object key is required." }, { status: 400 })
  }

  try {
    assertAvatarKeyForUser(key, session.user.id)
    await ensureAvatarObjectExists(key)

    const imageUrl = getAvatarImagePath(key)
    await getPgPool().query(
      `
        update "user"
        set image = $2,
            "updatedAt" = now()
        where id = $1
      `,
      [session.user.id, imageUrl]
    )
    await recordAuditLog({
      actor: { userId: session.user.id, email: session.user.email },
      action: "account.avatar.updated",
      targetType: "user",
      targetId: session.user.id,
      metadata: { key },
    })

    return NextResponse.json({ image: imageUrl })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not confirm avatar upload." },
      { status: 400 }
    )
  }
}
