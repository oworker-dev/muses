"use client"

import {
  BanIcon,
  CheckIcon,
  CircleStopIcon,
  LoaderCircleIcon,
  ListChecksIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import type {
  AgentEvent,
  AgentMessage,
  AgentRunSnapshot,
} from "@muses/agent-core"
import type { WorkflowRuntimeImageAsset } from "@muses/domain"

import type { AgentDelegationActivityProjection } from "@/lib/agent-delegation-activity"
import { cn } from "@/lib/utils"
import { createClientId } from "@/lib/client-id"

type AgentRunResponse = {
  run: AgentRunSnapshot
  events?: AgentEvent[]
  driver?: { status?: string; runId?: string | null }
  accepted?: boolean
  error?: string
  message?: string
  cancellation?: {
    idempotentReplay: boolean
    summary: { reviewRequired?: boolean }
  }
  delegation?: AgentDelegationActivityProjection
  delegationCancellation?: {
    delegationRunId: string
    status: string
    idempotentReplay: boolean
  }
}

type ImageToolOutput = {
  workflowRunId?: string
  assets?: WorkflowRuntimeImageAsset[]
}

const subscribeToHydration = () => () => undefined

export function StudioAgentPanel({
  workspaceId,
  projectId,
  onCanvasChanged,
}: {
  workspaceId: string
  projectId: string
  onCanvasChanged?: () => void | Promise<void>
}) {
  const t = useTranslations("Studio.agent")
  const storageKey = `muses.agent.last-run.${workspaceId}.${projectId}`
  const [prompt, setPrompt] = useState("")
  const [run, setRun] = useState<AgentRunSnapshot | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [delegation, setDelegation] =
    useState<AgentDelegationActivityProjection | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const interactive = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  )

  const readRun = useCallback(
    async (runId: string) => {
      const query = new URLSearchParams({ workspaceId, runId })
      const response = await fetch(`/api/studio/agent-runs?${query}`)
      const result = (await response.json()) as AgentRunResponse
      if (!response.ok) throw new Error(result.message || t("requestFailed"))
      setRun(result.run)
      setEvents(result.events || [])
      setDelegation(result.delegation || null)
      if (isTerminal(result.run.status) && !result.delegation?.active) {
        void onCanvasChanged?.()
      }
      return result.run
    },
    [onCanvasChanged, t, workspaceId]
  )

  useEffect(() => {
    const runId = window.localStorage.getItem(storageKey)
    if (!runId) return
    const timer = window.setTimeout(() => {
      void readRun(runId).catch(() =>
        window.localStorage.removeItem(storageKey)
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [readRun, storageKey])

  useEffect(() => {
    if (!run || (isSettled(run.status) && !delegation?.active)) return
    const timer = window.setInterval(() => {
      void readRun(run.runId).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : t("requestFailed"))
      })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [delegation?.active, readRun, run, t])

  const submit = useCallback(async () => {
    const content = prompt.trim()
    if (!content || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/studio/agent-runs", {
        method: run ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          run
            ? {
                action: isSettled(run.status) ? "follow-up" : "steer",
                workspaceId,
                runId: run.runId,
                message: content,
              }
            : {
                workspaceId,
                projectId,
                prompt: content,
                idempotencyKey: createClientId(),
              }
        ),
      })
      const result = (await response.json()) as AgentRunResponse
      if (!response.ok || !result.run) {
        throw new Error(result.message || t("requestFailed"))
      }
      setRun(result.run)
      setEvents([])
      setDelegation(null)
      setPrompt("")
      window.localStorage.setItem(storageKey, result.run.runId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("requestFailed"))
    } finally {
      setSubmitting(false)
    }
  }, [projectId, prompt, run, storageKey, submitting, t, workspaceId])

  const cancel = useCallback(async () => {
    if (!run || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/studio/agent-runs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          workspaceId,
          runId: run.runId,
          idempotencyKey: `${run.runId}:studio-cancel:v1`,
          reason: "Cancelled from Muses Studio.",
        }),
      })
      const result = (await response.json()) as AgentRunResponse
      if (!response.ok || !result.run) {
        throw new Error(result.message || t("requestFailed"))
      }
      setRun(result.run)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("requestFailed"))
    } finally {
      setSubmitting(false)
    }
  }, [run, submitting, t, workspaceId])

  const decideApproval = useCallback(
    async (decision: "approved" | "denied") => {
      if (!run?.pendingApproval || submitting) return
      setSubmitting(true)
      setError(null)
      try {
        const response = await fetch("/api/studio/agent-runs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            workspaceId,
            runId: run.runId,
            approvalId: run.pendingApproval.approvalId,
            decision,
            reason:
              decision === "approved"
                ? "Approved from Muses Studio."
                : "Denied from Muses Studio.",
          }),
        })
        const result = (await response.json()) as AgentRunResponse
        if (!response.ok || !result.run) {
          throw new Error(result.message || t("requestFailed"))
        }
        setRun(result.run)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("requestFailed"))
      } finally {
        setSubmitting(false)
      }
    },
    [run, submitting, t, workspaceId]
  )

  const decideDelegatedApproval = useCallback(
    async (
      approval: AgentDelegationActivityProjection["approvals"][number],
      decision: "approved" | "denied"
    ) => {
      if (!run || submitting) return
      setSubmitting(true)
      setError(null)
      try {
        const response = await fetch("/api/studio/agent-runs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            workspaceId,
            runId: approval.runId,
            approvalId: approval.approvalId,
            decision,
            reason:
              decision === "approved"
                ? "Approved delegated work from Muses Studio."
                : "Denied delegated work from Muses Studio.",
          }),
        })
        const result = (await response.json()) as AgentRunResponse
        if (!response.ok || !result.run) {
          throw new Error(result.message || t("requestFailed"))
        }
        await readRun(run.runId)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("requestFailed"))
      } finally {
        setSubmitting(false)
      }
    },
    [readRun, run, submitting, t, workspaceId]
  )

  const cancelDelegation = useCallback(
    async (delegationRunId: string) => {
      if (!run || submitting) return
      setSubmitting(true)
      setError(null)
      try {
        const response = await fetch("/api/studio/agent-runs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "cancel-delegation",
            workspaceId,
            runId: run.runId,
            delegationRunId,
            idempotencyKey: `${run.runId}:${delegationRunId}:studio-cancel:v1`,
            reason: "Cancelled specialist work from Muses Studio.",
          }),
        })
        const result = (await response.json()) as AgentRunResponse
        if (!response.ok || !result.run) {
          throw new Error(result.message || t("requestFailed"))
        }
        await readRun(run.runId)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("requestFailed"))
      } finally {
        setSubmitting(false)
      }
    },
    [readRun, run, submitting, t, workspaceId]
  )

  const latestAssistant = useMemo(
    () =>
      [...(run?.context.messages || [])]
        .reverse()
        .find(
          (message) => message.role === "assistant" && message.content.trim()
        ),
    [run]
  )
  const imageOutput = useMemo(
    () => findLatestImageOutput(run?.context.messages || []),
    [run]
  )
  const stages = agentStages(run, events)
  const running = Boolean(run && !isTerminal(run.status))
  const delegationBusy = Boolean(delegation?.active)
  const delegatedTaskCount =
    delegation?.runs.reduce((count, item) => count + item.tasks.length, 0) || 0
  const delegatedArtifactCount =
    delegation?.runs.reduce(
      (count, item) =>
        count +
        item.tasks.reduce(
          (taskCount, task) => taskCount + task.artifactRefs.length,
          0
        ),
      0
    ) || 0

  return (
    <aside
      data-testid="studio-agent-panel"
      className="absolute bottom-16 left-3 z-20 flex max-h-[min(680px,calc(100%-92px))] w-[min(380px,calc(100%-24px))] flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background">
            <SparklesIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-foreground">
              {t("title")}
            </div>
            <div className="truncate text-[9px] text-muted-foreground">
              {delegation?.approvals.length
                ? t("waiting")
                : delegationBusy
                  ? t("delegation.running")
                  : run
                    ? statusLabel(run.status, t)
                    : t("ready")}
            </div>
          </div>
        </div>
        {running ? (
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={submitting}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label={t("cancel")}
            title={t("cancel")}
          >
            <CircleStopIcon className="size-3.5" />
          </button>
        ) : null}
      </div>

      {run ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {stages.map((stage) => (
              <div
                key={stage.key}
                className={cn(
                  "flex min-h-12 items-center gap-1.5 rounded-md border px-2 py-1.5",
                  stage.state === "done"
                    ? "border-emerald-500/25 bg-emerald-500/5"
                    : stage.state === "active"
                      ? "border-foreground/20 bg-muted"
                      : "border-border bg-background"
                )}
              >
                {stage.state === "done" ? (
                  <CheckIcon className="size-3 shrink-0 text-emerald-600" />
                ) : stage.state === "active" ? (
                  <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
                ) : (
                  <span className="size-3 shrink-0 rounded-full border border-border" />
                )}
                <span className="text-[9px] font-medium text-foreground">
                  {t(`stages.${stage.key}`)}
                </span>
              </div>
            ))}
          </div>

          {run.plan ? (
            <details
              className="mt-2.5 rounded-md border border-border bg-muted/20"
              data-testid="studio-agent-plan"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2.5 py-2 text-[9px] font-medium text-foreground">
                <span className="flex items-center gap-1.5">
                  <ListChecksIcon className="size-3.5 text-muted-foreground" />
                  {t("plan")}
                </span>
                <span className="text-muted-foreground">
                  {t("planProgress", {
                    completed: run.plan.steps.filter(
                      ({ status }) => status === "completed"
                    ).length,
                    total: run.plan.steps.length,
                  })}
                </span>
              </summary>
              <div className="border-t border-border px-2.5 py-2">
                <p className="line-clamp-2 text-[9px] leading-4 text-muted-foreground">
                  {run.plan.goal}
                </p>
                <ol className="mt-1.5 grid gap-1.5">
                  {run.plan.steps.map((step) => (
                    <li
                      key={step.id}
                      className="flex min-h-5 items-center gap-2 text-[9px] text-foreground"
                    >
                      {step.status === "completed" ? (
                        <CheckIcon className="size-3 shrink-0 text-emerald-600" />
                      ) : step.status === "in-progress" ? (
                        <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
                      ) : (
                        <span className="size-3 shrink-0 rounded-full border border-border" />
                      )}
                      <span>{planStepLabel(step.id, step.title, t)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          ) : null}

          {delegation?.runs.length ? (
            <section
              className="mt-3 border-y border-border py-2.5"
              data-testid="studio-agent-delegation"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold text-foreground">
                  {t("delegation.title")}
                </p>
                <span className="text-[9px] text-muted-foreground">
                  {t("delegation.taskCount", { count: delegatedTaskCount })}
                  {delegatedArtifactCount
                    ? ` · ${t("delegation.artifactCount", { count: delegatedArtifactCount })}`
                    : ""}
                </span>
              </div>
              <ol className="mt-2 grid">
                {delegation.runs.map((item) => (
                  <li
                    key={item.delegationRunId}
                    className="border-t border-border py-2 first:border-t-0 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-h-6 items-center justify-between gap-3">
                      <span className="text-[8px] font-medium text-muted-foreground">
                        {delegationStatusLabel(item.status, t)}
                      </span>
                      {isDelegationRunCancellable(item.status) ? (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            void cancelDelegation(item.delegationRunId)
                          }
                          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          aria-label={t("delegation.cancel")}
                          title={t("delegation.cancel")}
                          data-testid="studio-agent-delegation-cancel"
                        >
                          <CircleStopIcon className="size-3" />
                        </button>
                      ) : null}
                    </div>
                    <ol className="grid gap-2">
                      {item.tasks.map((task) => (
                        <li
                          key={`${item.delegationRunId}:${task.taskId}`}
                          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5"
                        >
                          {task.status === "completed" ? (
                            <CheckIcon className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                          ) : isDelegationTaskActive(task.status) ? (
                            <LoaderCircleIcon className="mt-0.5 size-3 shrink-0 animate-spin" />
                          ) : (
                            <span className="mt-0.5 size-3 shrink-0 rounded-full border border-border" />
                          )}
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-[9px] leading-4 text-foreground">
                              {task.objective}
                            </p>
                            <p className="text-[8px] leading-3 text-muted-foreground">
                              {task.profile.profileId} ·{" "}
                              {delegationStatusLabel(task.status, t)}
                              {task.artifactRefs.length
                                ? ` · ${t("delegation.artifactCount", { count: task.artifactRefs.length })}`
                                : ""}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {run.status === "waiting-approval" && run.pendingApproval ? (
            <section
              className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5"
              data-testid="studio-agent-approval"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-foreground">
                    {t("approval.title")}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
                    {run.pendingApproval.reason}
                  </p>
                </div>
                <span className="shrink-0 rounded border border-amber-500/30 bg-background px-1.5 py-0.5 font-mono text-[8px] text-foreground">
                  {run.pendingApproval.toolCall.name}
                </span>
              </div>
              <details className="mt-2 rounded border border-border bg-background/70">
                <summary className="cursor-pointer list-none px-2 py-1.5 text-[9px] font-medium text-muted-foreground">
                  {t("approval.input")}
                </summary>
                <pre className="max-h-32 overflow-auto border-t border-border px-2 py-1.5 font-mono text-[8px] leading-4 whitespace-pre-wrap text-foreground">
                  {formatApprovalInput(run.pendingApproval.toolCall.input)}
                </pre>
              </details>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void decideApproval("denied")}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[9px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <BanIcon className="size-3" />
                  {t("approval.deny")}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void decideApproval("approved")}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[9px] font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  <CheckIcon className="size-3" />
                  {t("approval.approve")}
                </button>
              </div>
            </section>
          ) : null}

          {delegation?.approvals.map((approval) => (
            <section
              key={approval.approvalId}
              className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5"
              data-testid="studio-agent-delegated-approval"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-foreground">
                    {t("delegation.approvalTitle")}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
                    {approval.reason}
                  </p>
                </div>
                <span className="shrink-0 rounded border border-amber-500/30 bg-background px-1.5 py-0.5 font-mono text-[8px] text-foreground">
                  {approval.toolCall.name}
                </span>
              </div>
              <details className="mt-2 rounded border border-border bg-background/70">
                <summary className="cursor-pointer list-none px-2 py-1.5 text-[9px] font-medium text-muted-foreground">
                  {t("approval.input")}
                </summary>
                <pre className="max-h-32 overflow-auto border-t border-border px-2 py-1.5 font-mono text-[8px] leading-4 whitespace-pre-wrap text-foreground">
                  {formatApprovalInput(approval.toolCall.input)}
                </pre>
              </details>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    void decideDelegatedApproval(approval, "denied")
                  }
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[9px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <BanIcon className="size-3" />
                  {t("approval.deny")}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    void decideDelegatedApproval(approval, "approved")
                  }
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[9px] font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  <CheckIcon className="size-3" />
                  {t("approval.approve")}
                </button>
              </div>
            </section>
          ))}

          {imageOutput?.assets?.length ? (
            <div className="mt-3 grid gap-2">
              {imageOutput.assets.map((asset) => (
                <figure
                  key={asset.id}
                  className="overflow-hidden rounded-md border border-border bg-muted/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt={asset.prompt}
                    className="max-h-[360px] w-full object-contain"
                  />
                  <figcaption className="flex items-center justify-between gap-3 px-2.5 py-2 text-[9px] text-muted-foreground">
                    <span className="truncate">{asset.prompt}</span>
                    <span className="shrink-0">
                      {asset.width} x {asset.height}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}

          {latestAssistant ? (
            <p className="mt-3 text-[10px] leading-4 whitespace-pre-wrap text-foreground">
              {latestAssistant.content}
            </p>
          ) : null}
          {run.failure ? (
            <p className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-[9px] leading-4 text-destructive">
              {run.failure.code === "model-failed"
                ? t("modelFailed")
                : run.failure.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        className="border-t border-border bg-background p-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex items-end gap-2 rounded-md border border-input bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
          <textarea
            value={prompt}
            disabled={!interactive || delegationBusy}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={run ? t("followUpPlaceholder") : t("placeholder")}
            rows={2}
            className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-[11px] leading-4 outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <button
            type="submit"
            disabled={
              !interactive || delegationBusy || !prompt.trim() || submitting
            }
            className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={t("send")}
            title={t("send")}
          >
            {submitting ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <SendIcon className="size-3.5" />
            )}
          </button>
        </div>
        {error ? (
          <p className="mt-1.5 text-[9px] leading-4 text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </aside>
  )
}

function findLatestImageOutput(messages: readonly AgentMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool" || message.toolName !== "image.generate")
      continue
    try {
      const output = JSON.parse(message.content) as ImageToolOutput
      if (Array.isArray(output.assets)) return output
    } catch {
      continue
    }
  }
  return null
}

function formatApprovalInput(input: Readonly<Record<string, unknown>>) {
  const formatted = JSON.stringify(input, null, 2)
  return formatted.length > 4_000
    ? `${formatted.slice(0, 4_000)}\n…`
    : formatted
}

function agentStages(
  run: AgentRunSnapshot | null,
  events: readonly AgentEvent[]
) {
  const eventTypes = new Set(events.map(({ type }) => type))
  const imageRequested = events.some(
    (event) =>
      event.type === "tool.started" && event.data.toolName === "image.generate"
  )
  const imageCompleted = events.some(
    (event) =>
      event.type === "tool.completed" &&
      event.data.toolName === "image.generate"
  )
  const completed = run?.status === "completed"
  return [
    {
      key: "understand" as const,
      state: eventTypes.has("model.completed")
        ? "done"
        : run
          ? "active"
          : "idle",
    },
    {
      key: "create" as const,
      state: imageCompleted ? "done" : imageRequested ? "active" : "idle",
    },
    {
      key: "place" as const,
      state: completed ? "done" : imageCompleted ? "active" : "idle",
    },
  ] as const
}

function isSettled(status: AgentRunSnapshot["status"]) {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "waiting-approval" ||
    status === "waiting-input"
  )
}

function isTerminal(status: AgentRunSnapshot["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function isDelegationTaskActive(status: string) {
  return (
    status === "ready" ||
    status === "claimed" ||
    status === "running" ||
    status === "waiting-approval"
  )
}

function isDelegationRunCancellable(status: string) {
  return status === "queued" || status === "running"
}

function delegationStatusLabel(
  status: string,
  t: ReturnType<typeof useTranslations<"Studio.agent">>
) {
  if (status === "pending") return t("delegation.status.pending")
  if (status === "ready") return t("delegation.status.ready")
  if (status === "claimed") return t("delegation.status.claimed")
  if (status === "running") return t("delegation.status.running")
  if (status === "cancelling") return t("delegation.status.cancelling")
  if (status === "waiting-approval") {
    return t("delegation.status.waitingApproval")
  }
  if (status === "completed") return t("delegation.status.completed")
  if (status === "completed-with-failures") {
    return t("delegation.status.completedWithFailures")
  }
  if (status === "failed") return t("delegation.status.failed")
  if (status === "cancelled") return t("delegation.status.cancelled")
  if (status === "blocked") return t("delegation.status.blocked")
  return status
}

function planStepLabel(
  id: string,
  fallback: string,
  t: ReturnType<typeof useTranslations<"Studio.agent">>
) {
  if (id === "understand-request") return t("planSteps.understand")
  if (id === "generate-image") return t("planSteps.generate")
  if (id === "place-result") return t("planSteps.place")
  return fallback
}

function statusLabel(
  status: AgentRunSnapshot["status"],
  t: ReturnType<typeof useTranslations<"Studio.agent">>
) {
  if (status === "completed") return t("completed")
  if (status === "failed") return t("failed")
  if (status === "cancelled") return t("cancelled")
  if (status === "waiting-approval" || status === "waiting-input") {
    return t("waiting")
  }
  return t("running")
}
