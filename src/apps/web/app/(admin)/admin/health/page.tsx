import Link from "next/link"
import { ActivityIcon, CheckCircle2Icon, SettingsIcon } from "lucide-react"

import {
  AdminPageHeader,
  AdminPanel,
  CountBadge,
} from "@/components/admin-dashboard-widgets"
import { AdminHealthRuntimePanel } from "@/components/admin-health-client"
import { Button } from "@/components/ui/button"

export default function AdminHealthPage() {
  return (
    <>
      <AdminPageHeader
        title="Service Health"
        description="Live runtime checks for the API, database, cache, queue, storage, email, billing, OAuth, and observability boundaries."
        action={<CountBadge>Runtime checks</CountBadge>}
      />

      <AdminHealthRuntimePanel />

      <AdminPanel title="Diagnostics" description="Operational next steps.">
        <div className="grid gap-2 sm:max-w-md">
          <Button variant="outline" className="justify-start" asChild>
            <Link href="/admin/diagnostics">
              <ActivityIcon />
              Review webhook events
            </Link>
          </Button>
          <Button variant="outline" className="justify-start" asChild>
            <Link href="/admin/audit-logs">
              <CheckCircle2Icon />
              Review security audit
            </Link>
          </Button>
          <Button variant="outline" className="justify-start" asChild>
            <Link href="/admin">
              <SettingsIcon />
              Return to overview
            </Link>
          </Button>
        </div>
      </AdminPanel>
    </>
  )
}
