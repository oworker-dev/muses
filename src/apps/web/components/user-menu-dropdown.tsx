"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ReactNode } from "react"
import { useTransition } from "react"
import {
  ChevronsUpDownIcon,
  CreditCardIcon,
  HelpCircleIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCircleIcon,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { authClient } from "@/lib/auth-client"

export type UserMenuDropdownCopy = {
  upgradePlan: string
  account: string
  billing: string
  settings: string
  admin: string
  support: string
  signOut: string
  openUserMenu: string
}

const defaultCopy: UserMenuDropdownCopy = {
  upgradePlan: "Upgrade plan",
  account: "Account",
  billing: "Billing",
  settings: "Settings",
  admin: "Admin",
  support: "Help",
  signOut: "Sign out",
  openUserMenu: "Open user menu",
}

export function UserMenuDropdown({
  displayName,
  email,
  image,
  initials,
  siteAdmin,
  copy = defaultCopy,
}: {
  displayName: string
  email: string
  image?: string | null
  initials: string
  siteAdmin: boolean
  copy?: UserMenuDropdownCopy
}) {
  return (
    <UserMenuDropdownRoot
      displayName={displayName}
      email={email}
      image={image}
      initials={initials}
      siteAdmin={siteAdmin}
      copy={copy}
      align="end"
      sideOffset={8}
      trigger={
        <button
          type="button"
          className="flex size-9 items-center justify-center overflow-hidden rounded-full border bg-background text-sm font-semibold shadow-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted"
          aria-label={copy.openUserMenu}
        >
          <Avatar className="size-full">
            {image ? (
              <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />
            ) : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      }
    />
  )
}

export function SidebarUserMenuDropdown({
  displayName,
  email,
  image,
  initials,
  siteAdmin,
  copy,
}: {
  displayName: string
  email: string
  image?: string | null
  initials: string
  siteAdmin: boolean
  copy: UserMenuDropdownCopy
}) {
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <UserMenuDropdownRoot
          displayName={displayName}
          email={email}
          image={image}
          initials={initials}
          siteAdmin={siteAdmin}
          copy={copy}
          side={isMobile ? "bottom" : "right"}
          align="end"
          sideOffset={4}
          contentClassName="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          trigger={
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              aria-label={copy.openUserMenu}
            >
              <Avatar className="h-8 w-8 rounded-lg">
                {image ? (
                  <AvatarImage
                    src={image}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <AvatarFallback className="rounded-lg">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs">{email}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          }
        />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function UserMenuDropdownRoot({
  displayName,
  email,
  image,
  initials,
  siteAdmin,
  copy,
  trigger,
  align,
  side,
  sideOffset,
  contentClassName,
}: {
  displayName: string
  email: string
  image?: string | null
  initials: string
  siteAdmin: boolean
  copy: UserMenuDropdownCopy
  trigger: ReactNode
  align: "start" | "center" | "end"
  side?: "top" | "right" | "bottom" | "left"
  sideOffset: number
  contentClassName?: string
}) {
  const router = useRouter()
  const [isSigningOut, startSigningOut] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={contentClassName || "w-72"}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex min-w-0 items-center gap-3 px-2 py-2 text-left">
            <Avatar className="size-10 border">
              {image ? (
                <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/pricing">
              <SparklesIcon />
              {copy.upgradePlan}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/account">
              <UserCircleIcon />
              {copy.account}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/account/billing">
              <CreditCardIcon />
              {copy.billing}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/account/settings">
              <SettingsIcon />
              {copy.settings}
            </Link>
          </DropdownMenuItem>
          {siteAdmin ? (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <ShieldCheckIcon />
                {copy.admin}
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href="/support">
              <HelpCircleIcon />
              {copy.support}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={(event) => {
            event.preventDefault()
            startSigningOut(async () => {
              await authClient.signOut()
              router.push("/login")
              router.refresh()
            })
          }}
        >
          <LogOutIcon />
          {copy.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
