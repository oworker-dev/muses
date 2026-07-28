import "./globals.css"

import type { Metadata } from "next"

import { AnalyticsTracker } from "@/components/analytics-tracker"
import { I18nProvider } from "@/components/i18n-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getRequestLocale } from "@/i18n/server"

export const metadata: Metadata = {
  title: {
    default: "Muses",
    template: "%s | Muses",
  },
  applicationName: "Muses",
  description:
    "An open, workflow-native AI creation operating system.",
  icons: {
    icon: [
      {
        url: "/logo.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/logo-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    shortcut: ["/logo.svg"],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "Muses",
    description:
      "An open, workflow-native AI creation operating system.",
    siteName: "Muses",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Muses",
    description:
      "An open, workflow-native AI creation operating system.",
  },
  other: {
    "anss:canonical-service-root": "/",
    "anss:agent-service-guide": "/agent-guide.md",
    "anss:service-manifest": "/.well-known/anss.json",
    "anss:service-map": "/anss/saas.service-map.yaml",
    "anss:llms": "/llms.txt",
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getRequestLocale()

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className="font-sans antialiased"
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider locale={locale}>
            <TooltipProvider>
              <AnalyticsTracker />
              {children}
            </TooltipProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
