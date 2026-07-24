"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ActivityIcon,
  BarChart3Icon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const links = [
  { href: "/admin", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/revenue", label: "Revenue", icon: ReceiptTextIcon },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: ReceiptTextIcon },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3Icon },
  { href: "/admin/health", label: "Health", icon: HeartPulseIcon },
  { href: "/admin/audit-logs", label: "Security Audit", icon: ActivityIcon },
  { href: "/admin/diagnostics", label: "Diagnostics", icon: SearchIcon },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap gap-2">
      {links.map((link) => {
        const Icon = link.icon
        const active = pathname === link.href || (link.href !== "/admin" && pathname.startsWith(`${link.href}/`))
        return (
          <Button key={link.href} asChild variant={active ? "default" : "outline"} size="sm">
            <Link href={link.href} aria-current={active ? "page" : undefined}>
              <Icon />
              {link.label}
            </Link>
          </Button>
        )
      })}
    </nav>
  )
}
