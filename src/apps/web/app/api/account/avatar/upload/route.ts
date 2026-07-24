import { NextResponse } from "next/server"

import { avatarMaxBytes, createAvatarUpload } from "@/lib/avatar-storage"
import { getServerSession } from "@/lib/auth"

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ message: "Session required." }, { status: 401 })
  }
  if (!session.user.emailVerified) {
    return NextResponse.json({ message: "Email verification required." }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const fileName = typeof body.fileName === "string" ? body.fileName : ""
  const contentType = typeof body.contentType === "string" ? body.contentType : ""
  const size = typeof body.size === "number" ? body.size : undefined

  if (!fileName || !contentType) {
    return NextResponse.json({ message: "Avatar file name and content type are required." }, { status: 400 })
  }
  if (typeof size === "number" && size > avatarMaxBytes) {
    return NextResponse.json({ message: "Avatar image must be 2 MB or smaller." }, { status: 400 })
  }

  try {
    return NextResponse.json({
      upload: await createAvatarUpload({
        userId: session.user.id,
        fileName,
        contentType,
        size,
      }),
    })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not create avatar upload." },
      { status: 400 }
    )
  }
}
