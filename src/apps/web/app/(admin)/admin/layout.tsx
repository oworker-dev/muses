import type { ReactNode } from "react"

import { AdminDashboardShell } from "@/components/admin-dashboard-shell"
import { requireSiteAdmin } from "@/lib/admin"

export const dynamic = "force-dynamic"

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const session = await requireSiteAdmin()

  return (
    <AdminDashboardShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    >
      {children}
    </AdminDashboardShell>
  )
}
