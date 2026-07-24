"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentProps } from "react"
import {
  CreditCardIcon,
  HomeIcon,
  SettingsIcon,
  ShieldCheckIcon,
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
} from "@/components/ui/sidebar"

export type AccountAppSidebarCopy = {
  brand: string
  console: string
  account: string
  overview: string
  billing: string
  settings: string
  admin: string
  support: string
  upgradePlan: string
  signOut: string
  openUserMenu: string
}

export function AccountAppSidebar({
  user,
  siteAdmin,
  copy,
  ...props
}: ComponentProps<typeof Sidebar> & {
  user: {
    name?: string | null
    email: string
    image?: string | null
  }
  siteAdmin: boolean
  copy: AccountAppSidebarCopy
}) {
  const pathname = usePathname()
  const navItems = [
    { href: "/account", label: copy.overview, icon: HomeIcon },
    { href: "/account/billing", label: copy.billing, icon: CreditCardIcon },
    { href: "/account/settings", label: copy.settings, icon: SettingsIcon },
    ...(siteAdmin
      ? [{ href: "/admin", label: copy.admin, icon: ShieldCheckIcon }]
      : []),
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
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
                  className="h-6 w-10 shrink-0 object-contain"
                  priority
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{copy.brand}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{copy.account}</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => (
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
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenuDropdown
          displayName={user.name || user.email}
          email={user.email}
          image={user.image}
          initials={getInitials(user.name || user.email)}
          siteAdmin={siteAdmin}
          copy={{
            upgradePlan: copy.upgradePlan,
            account: copy.console,
            billing: copy.billing,
            settings: copy.settings,
            admin: copy.admin,
            support: copy.support,
            signOut: copy.signOut,
            openUserMenu: copy.openUserMenu,
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function isItemActive(pathname: string, href: string) {
  return pathname === href
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
