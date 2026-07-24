import { NextResponse } from "next/server"

import { assertAvatarKeyForUser, readAvatarObject } from "@/lib/avatar-storage"
import { getServerSession } from "@/lib/auth"

export async function GET(request: Request) {
  const session = await getServerSession()
  if (!session) {
    return new Response("Session required.", { status: 401 })
  }

  const key = new URL(request.url).searchParams.get("key") || ""
  if (!key) {
    return new Response("Avatar object key is required.", { status: 400 })
  }

  try {
    assertAvatarKeyForUser(key, session.user.id)
    const avatar = await readAvatarObject(key)

    return new Response(avatar.body, {
      headers: {
        "cache-control": "private, max-age=300",
        "content-type": avatar.contentType,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Avatar image not found." },
      { status: 404 }
    )
  }
}
