"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3Icon,
  BoxesIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  SearchIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { SidebarUserMenuDropdown } from "@/components/user-menu-dropdown"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useTranslations } from "next-intl"

export type AdminNavItem = {
  href: string
  label: string
  icon: LucideIcon
}

export const adminNavItems: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/revenue", label: "Revenue", icon: ReceiptTextIcon },
  {
    href: "/admin/subscriptions",
    label: "Subscriptions",
    icon: ReceiptTextIcon,
  },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3Icon },
  { href: "/admin/health", label: "Health", icon: HeartPulseIcon },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: ShieldCheckIcon },
  { href: "/admin/diagnostics", label: "Diagnostics", icon: SearchIcon },
]

export function AdminAppSidebar({
  user,
}: {
  user: {
    name?: string | null
    email: string
    image?: string | null
  }
}) {
  const pathname = usePathname()
  const t = useTranslations("AdminModels")

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Link href="/">
                <BrandLogo
                  alt=""
                  width={40}
                  height={24}
                  className="h-6 w-10"
                  priority
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">OWorker SaaS</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Site Admin
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Site Admin</SidebarGroupLabel>
          <SidebarMenu>
            {adminNavItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  tooltip={item.label}
                  asChild
                  isActive={isItemActive(pathname, item.href)}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>{t("navGroup")}</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t("navModels")}
                asChild
                isActive={isItemActive(pathname, "/admin/models")}
              >
                <Link href="/admin/models">
                  <BoxesIcon />
                  <span>{t("navModels")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenuDropdown
          displayName={user.name || user.email}
          email={user.email}
          image={user.image}
          initials={getInitials(user.name || user.email)}
          siteAdmin
          copy={{
            upgradePlan: "Upgrade plan",
            account: "Account Console",
            billing: "Billing",
            settings: "Settings",
            admin: "Admin Console",
            support: "Support",
            signOut: "Sign out",
            openUserMenu: "Open user menu",
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export function getAdminBreadcrumbLabel(pathname: string) {
  const active =
    adminNavItems.find((item) => isItemActive(pathname, item.href)) ||
    adminNavItems[0]
  return active.label
}

function isItemActive(pathname: string, href: string) {
  return (
    pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`))
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

  return initials || "A"
}
