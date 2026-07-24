import type { ReactNode } from "react"
import Link from "next/link"

import {
  AccountAppSidebar,
  type AccountAppSidebarCopy,
} from "@/components/account-app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

export function AccountDashboardShell({
  user,
  siteAdmin,
  copy,
  breadcrumbPage,
  children,
}: {
  user: {
    name?: string | null
    email: string
    image?: string | null
  }
  siteAdmin: boolean
  copy: AccountAppSidebarCopy
  breadcrumbPage: string
  children: ReactNode
}) {
  return (
    <SidebarProvider>
      <AccountAppSidebar user={user} siteAdmin={siteAdmin} copy={copy} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
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
                    <Link href="/">{copy.brand}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{breadcrumbPage}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
