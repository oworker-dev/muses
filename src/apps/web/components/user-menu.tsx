import Link from "next/link"

import { Button } from "@/components/ui/button"
import { UserMenuDropdown } from "@/components/user-menu-dropdown"
import { getServerSession } from "@/lib/auth"
import { isSiteAdmin } from "@/lib/admin"

export async function UserMenu() {
  const session = await readSession()

  if (!session) {
    return <AnonymousUserMenu />
  }

  const siteAdmin = await readSiteAdmin(session.user.id, session.user.email)
  const displayName = session.user.name || session.user.email
  const initials = getInitials(displayName)

  return (
    <UserMenuDropdown
      displayName={displayName}
      email={session.user.email}
      image={session.user.image}
      initials={initials}
      siteAdmin={siteAdmin}
    />
  )
}

async function readSession() {
  try {
    return await getServerSession()
  } catch {
    return null
  }
}

async function readSiteAdmin(userId: string, email: string) {
  try {
    return await isSiteAdmin(userId, email)
  } catch {
    return false
  }
}

function AnonymousUserMenu() {
  return (
    <div className="flex items-center gap-2">
      <Button asChild size="lg">
        <Link href="/login">Sign in</Link>
      </Button>
    </div>
  )
}

function getInitials(value: string) {
  const initials = value
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()

  return initials || "U"
}
