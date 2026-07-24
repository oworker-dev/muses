import {
  ClockIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react"

import {
  AdminMetricCard,
  AdminPageHeader,
  AdminPanel,
  CountBadge,
} from "@/components/admin-dashboard-widgets"
import { StatusBadge } from "@/components/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getAdminUsers } from "@/lib/admin"

export default async function AdminUsersPage() {
  const users = await getAdminUsers()
  const verified = users.filter((user) => user.emailVerified).length
  const pending = users.length - verified
  const active = users.filter((user) => user.lastSeenAt).length
  const oauth = users.filter((user) => user.authMode.includes("oauth")).length

  return (
    <>
      <AdminPageHeader
        title="Users"
        description="Review account status, authentication mode, subscription state, and recent activity context."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Latest accounts"
          value={formatNumber(users.length)}
          detail="Loaded for support review"
          icon={UsersIcon}
        />
        <AdminMetricCard
          label="Verified"
          value={formatNumber(verified)}
          detail={`${formatNumber(pending)} pending`}
          tone="ok"
          icon={UserCheckIcon}
        />
        <AdminMetricCard
          label="Seen accounts"
          value={formatNumber(active)}
          detail="Has activity summary"
          icon={ClockIcon}
        />
        <AdminMetricCard
          label="OAuth linked"
          value={formatNumber(oauth)}
          detail="GitHub or Google"
          icon={ShieldCheckIcon}
        />
      </section>

      <AdminPanel
        title="Account directory"
        description="High-signal support view. It does not expose sensitive secrets or raw analytics identifiers."
        action={<CountBadge>{users.length} accounts</CountBadge>}
      >
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Auth</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Context</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="min-w-72">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-9 rounded-md">
                        <AvatarFallback className="rounded-md">
                          {getInitials(user.name || user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {user.name || user.email}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={user.emailVerified ? "ok" : "warning"}>
                      {user.emailVerified ? "Verified" : "Pending"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <div className="grid gap-1">
                      <span className="font-medium capitalize">
                        {user.subscriptionPlan}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {user.subscriptionStatus}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary" className="capitalize">
                        {user.authMode}
                      </Badge>
                      {user.providers.slice(0, 2).map((provider) => (
                        <Badge key={provider} variant="outline">
                          {provider}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.lastSeenAt ? formatDateTime(user.lastSeenAt) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="grid max-w-56 gap-1 text-xs text-muted-foreground">
                      <span className="truncate">
                        {user.lastCountry || "unknown"} /{" "}
                        {user.lastDevice || "unknown"}
                      </span>
                      <span className="truncate">
                        {user.lastPath || "No path recorded"}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </AdminPanel>
    </>
  )
}

function getInitials(value: string) {
  return (
    value
      .replace(/@.*$/, "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
