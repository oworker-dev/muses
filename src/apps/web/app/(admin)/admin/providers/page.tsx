import { createTranslator } from "next-intl"

import { AdminPageHeader } from "@/components/admin-dashboard-widgets"
import { ProviderConnectionManager } from "@/components/provider-connection-manager"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { getAdminProviderControlPlane } from "@/lib/provider-connections"

export default async function AdminProvidersPage() {
  const [controlPlane, locale] = await Promise.all([
    getAdminProviderControlPlane(),
    getRequestLocale(),
  ])
  const t = createTranslator({
    locale,
    messages: getMessages(locale),
    namespace: "AdminProviders",
  })

  return (
    <>
      <AdminPageHeader title={t("title")} description={t("description")} />
      <ProviderConnectionManager controlPlane={controlPlane} locale={locale} />
    </>
  )
}
