"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserCircleIcon } from "lucide-react"
import type { ReactNode } from "react"

import {
  AdminAppSidebar,
  getAdminBreadcrumbLabel,
} from "@/components/admin-app-sidebar"
import { SignOutButton } from "@/components/sign-out-button"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export function AdminDashboardShell({
  user,
  children,
}: {
  user: {
    name?: string | null
    email: string
    image?: string | null
  }
  children: ReactNode
}) {
  const pathname = usePathname()
  const breadcrumbPage = getAdminBreadcrumbLabel(pathname)

  return (
    <SidebarProvider>
      <AdminAppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex min-w-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 !h-4 !self-center"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <Link href="/">OWorker SaaS</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <Link href="/admin">Site Admin</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{breadcrumbPage}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="hidden items-center gap-2 px-4 sm:flex">
            <Button asChild variant="ghost" size="sm">
              <Link href="/account">
                <UserCircleIcon />
                Account
              </Link>
            </Button>
            <SignOutButton variant="ghost" label="Sign out" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 pt-0 sm:p-6 sm:pt-2">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
