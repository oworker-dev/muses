"use client"

import { AlertCircleIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  AGENT_EMBED_CONTRACT_VERSION,
  parseAgentEmbedEvent,
  type AgentEmbedConfigureMessage,
} from "@oworker/open-agent-contracts/embed"
import {
  getWorkflowAgentProfile,
  hostCapabilitiesForWorkflowAgent,
} from "@/lib/agent-profile-catalog"

type HostTokenResponse = {
  readonly accessToken?: string
  readonly embedUrl?: string
  readonly expiresAt?: string
  readonly message?: string
  readonly serviceUrl?: string
  readonly scope?: { readonly projectId: string; readonly canvasId: string }
  readonly runtimeConfig?: import("@oworker/open-agent-contracts/runtime-config").AgentRuntimeConfigSnapshot
}

type Bootstrap = Required<
  Pick<
    HostTokenResponse,
    "accessToken" | "embedUrl" | "expiresAt" | "serviceUrl" | "scope" | "runtimeConfig"
  >
>

const PROFILE = getWorkflowAgentProfile("muses-platform", "0.1.0")!

export function StudioAgentPanel({
  workspaceId,
  projectId,
  canvasId,
  onHostChanged,
}: {
  readonly workspaceId: string
  readonly projectId: string
  readonly canvasId: string
  readonly onHostChanged?: () => void | Promise<void>
}) {
  const t = useTranslations("Studio.agent")
  const locale = useLocale() === "zh-CN" ? "zh-CN" : "en"
  const { resolvedTheme } = useTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const [bootstrap, setBootstrap] = useState<Bootstrap>()
  const [configuredRequestId, setConfiguredRequestId] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

  const loadToken = useCallback(async () => {
    setError(undefined)
    const query = new URLSearchParams({ workspaceId, projectId, canvasId })
    const response = await fetch(`/api/studio/agent-host-token?${query}`, {
      cache: "no-store",
    })
    const body = (await response.json().catch(() => ({}))) as HostTokenResponse
    if (
      !response.ok ||
      !body.accessToken ||
      !body.embedUrl ||
      !body.expiresAt ||
      !body.serviceUrl ||
      !body.scope
    ) {
      throw new Error(body.message || t("requestFailed"))
    }
    const next = body as Bootstrap
    setBootstrap(next)
    setLoading(false)
    return next
  }, [canvasId, projectId, t, workspaceId])

  useEffect(() => {
    let disposed = false
    let refreshTimer: number | undefined
    const refresh = async () => {
      try {
        const next = await loadToken()
        if (disposed) return
        const refreshIn = Math.max(
          15_000,
          Date.parse(next.expiresAt) - Date.now() - 60_000,
        )
        refreshTimer = window.setTimeout(refresh, refreshIn)
      } catch (reason) {
        if (!disposed) {
          setLoading(false)
          setError(reason instanceof Error ? reason.message : t("requestFailed"))
        }
      }
    }
    void refresh()
    return () => {
      disposed = true
      if (refreshTimer) window.clearTimeout(refreshTimer)
    }
  }, [loadToken, t])

  const configuration = useMemo<AgentEmbedConfigureMessage | undefined>(() => {
    if (!bootstrap) return undefined
    return {
      type: "agent.embed.configure",
      contractVersion: AGENT_EMBED_CONTRACT_VERSION,
      requestId: crypto.randomUUID(),
      accessToken: bootstrap.accessToken,
      expiresAt: bootstrap.expiresAt,
      serviceUrl: bootstrap.serviceUrl,
      storageKey: `muses:${workspaceId}:${projectId}:threads:v1`,
      profile: { id: PROFILE.profileId, version: PROFILE.profileVersion },
      runtimeConfig: bootstrap.runtimeConfig,
      runPolicy: {
        hostCapabilities: hostCapabilitiesForWorkflowAgent(PROFILE),
        limits: PROFILE.budget,
      },
      clientContext: {
        host: "muses",
        workspaceId,
        projectId: bootstrap.scope.projectId,
        canvasId: bootstrap.scope.canvasId,
      },
      locale,
      theme:
        resolvedTheme === "dark"
          ? "dark"
          : resolvedTheme === "light"
            ? "light"
            : "system",
    }
  }, [bootstrap, locale, projectId, resolvedTheme, workspaceId])
  const isConfigured =
    Boolean(configuration) && configuredRequestId === configuration?.requestId

  const sendConfiguration = useCallback(() => {
    if (!configuration || !bootstrap || !readyRef.current) return
    iframeRef.current?.contentWindow?.postMessage(
      configuration,
      new URL(bootstrap.embedUrl).origin,
    )
  }, [bootstrap, configuration])

  useEffect(() => {
    sendConfiguration()
  }, [sendConfiguration])

  useEffect(() => {
    if (!bootstrap || !configuration || isConfigured || error) return
    const timer = window.setTimeout(() => {
      setError(t("connectionTimeout"))
    }, 15_000)
    return () => window.clearTimeout(timer)
  }, [bootstrap, configuration, error, isConfigured, t])

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (!bootstrap || event.source !== iframeRef.current?.contentWindow) return
      if (event.origin !== new URL(bootstrap.embedUrl).origin) return
      const message = parseAgentEmbedEvent(event.data)
      if (!message) return
      if (message.type === "agent.embed.ready") {
        readyRef.current = true
        sendConfiguration()
        return
      }
      if (message.type === "agent.embed.configured") {
        setConfiguredRequestId(message.requestId)
        setError(undefined)
        return
      }
      if (message.type === "agent.embed.error") {
        setError(message.message)
        return
      }
      if (
        message.type === "agent.embed.host-capability-completed" &&
        (message.capability.startsWith("canvas.") ||
          message.capability.startsWith("workflow.") ||
          message.capability === "image.generate")
      ) {
        void onHostChanged?.()
      }
    }
    window.addEventListener("message", receive)
    return () => window.removeEventListener("message", receive)
  }, [bootstrap, onHostChanged, sendConfiguration])

  return (
    <aside
      data-testid="studio-agent-panel"
      className="relative flex h-full w-[480px] shrink-0 flex-col overflow-hidden border-l border-border bg-background"
    >
      {bootstrap ? (
        <iframe
          ref={iframeRef}
          src={bootstrap.embedUrl}
          title={t("title")}
          className="h-full w-full border-0 bg-background"
          onLoad={() => {
            readyRef.current = false
            setConfiguredRequestId(undefined)
          }}
          sandbox="allow-forms allow-same-origin allow-scripts"
        />
      ) : null}
      {loading ? (
        <div className="absolute inset-0 grid place-items-center bg-background text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <LoaderCircleIcon className="size-4 animate-spin" />
            {t("connecting")}
          </span>
        </div>
      ) : null}
      {bootstrap && !isConfigured && !error ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center bg-background/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          <LoaderCircleIcon className="mr-2 size-3.5 animate-spin" />
          {t("connecting")}
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-background/95 p-6 backdrop-blur-sm">
          <div className="max-w-sm rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="flex gap-2">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">{t("unavailable")}</p>
                <p className="mt-1 break-words text-muted-foreground">{error}</p>
              </div>
            </div>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 font-medium text-foreground hover:bg-muted"
              onClick={() => {
                setLoading(true)
                setBootstrap(undefined)
                setConfiguredRequestId(undefined)
                readyRef.current = false
                void loadToken().catch((reason: unknown) => {
                  setLoading(false)
                  setError(
                    reason instanceof Error ? reason.message : t("requestFailed"),
                  )
                })
              }}
            >
              <RotateCwIcon className="size-3.5" />
              {t("retry")}
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
