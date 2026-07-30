"use client"

import { useActionState, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  ActivityIcon,
  KeyRoundIcon,
  PowerIcon,
  PowerOffIcon,
  RefreshCwIcon,
  SaveIcon,
} from "lucide-react"

import {
  INITIAL_PROVIDER_ACTION_STATE,
  checkProviderConnectionHealthAction,
  createProviderConnectionAction,
  rotateProviderCredentialAction,
  updateProviderConnectionOfferingsAction,
  updateProviderConnectionStatusAction,
} from "@/app/(admin)/admin/providers/actions"
import { AdminPanel, CountBadge } from "@/components/admin-dashboard-widgets"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import type {
  AdminProviderConnection,
  AdminProviderControlPlane,
  ProviderCapabilityFamily,
} from "@/lib/provider-connections"

export function ProviderConnectionManager({
  controlPlane,
  locale,
}: {
  controlPlane: AdminProviderControlPlane
  locale: string
}) {
  const t = useTranslations("AdminProviders")
  const [createState, createAction, createPending] = useActionState(
    createProviderConnectionAction,
    INITIAL_PROVIDER_ACTION_STATE
  )
  const createForm = useRef<HTMLFormElement>(null)
  const [selectedProviderId, setSelectedProviderId] = useState("")
  useEffect(() => {
    if (createState.status === "success") createForm.current?.reset()
  }, [createState])

  return (
    <div className="grid gap-6">
      {!controlPlane.vaultConfigured ? (
        <Alert variant="destructive">
          <KeyRoundIcon />
          <AlertTitle>{t("vaultUnavailableTitle")}</AlertTitle>
          <AlertDescription>
            {t("vaultUnavailableDescription")}
          </AlertDescription>
        </Alert>
      ) : null}

      <AdminPanel title={t("createTitle")} description={t("createDescription")}>
        <form ref={createForm} action={createAction} className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("provider")}>
              <NativeSelect
                name="providerId"
                required
                value={selectedProviderId}
                onChange={(event) => setSelectedProviderId(event.target.value)}
                className="w-full"
              >
                <option value="" disabled>
                  {t("chooseProvider")}
                </option>
                {controlPlane.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("connectionName")}>
              <Input name="name" required minLength={2} maxLength={80} />
            </Field>
            <Field label={t("baseUrl")} hint={t("baseUrlHint")}>
              <Input
                name="baseUrl"
                type="url"
                placeholder="https://api.example.com/v1"
              />
            </Field>
            <Field label={t("credential")} hint={t("credentialHint")}>
              <Input
                name="credential"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">{t("capabilities")}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {CAPABILITIES.map((capability) => (
                <label
                  key={capability}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    name="capabilities"
                    value={capability}
                    defaultChecked={capability === "image"}
                  />
                  {t(`capability.${capability}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <Field label={t("modelAllowlist")} hint={t("modelAllowlistHint")}>
            <Input
              name="modelAllowlist"
              placeholder="gpt-5.6-sol, gpt-image-2"
            />
          </Field>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">
              {t("offeringBindings")}
            </legend>
            <p className="text-xs text-muted-foreground">
              {t("offeringBindingsHint")}
            </p>
            <OfferingCheckboxes
              offerings={controlPlane.offerings.filter(
                (offering) => offering.providerId === selectedProviderId
              )}
            />
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={createPending || !controlPlane.vaultConfigured}
            >
              <KeyRoundIcon />
              {createPending ? t("saving") : t("create")}
            </Button>
            <ActionFeedback state={createState} />
          </div>
        </form>
      </AdminPanel>

      <AdminPanel
        title={t("connectionsTitle")}
        description={t("connectionsDescription")}
        action={
          <CountBadge>
            {t("connectionCount", { count: controlPlane.connections.length })}
          </CountBadge>
        }
      >
        {controlPlane.connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {controlPlane.connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                offerings={controlPlane.offerings.filter(
                  (offering) => offering.providerId === connection.providerId
                )}
                locale={locale}
                vaultConfigured={controlPlane.vaultConfigured}
              />
            ))}
          </div>
        )}
      </AdminPanel>
    </div>
  )
}

function ConnectionRow({
  connection,
  offerings,
  locale,
  vaultConfigured,
}: {
  connection: AdminProviderConnection
  offerings: AdminProviderControlPlane["offerings"]
  locale: string
  vaultConfigured: boolean
}) {
  const t = useTranslations("AdminProviders")
  const [statusState, statusAction, statusPending] = useActionState(
    updateProviderConnectionStatusAction,
    INITIAL_PROVIDER_ACTION_STATE
  )
  const [healthState, healthAction, healthPending] = useActionState(
    checkProviderConnectionHealthAction,
    INITIAL_PROVIDER_ACTION_STATE
  )
  const [bindingState, bindingAction, bindingPending] = useActionState(
    updateProviderConnectionOfferingsAction,
    INITIAL_PROVIDER_ACTION_STATE
  )
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotateProviderCredentialAction,
    INITIAL_PROVIDER_ACTION_STATE
  )
  const rotationForm = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (rotateState.status === "success") rotationForm.current?.reset()
  }, [rotateState])
  const healthByCapability = useMemo(
    () => new Map(connection.health.map((item) => [item.capability, item])),
    [connection.health]
  )

  return (
    <section className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,1.25fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{connection.name}</h2>
              <StatusBadge
                tone={connection.status === "active" ? "ok" : "neutral"}
              >
                {connection.status === "active" ? t("active") : t("disabled")}
              </StatusBadge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {connection.providerDisplayName}
            </p>
            <code className="mt-2 block text-xs break-all text-muted-foreground">
              {connection.baseUrl || t("providerDefaultEndpoint")}
            </code>
          </div>
          <form action={statusAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <input
              type="hidden"
              name="status"
              value={connection.status === "active" ? "disabled" : "active"}
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={statusPending}
            >
              {connection.status === "active" ? (
                <PowerOffIcon />
              ) : (
                <PowerIcon />
              )}
              {connection.status === "active" ? t("disable") : t("enable")}
            </Button>
          </form>
        </div>

        <div className="grid gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">
              {t("credentialLabel")}:{" "}
            </span>
            {connection.credential
              ? `•••• ${connection.credential.secretHint}`
              : t("credentialMissing")}
          </p>
          <p>
            <span className="text-muted-foreground">
              {t("credentialUpdated")}:{" "}
            </span>
            {connection.credential
              ? new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(connection.credential.createdAt))
              : t("notAvailable")}
          </p>
          <div className="flex flex-wrap gap-2">
            {connection.capabilities.map((capability) => {
              const health = healthByCapability.get(capability)
              return (
                <StatusBadge
                  key={capability}
                  tone={healthTone(health?.status || "unknown")}
                >
                  {t(`capability.${capability}`)} ·{" "}
                  {t(`health.${health?.status || "unknown"}`)}
                </StatusBadge>
              )
            })}
          </div>
        </div>

        <form
          action={healthAction}
          className="flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="connectionId" value={connection.id} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={healthPending || !vaultConfigured}
          >
            <ActivityIcon />
            {healthPending ? t("checking") : t("checkHealth")}
          </Button>
          <ActionFeedback state={healthState} />
          <ActionFeedback state={statusState} />
        </form>
      </div>

      <div className="grid gap-5 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
        <form action={bindingAction} className="grid gap-3">
          <input type="hidden" name="connectionId" value={connection.id} />
          <div>
            <h3 className="text-sm font-medium">{t("offeringBindings")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("offeringBindingsHint")}
            </p>
          </div>
          <OfferingCheckboxes
            offerings={offerings}
            selected={connection.offeringIds}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={bindingPending}
            >
              <SaveIcon />
              {bindingPending ? t("saving") : t("saveBindings")}
            </Button>
            <ActionFeedback state={bindingState} />
          </div>
        </form>

        <form
          ref={rotationForm}
          action={rotateAction}
          className="grid gap-3 border-t pt-5"
        >
          <input type="hidden" name="connectionId" value={connection.id} />
          <Field label={t("rotateCredential")} hint={t("rotateCredentialHint")}>
            <Input
              name="credential"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={rotatePending || !vaultConfigured}
            >
              <RefreshCwIcon />
              {rotatePending ? t("rotating") : t("rotate")}
            </Button>
            <ActionFeedback state={rotateState} />
          </div>
        </form>
      </div>
    </section>
  )
}

function OfferingCheckboxes({
  offerings,
  selected = [],
}: {
  offerings: AdminProviderControlPlane["offerings"]
  selected?: string[]
}) {
  const t = useTranslations("AdminProviders")
  if (offerings.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noOfferings")}</p>
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {offerings.map((offering) => (
        <label key={offering.id} className="flex items-start gap-2 text-sm">
          <Checkbox
            name="offeringIds"
            value={offering.id}
            defaultChecked={selected.includes(offering.id)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block font-medium">{offering.displayName}</span>
            <span className="block text-xs break-all text-muted-foreground">
              {offering.modelRef}
            </span>
          </span>
        </label>
      ))}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <Label className="grid content-start gap-2">
      <span>{label}</span>
      {children}
      {hint ? (
        <span className="text-xs leading-5 font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </Label>
  )
}

function ActionFeedback({
  state,
}: {
  state: { status: string; code?: string }
}) {
  const t = useTranslations("AdminProviders")
  if (state.status === "idle") return null
  return (
    <span
      role="status"
      className={
        state.status === "success"
          ? "text-sm text-success-foreground"
          : "text-sm text-destructive"
      }
    >
      {t(`feedback.${state.code || "operation-failed"}`)}
    </span>
  )
}

function healthTone(status: string): "ok" | "warning" | "neutral" {
  if (status === "healthy") return "ok"
  if (status === "degraded") return "warning"
  if (status === "unavailable") return "warning"
  return "neutral"
}

const CAPABILITIES: ProviderCapabilityFamily[] = [
  "llm",
  "image",
  "video",
  "audio",
  "music",
]
