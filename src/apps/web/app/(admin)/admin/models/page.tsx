import { PowerIcon, PowerOffIcon } from "lucide-react"
import { createTranslator } from "next-intl"

import {
  AdminPageHeader,
  AdminPanel,
  CountBadge,
} from "@/components/admin-dashboard-widgets"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { getAdminModelOfferings } from "@/lib/model-catalog"

import { updateModelOfferingAvailability } from "./actions"

export default async function AdminModelsPage() {
  const [offerings, locale] = await Promise.all([
    getAdminModelOfferings(),
    getRequestLocale(),
  ])
  const t = createTranslator({
    locale,
    messages: getMessages(locale),
    namespace: "AdminModels",
  })

  return (
    <>
      <AdminPageHeader title={t("title")} description={t("description")} />

      <AdminPanel
        title={t("catalogTitle")}
        description={t("catalogDescription")}
        action={
          <CountBadge>
            {t("offeringCount", { count: offerings.length })}
          </CountBadge>
        }
      >
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.model")}</TableHead>
                <TableHead>{t("columns.lifecycle")}</TableHead>
                <TableHead>{t("columns.capability")}</TableHead>
                <TableHead>{t("columns.profile")}</TableHead>
                <TableHead>{t("columns.price")}</TableHead>
                <TableHead>{t("columns.availability")}</TableHead>
                <TableHead className="text-right">
                  {t("columns.action")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offerings.map((offering) => (
                <TableRow key={offering.id}>
                  <TableCell className="min-w-64 align-top">
                    <p className="font-medium">{offering.displayName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {offering.provider.displayName}
                    </p>
                    <code className="mt-2 block text-[11px] break-all text-muted-foreground">
                      {offering.modelRef}
                    </code>
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge
                      tone={
                        offering.lifecycleStatus === "published"
                          ? "ok"
                          : offering.lifecycleStatus === "deprecated"
                            ? "warning"
                            : "neutral"
                      }
                      className="capitalize"
                    >
                      {offering.lifecycleStatus}
                    </StatusBadge>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("specVersion", {
                        version: offering.specificationVersion,
                      })}
                    </p>
                  </TableCell>
                  <TableCell className="min-w-52 align-top text-xs">
                    <p className="font-medium">{offering.capability.id}</p>
                    <p className="mt-2 text-muted-foreground">
                      {offering.capability.specification.inputModes.join(", ")}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {offering.capability.specification.aspectRatios.join(
                        " · "
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="align-top text-xs">
                    <p>{offering.capability.profileVersion}</p>
                    <p className="mt-1 text-muted-foreground">
                      {t("outputCounts", {
                        counts:
                          offering.capability.specification.outputCounts.join(
                            ", "
                          ),
                      })}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {offering.capability.specification.parameters.quality.values.join(
                        " · "
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="min-w-44 align-top text-xs">
                    <p className="font-medium tabular-nums">
                      {t("creditsPerImage", {
                        credits: formatCredits(
                          offering.price.unitCreditMicros,
                          locale
                        ),
                      })}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {offering.price.priceBookVersion}
                    </p>
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge tone={offering.enabled ? "ok" : "neutral"}>
                      {offering.enabled ? t("enabled") : t("disabled")}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <form action={updateModelOfferingAvailability}>
                      <input
                        type="hidden"
                        name="offeringId"
                        value={offering.id}
                      />
                      <input
                        type="hidden"
                        name="enabled"
                        value={offering.enabled ? "false" : "true"}
                      />
                      <Button type="submit" size="sm" variant="outline">
                        {offering.enabled ? <PowerOffIcon /> : <PowerIcon />}
                        {offering.enabled ? t("disable") : t("enable")}
                      </Button>
                    </form>
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

function formatCredits(value: string, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    Number(value) / 1_000_000
  )
}
