"use client"

import type { Node, NodeProps } from "@xyflow/react"
import { Handle, Position } from "@xyflow/react"
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  FlagIcon,
  ImageIcon,
  Layers3Icon,
  LoaderCircleIcon,
  PlusIcon,
  PlayIcon,
  SparklesIcon,
  SplitIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { memo, useEffect, useState } from "react"

import type {
  AssetDraft,
  DesignDocumentDraft,
  PortSpec,
  WorkflowNodeDraft,
  WorkflowNodeKind,
} from "@muses/domain"

import { cn } from "@/lib/utils"

import { useStudioActions } from "./studio-actions"

export type CanvasInputBinding = {
  reference: string
  sourceNodeTitle: string
  sourcePortLabel: string
  valueType: string
}

export type CanvasNodeData = {
  domainNode: WorkflowNodeDraft
  asset?: AssetDraft
  designDocument?: DesignDocumentDraft
  inputBindings?: Record<string, CanvasInputBinding[]>
  modelDisplayName?: string
  runtime?: CanvasNodeRuntime
}

export type CanvasNodeRuntimeValue =
  | { portId: string; valueType: "text"; value: string; truncated: boolean }
  | { portId: string; valueType: "number"; value: number }
  | { portId: string; valueType: "boolean"; value: boolean }
  | { portId: string; valueType: "image"; count: number }
  | {
      portId: string
      valueType: "design-document"
      documentId: string
      revision: number
    }

export type CanvasNodeRuntime = {
  nodeId: string
  nodeKind: string
  status: "running" | "waiting" | "succeeded" | "failed" | "cancelled"
  startedAt?: string
  completedAt?: string
  durationMs?: number
  outputSummary: CanvasNodeRuntimeValue[]
  error?: { message: string }
}

export type MusesFlowNode = Node<CanvasNodeData, WorkflowNodeKind>

const kindMeta = {
  start: {
    icon: CircleDotIcon,
    copyKey: "start",
    tone: "bg-blue-500 text-white",
  },
  "image-generator": {
    icon: SparklesIcon,
    copyKey: "imageGenerator",
    tone: "bg-fuchsia-500 text-white",
  },
  "image-result": {
    icon: ImageIcon,
    copyKey: "imageResult",
    tone: "bg-amber-500 text-white",
  },
  selector: {
    icon: SplitIcon,
    copyKey: "selector",
    tone: "bg-cyan-500 text-white",
  },
  "design-document": {
    icon: Layers3Icon,
    copyKey: "designDocument",
    tone: "bg-rose-500 text-white",
  },
  end: {
    icon: FlagIcon,
    copyKey: "end",
    tone: "bg-emerald-500 text-white",
  },
} satisfies Record<
  WorkflowNodeKind,
  { icon: typeof CircleDotIcon; copyKey: string; tone: string }
>

export const WorkflowNodeCard = memo(function WorkflowNodeCard({
  data,
  selected,
}: NodeProps<MusesFlowNode>) {
  const t = useTranslations("Studio")
  const { domainNode: node } = data
  const runtimeDurationMs = useRuntimeDuration(data.runtime)

  if (node.data.kind === "image-result") {
    return <ImageResultCard data={data} selected={selected} />
  }

  const meta = kindMeta[node.kind]
  const Icon = meta.icon
  const title = getNodeTitle(node, t)
  const running = data.runtime?.status === "running"

  return (
    <div className="w-[360px]">
      <article
        data-testid={`workflow-node-${node.id}`}
        data-node-kind={node.kind}
        data-runtime-status={data.runtime?.status || "idle"}
        aria-busy={running}
        className={cn(
          "relative overflow-visible rounded-xl border bg-card text-card-foreground shadow-[0_8px_28px_rgba(15,23,42,0.08)] transition-[border-color,box-shadow] dark:shadow-[0_12px_34px_rgba(0,0,0,0.24)]",
          selected
            ? "border-violet-500 shadow-[0_10px_34px_rgba(124,58,237,0.13)] ring-2 ring-violet-500/10"
            : "border-border/95 hover:border-violet-500/45",
          running &&
            "border-violet-500 shadow-[0_12px_38px_rgba(124,58,237,0.2)] ring-2 ring-violet-500/20"
        )}
      >
        {running ? (
          <span className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 animate-pulse rounded-full bg-violet-500" />
        ) : null}
        <header className="flex items-center justify-between rounded-t-xl border-b border-border/75 bg-card px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md shadow-sm",
                meta.tone
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{title}</h2>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {t(`nodes.${meta.copyKey}.description`)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <NodeStatus
              node={node}
              runtime={data.runtime}
              durationMs={runtimeDurationMs}
            />
            <NodeHeaderAction node={node} runtime={data.runtime} />
          </div>
        </header>

        <NodeBody
          node={node}
          asset={data.asset}
          designDocument={data.designDocument}
          modelDisplayName={data.modelDisplayName}
        />

        <PortSections node={node} inputBindings={data.inputBindings} />
      </article>
      <NodeRuntimeCard runtime={data.runtime} durationMs={runtimeDurationMs} />
    </div>
  )
})

function ImageResultCard({
  data,
  selected,
}: {
  data: CanvasNodeData
  selected: boolean
}) {
  const t = useTranslations("Studio")
  const actions = useStudioActions()
  const node = data.domainNode
  if (node.data.kind !== "image-result") return null

  return (
    <article
      data-testid={`workflow-node-${node.id}`}
      data-node-kind={node.kind}
      className={cn(
        "relative w-[220px] overflow-hidden rounded-xl border bg-card shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-[border-color,box-shadow] dark:shadow-[0_12px_30px_rgba(0,0,0,0.22)]",
        selected || node.data.selected
          ? "border-amber-500 ring-2 ring-amber-500/10"
          : "border-border/95 hover:border-amber-500/55"
      )}
    >
      {node.outputPorts.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          title={`${port.label}: ${port.valueType}`}
          className="!right-[-7px] !size-3 !border-2 !border-card !bg-amber-500"
        />
      ))}
      <div className="relative aspect-video overflow-hidden bg-muted">
        {data.asset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.asset.dataUri}
            alt={node.data.variantLabel}
            className="size-full object-cover"
            draggable={false}
          />
        ) : null}
        <span className="absolute top-2 left-2 rounded-md bg-black/58 px-2 py-1 text-[12px] font-medium text-white backdrop-blur">
          {t("nodes.imageResult.kind")}
        </span>
        {node.data.selected ? (
          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-amber-400 text-amber-950 shadow-lg">
            <CheckIcon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">
            {node.data.variantLabel}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {t("nodes.assetMeta")}
          </p>
        </div>
        <button
          type="button"
          className={cn(
            "nodrag nopan shrink-0 rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
            node.data.selected
              ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
              : "border border-border bg-background hover:bg-accent"
          )}
          onClick={() => actions.selectResult(node.id)}
        >
          {node.data.selected ? t("nodes.selected") : t("nodes.choose")}
        </button>
      </div>
    </article>
  )
}

function NodeStatus({
  node,
  runtime,
  durationMs,
}: {
  node: WorkflowNodeDraft
  runtime?: CanvasNodeRuntime
  durationMs?: number
}) {
  const t = useTranslations("Studio")
  const status =
    runtime?.status ||
    (node.data.kind === "image-generator" ? node.data.status : undefined)
  if (!status) return null
  const Icon =
    status === "running"
      ? LoaderCircleIcon
      : status === "succeeded"
        ? CircleCheckIcon
        : status === "failed" || status === "cancelled"
          ? CircleXIcon
          : CircleDashedIcon
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium",
        status === "succeeded"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "failed" || status === "cancelled"
            ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
            : status === "running"
              ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
              : status === "waiting"
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "bg-muted text-muted-foreground"
      )}
    >
      <Icon className={cn("size-3", status === "running" && "animate-spin")} />
      {t(`statusLabels.${status}`)}
      {status === "running" && durationMs !== undefined ? (
        <span className="tabular-nums">
          · {formatRuntimeDuration(durationMs, t)}
        </span>
      ) : null}
    </span>
  )
}

function NodeHeaderAction({
  node,
  runtime,
}: {
  node: WorkflowNodeDraft
  runtime?: CanvasNodeRuntime
}) {
  const t = useTranslations("Studio")
  const actions = useStudioActions()
  if (node.data.kind === "image-generator") {
    const running = runtime?.status === "running"
    return (
      <button
        type="button"
        className="nodrag nopan grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => actions.runImageGenerator(node.id)}
        disabled={running}
        aria-label={t("nodes.runNode")}
        title={t("nodes.runNode")}
      >
        {running ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : (
          <PlayIcon className="size-3.5 fill-current" />
        )}
      </button>
    )
  }
  if (node.kind === "design-document" && node.data.kind === "design-document") {
    const documentId = node.data.documentId
    return (
      <button
        type="button"
        className="nodrag nopan grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("nodes.openDesign")}
        title={t("nodes.openDesign")}
        onClick={() => actions.openDesignDocument(documentId)}
      >
        <ArrowUpRightIcon className="size-3.5" />
      </button>
    )
  }
  return null
}

function NodeRuntimeCard({
  runtime,
  durationMs,
}: {
  runtime?: CanvasNodeRuntime
  durationMs?: number
}) {
  const t = useTranslations("Studio")
  if (!runtime) return null

  return (
    <section
      data-testid={`workflow-node-result-${runtime.nodeId}`}
      className={cn(
        "mt-2 rounded-lg border bg-card px-3 py-2.5 shadow-[0_6px_20px_rgba(15,23,42,0.06)]",
        runtime.status === "running"
          ? "border-violet-500/35"
          : runtime.status === "failed" || runtime.status === "cancelled"
            ? "border-rose-500/30"
            : "border-border/95"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-foreground">
          {t("nodeRuntime.result")}
        </p>
        <p className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
          {t("nodeRuntime.duration")} · {formatRuntimeDuration(durationMs, t)}
        </p>
      </div>
      {runtime.outputSummary.length > 0 ? (
        <div className="mt-1.5 grid gap-1">
          {runtime.outputSummary.map((value) => (
            <p
              key={`${runtime.nodeId}:${value.portId}`}
              className="truncate text-[13px] text-foreground"
            >
              <span className="text-muted-foreground">{value.portId}</span>
              {" · "}
              {formatRuntimeValue(value, t)}
            </p>
          ))}
        </div>
      ) : (
        <p
          className={cn(
            "mt-1.5 text-[13px] leading-4",
            runtime.error
              ? "text-rose-700 dark:text-rose-300"
              : "text-muted-foreground"
          )}
        >
          {runtime.error?.message ||
            (runtime.status === "running"
              ? t("nodeRuntime.waitingOutput")
              : t("nodeRuntime.noOutput"))}
        </p>
      )}
    </section>
  )
}

function useRuntimeDuration(runtime?: CanvasNodeRuntime) {
  const active = runtime?.status === "running" && Boolean(runtime.startedAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [active, runtime?.startedAt])

  if (!runtime) return undefined
  if (runtime.durationMs !== undefined) return runtime.durationMs
  if (!active || !runtime.startedAt) return undefined
  const startedAt = new Date(runtime.startedAt).getTime()
  return Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : undefined
}

function formatRuntimeDuration(
  durationMs: number | undefined,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (durationMs === undefined) return t("nodeRuntime.pending")
  if (durationMs < 1_000)
    return t("nodeRuntime.durationMs", { count: durationMs })
  return t("nodeRuntime.durationSeconds", {
    count: Math.round(durationMs / 100) / 10,
  })
}

function formatRuntimeValue(
  value: CanvasNodeRuntimeValue,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  switch (value.valueType) {
    case "text":
      return value.value
    case "number":
      return String(value.value)
    case "boolean":
      return value.value ? t("nodeRuntime.true") : t("nodeRuntime.false")
    case "image":
      return t("nodeRuntime.imageCount", { count: value.count })
    case "design-document":
      return `${value.documentId} · r${value.revision}`
  }
}

function NodeBody({
  node,
  asset,
  designDocument,
  modelDisplayName,
}: {
  node: WorkflowNodeDraft
  asset?: AssetDraft
  designDocument?: DesignDocumentDraft
  modelDisplayName?: string
}) {
  const t = useTranslations("Studio")

  switch (node.data.kind) {
    case "start":
      return (
        <div className="border-b border-border/70 px-3 py-3">
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">
            {t("nodes.startInputs")}
          </p>
          <div className="space-y-1.5">
            {node.data.variables.map((variable) => (
              <div
                key={variable.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/55 px-2.5 py-2 text-[13px]"
              >
                <span className="truncate font-medium">{variable.name}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {t(`types.${variable.valueType}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    case "image-generator":
      return (
        <div className="grid grid-cols-2 gap-2 border-b border-border/70 p-3 text-[13px]">
          <NodeMetric
            label={t("inspector.model")}
            value={modelDisplayName || t("inspector.modelUnavailable")}
          />
          <NodeMetric
            label={t("nodes.outputCount")}
            value={t("nodes.generateCount", { count: node.data.output.count })}
          />
          <NodeMetric
            label={t("inspector.ratio")}
            value={
              node.data.output.size.mode === "preset"
                ? node.data.output.size.aspectRatio
                : `${node.data.output.size.width} x ${node.data.output.size.height}`
            }
          />
          <NodeMetric
            label={t("inspector.quality")}
            value={t(
              `inspector.quality${node.data.quality[0].toUpperCase()}${node.data.quality.slice(1)}`
            )}
          />
        </div>
      )
    case "selector": {
      const hasCandidates = node.data.candidateNodeIds.length > 0
      return (
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-3">
          <div>
            <p className="text-[12px] text-muted-foreground">
              {t("nodes.reviewMode")}
            </p>
            <p className="mt-0.5 text-[13px] font-medium">
              {t("nodes.manualReview")}
            </p>
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-1 text-[12px] font-medium",
              hasCandidates
                ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                : "bg-muted text-muted-foreground"
            )}
          >
            {hasCandidates
              ? t("nodes.candidateCount", {
                  count: node.data.candidateNodeIds.length,
                })
              : t("nodes.waitingRun")}
          </span>
        </div>
      )
    }
    case "design-document":
      return (
        <div className="border-b border-border/70 p-3">
          <DesignPreview asset={asset} document={designDocument} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-medium">
              {designDocument?.title || t("nodes.designDocument.title")}
            </p>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {t("nodes.revision", { revision: designDocument?.revision ?? 0 })}
            </span>
          </div>
        </div>
      )
    case "end":
      return (
        <div className="border-b border-border/70 px-3 py-3">
          <NodeMetric
            label={t("nodes.endResult")}
            value={t(`types.${node.inputPorts[0]?.valueType || "image"}`)}
          />
        </div>
      )
    case "image-result":
      return null
  }
}

function NodeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[13px] font-medium">{value}</p>
    </div>
  )
}

function PortSections({
  node,
  inputBindings = {},
}: {
  node: WorkflowNodeDraft
  inputBindings?: Record<string, CanvasInputBinding[]>
}) {
  const t = useTranslations("Studio")
  if (node.inputPorts.length === 0 && node.outputPorts.length === 0) return null

  return (
    <div className="rounded-b-xl bg-card py-2">
      {node.inputPorts.length > 0 ? (
        <PortGroupLabel>{t("inspector.inputs")}</PortGroupLabel>
      ) : null}
      {node.inputPorts.map((port) => (
        <InputPortRow
          key={`input-${port.id}`}
          port={port}
          bindings={inputBindings[port.id] || []}
        />
      ))}
      {node.outputPorts.length > 0 ? (
        <PortGroupLabel className={node.inputPorts.length > 0 ? "mt-2" : ""}>
          {t("inspector.outputs")}
        </PortGroupLabel>
      ) : null}
      {node.outputPorts.map((port) => (
        <OutputPortRow key={`output-${port.id}`} node={node} port={port} />
      ))}
    </div>
  )
}

function PortGroupLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "px-3 pb-1 text-[13px] font-semibold tracking-[0.1em] text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </p>
  )
}

function InputPortRow({
  port,
  bindings,
}: {
  port: PortSpec
  bindings: CanvasInputBinding[]
}) {
  const t = useTranslations("Studio")
  const first = bindings[0]
  return (
    <div className="relative flex min-h-9 items-center gap-2 px-3 py-1">
      <Handle
        id={port.id}
        type="target"
        position={Position.Left}
        title={`${port.label}: ${port.valueType}`}
        className="!top-1/2 !left-[-7px] !size-3 !border-2 !border-card !bg-slate-400 dark:!bg-slate-300"
      />
      <span className="w-20 shrink-0 truncate text-[13px] text-muted-foreground">
        {portDisplayLabel(port, t)}
      </span>
      {first ? (
        <span
          className="min-w-0 flex-1 truncate rounded-md border border-violet-500/20 bg-violet-500/7 px-2 py-1.5 text-[12px] font-medium text-violet-700 dark:text-violet-200"
          title={first.reference}
        >
          {first.sourceNodeTitle} · {first.sourcePortLabel}
          {bindings.length > 1 ? ` +${bindings.length - 1}` : ""}
        </span>
      ) : (
        <span className="min-w-0 flex-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[12px] text-muted-foreground">
          {t("variables.choose")}
        </span>
      )}
      <TypeBadge type={port.valueType} />
    </div>
  )
}

function OutputPortRow({
  node,
  port,
}: {
  node: WorkflowNodeDraft
  port: PortSpec
}) {
  const t = useTranslations("Studio")
  const actions = useStudioActions()
  return (
    <div className="relative flex min-h-9 items-center gap-2 px-3 py-1">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {portDisplayLabel(port, t)}
      </span>
      <TypeBadge type={port.valueType} />
      <button
        type="button"
        className="nodrag nopan grid size-5 shrink-0 place-items-center rounded-full border border-violet-500/30 bg-violet-500/8 text-violet-700 transition-colors hover:bg-violet-500/18 dark:text-violet-200"
        aria-label={t("ports.continueFrom", {
          port: portDisplayLabel(port, t),
        })}
        title={t("ports.continueFrom", {
          port: portDisplayLabel(port, t),
        })}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          actions.openNodePanel({
            sourceNodeId: node.id,
            sourcePortId: port.id,
            valueType: port.valueType,
            anchor: {
              x: rect.right,
              y: rect.top + rect.height / 2,
            },
          })
        }}
      >
        <PlusIcon className="size-3" />
      </button>
      <Handle
        id={port.id}
        type="source"
        position={Position.Right}
        title={`${port.label}: ${port.valueType}`}
        className="!top-1/2 !right-[-7px] !size-3 !border-2 !border-card !bg-violet-500 dark:!bg-violet-300"
      />
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  const t = useTranslations("Studio")
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[13px] text-muted-foreground">
      {t(`types.${type}`)}
    </span>
  )
}

function DesignPreview({
  asset,
  document,
}: {
  asset?: AssetDraft
  document?: DesignDocumentDraft
}) {
  const t = useTranslations("Studio")
  const texts =
    document?.elements.filter((element) => element.kind === "text") || []
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-[linear-gradient(135deg,#e2e8f0,#f8fafc)] dark:bg-[linear-gradient(135deg,#222538,#11131c)]">
      {asset ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.dataUri}
          alt={t("nodes.designDocument.title")}
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[12px] tracking-[0.12em] text-muted-foreground uppercase">
          {t("nodes.selectImage")}
        </div>
      )}
      {texts.slice(0, 2).map((text, index) => (
        <div
          key={text.id}
          className={cn(
            "absolute right-3 left-3 truncate text-white drop-shadow-lg",
            index === 0
              ? "bottom-7 text-xs font-semibold"
              : "bottom-3 text-[7px] text-white/75"
          )}
        >
          {text.text}
        </div>
      ))}
    </div>
  )
}

function portDisplayLabel(
  port: PortSpec,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  return t.has(`ports.${port.id}`) ? t(`ports.${port.id}`) : port.label
}

function getNodeTitle(
  node: WorkflowNodeDraft,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (node.data.kind === "image-result") {
    const number = node.title.match(/\d+/)?.[0] || "—"
    return t("nodes.imageResult.title", { number })
  }
  return t(`nodes.${kindMeta[node.kind].copyKey}.title`)
}
