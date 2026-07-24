"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

export function AnalyticsTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname) {
      return
    }

    const controller = new AbortController()
    const device = window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop"

    fetch("/api/analytics/event", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        eventName: "page_view",
        path: pathname,
        referrer: document.referrer || null,
        device,
      }),
      keepalive: true,
      signal: controller.signal,
    }).catch(() => {})

    return () => controller.abort()
  }, [pathname])

  return null
}
