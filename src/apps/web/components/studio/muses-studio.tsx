"use client"

import type {
  Connection,
  Edge,
  Node,
  NodeTypes,
  OnEdgesDelete,
  OnNodesDelete,
} from "@xyflow/react"
import {
  MarkerType,
  MiniMap,
  useNodesState,
  useReactFlow,
  useViewport,
} from "@xyflow/react"
import {
  BoxIcon,
  CheckIcon,
  CircleDotIcon,
  CoinsIcon,
  DownloadIcon,
  HandIcon,
  Layers3Icon,
  MapIcon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
  SplitIcon,
  Trash2Icon,
  UploadIcon,
  UserCircleIcon,
  XIcon,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  applyCommandSequence,
  applyMusesCommand,
  createCommand,
  createDesignDocument,
  createDeterministicImageRun,
  createHarnessWorkspace,
  createInitialWorkspace,
  createNodeDraft,
  formatVariableReference,
  resolveImageOutputSize,
  type ModelCatalogProjection,
  type JobDraft,
  type MusesCommandPayload,
  type MusesWorkspaceDraft,
  type PortValueType,
  type WorkflowNodeDraft,
  type WorkflowNodeKind,
  type WorkflowInputValueType,
  type WorkflowRuntimeValue,
  type WorkflowVariableReference,
} from "@muses/domain"

import { Canvas } from "@/components/ai-elements/canvas"
import { LanguageSwitcher } from "@/components/language-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isAppLocale } from "@/i18n/config"
import { cn } from "@/lib/utils"

import {
  StudioActionsProvider,
  type NodePanelRequest,
  type StudioActions,
} from "./studio-actions"
import { VariableBindingPicker } from "./variable-binding-picker"
import {
  type CanvasInputBinding,
  type CanvasNodeData,
  type MusesFlowNode,
  WorkflowNodeCard,
} from "./workflow-node"

const DesignEditor = dynamic(() => import("./design-editor"), { ssr: false })
const STORAGE_KEY = "muses.platform-core-alpha.workspace"
const LAST_RUN_STORAGE_KEY = "muses.platform-core-alpha.last-durable-run"

type CanvasInputMode = "mouse" | "trackpad"

type StudioContextProjection = {
  workspace: {
    id: string
    name: string
    kind: "personal" | "team"
    role: "owner" | "admin" | "member" | "viewer"
  }
  credits: {
    currency: "MUSES_CREDIT"
    postedMicros: string
    reservedMicros: string
    availableMicros: string
  }
}

type DurableRunValueSummary =
  | {
      portId: string
      valueType: "text"
      value: string
      truncated: boolean
    }
  | { portId: string; valueType: "number"; value: number }
  | { portId: string; valueType: "boolean"; value: boolean }
  | { portId: string; valueType: "image"; count: number }
  | {
      portId: string
      valueType: "design-document"
      documentId: string
      revision: number
    }

type DurableRunProjection = {
  runId: string
  runtime: string
  sdkStatus: "pending" | "running" | "completed" | "failed" | "cancelled"
  status:
    | "pending"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled"
  retryOfRunId?: string
  suspension?: {
    id: string
    nodeId: string
    kind: "human-selection"
    candidateAssets: Array<{
      assetId: string
      kind: "image"
      source: "server-harness-fixture"
      label: string
    }>
  }
  failure?: {
    code: string
    category:
      | "definition"
      | "permanent"
      | "transient"
      | "transient-exhausted"
      | "timeout"
    message: string
    retryable: boolean
    nodeId?: string
    nodeKind?: string
    attempts?: number
    maxAttempts?: number
  }
  attempts: Array<{
    nodeId: string
    nodeKind: string
    attempt: number
    maxAttempts: number
    status: "running" | "retrying" | "succeeded" | "failed"
  }>
  events: Array<{ type: string; nodeId?: string }>
  result?: {
    outputs: Readonly<Record<string, WorkflowRuntimeValue>>
  }
  billing?: {
    estimatedMicros: string
    actualMicros: string
    status: string
  }
  observability?: {
    schemaVersion: "0.1.0"
    source: "workflow-sdk-world" | "muses-runtime-events"
    run: {
      startedAt?: string
      completedAt?: string
      durationMs?: number
      workflowCoreVersion?: string
    }
    nodes: Array<{
      nodeId: string
      nodeKind: string
      status: "running" | "waiting" | "succeeded" | "failed" | "cancelled"
      attempt?: number
      startedAt?: string
      completedAt?: string
      durationMs?: number
      inputSummary: DurableRunValueSummary[]
      outputSummary: DurableRunValueSummary[]
      model?: {
        modelRef: string
        capabilityProfile?: { id: string; version: string }
        priceBook?: {
          entryId: string
          version: string
          unitCreditMicros: string
        }
        requestedSize?: { width: number; height: number }
        resolvedSize?: { width: number; height: number; adjusted: boolean }
      }
      usage?: {
        imageCount: number
        tokenStatus: "reported" | "not-reported"
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
      }
      billing?: {
        estimatedMicros: string
        actualMicros: string
        status: string
      }
      error?: {
        code: string
        message: string
        retryable: boolean
      }
    }>
    totals: {
      imageCount: number
      tokenStatus: "reported" | "not-reported"
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      estimatedMicros: string
      actualMicros: string
      billingStatus: string
    }
  }
}

type DurableRunObservabilityProjection = NonNullable<
  DurableRunProjection["observability"]
>

const nodeTypes = {
  start: WorkflowNodeCard,
  "image-generator": WorkflowNodeCard,
  "image-result": WorkflowNodeCard,
  selector: WorkflowNodeCard,
  "design-document": WorkflowNodeCard,
  end: WorkflowNodeCard,
} satisfies NodeTypes

type PaletteNodeKind = Exclude<
  WorkflowNodeKind,
  "image-result" | "start" | "end"
>

const paletteItems: Array<{
  kind: PaletteNodeKind
  copyKey: "imageGenerator" | "selector" | "designDocument"
  category: "media" | "flow" | "document"
  icon: typeof SparklesIcon
}> = [
  {
    kind: "image-generator",
    copyKey: "imageGenerator",
    category: "media",
    icon: SparklesIcon,
  },
  { kind: "selector", copyKey: "selector", category: "flow", icon: SplitIcon },
  {
    kind: "design-document",
    copyKey: "designDocument",
    category: "document",
    icon: Layers3Icon,
  },
]

export function MusesStudio({
  initialContext,
  initialModelCatalog,
  user,
}: {
  initialContext: StudioContextProjection
  initialModelCatalog: ModelCatalogProjection
  user: { name?: string | null; email: string }
}) {
  const t = useTranslations("Studio")
  const searchParams = useSearchParams()
  const harnessTemplate = searchParams.get("template") === "harness"
  const createWorkspace = useCallback(() => {
    const initial = harnessTemplate
      ? createHarnessWorkspace()
      : createInitialWorkspace()
    const availableModelRefs = new Set(
      initialModelCatalog.offerings.map((offering) => offering.modelRef)
    )
    const fallbackModelRef = initialModelCatalog.offerings[0]?.modelRef
    return {
      ...initial,
      id: initialContext.workspace.id,
      workflow: {
        ...initial.workflow,
        nodes: initial.workflow.nodes.map((node) =>
          node.data.kind === "image-generator" &&
          node.data.capabilityId === "image.generate.v1" &&
          fallbackModelRef &&
          !availableModelRefs.has(node.data.modelRef)
            ? {
                ...node,
                data: { ...node.data, modelRef: fallbackModelRef },
              }
            : node
        ),
      },
    }
  }, [
    harnessTemplate,
    initialContext.workspace.id,
    initialModelCatalog.offerings,
  ])
  const workspaceStorageKey = `${STORAGE_KEY}.${initialContext.workspace.id}${
    harnessTemplate ? ".harness" : ""
  }`
  const lastRunStorageKey = harnessTemplate
    ? `${LAST_RUN_STORAGE_KEY}.${initialContext.workspace.id}.harness`
    : `${LAST_RUN_STORAGE_KEY}.${initialContext.workspace.id}`
  const localeValue = useLocale()
  const locale = isAppLocale(localeValue) ? localeValue : "en"
  const [workspace, setWorkspace] =
    useState<MusesWorkspaceDraft>(createWorkspace)
  const [hydrated, setHydrated] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    "image-generator-1"
  )
  const [activeDesignDocumentId, setActiveDesignDocumentId] = useState<
    string | null
  >(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteContext, setPaletteContext] = useState<NodePanelRequest | null>(
    null
  )
  const [miniMapVisible, setMiniMapVisible] = useState(true)
  const [canvasInputMode, setCanvasInputMode] =
    useState<CanvasInputMode>("mouse")
  const [notice, setNotice] = useState(() => t("status.ready"))
  const [publishing, setPublishing] = useState(false)
  const [lastRunId, setLastRunId] = useState<string | null>(null)
  const [durableRun, setDurableRun] = useState<DurableRunProjection | null>(
    null
  )
  const [resumingAssetId, setResumingAssetId] = useState<string | null>(null)
  const [cancellingRun, setCancellingRun] = useState(false)
  const [retryingRun, setRetryingRun] = useState(false)
  const [studioContext, setStudioContext] =
    useState<StudioContextProjection>(initialContext)
  const nodeCounter = useRef(10)
  const draggingNodeIds = useRef(new Set<string>())
  const publishWorkflowRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        let restoredWorkspaceId = createWorkspace().id
        const stored = window.localStorage.getItem(workspaceStorageKey)
        if (stored) {
          const parsed = JSON.parse(stored) as MusesWorkspaceDraft
          if (
            parsed.schemaVersion === createWorkspace().schemaVersion &&
            parsed.id === restoredWorkspaceId
          ) {
            setWorkspace(parsed)
            restoredWorkspaceId = parsed.id
            setNotice(t("status.restored"))
          }
        }
        const storedRun = window.localStorage.getItem(lastRunStorageKey)
        if (storedRun) {
          const parsedRun = JSON.parse(storedRun) as {
            workspaceId?: unknown
            runId?: unknown
          }
          if (
            parsedRun.workspaceId === restoredWorkspaceId &&
            typeof parsedRun.runId === "string" &&
            parsedRun.runId.startsWith("wrun_")
          ) {
            setLastRunId(parsedRun.runId)
          }
        }
      } catch {
        setNotice(t("status.restoreFailed"))
      } finally {
        setHydrated(true)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [createWorkspace, lastRunStorageKey, t, workspaceStorageKey])

  useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(workspace))
  }, [hydrated, workspace, workspaceStorageKey])

  useEffect(() => {
    if (!hydrated) return
    if (!lastRunId) {
      window.localStorage.removeItem(lastRunStorageKey)
      return
    }
    window.localStorage.setItem(
      lastRunStorageKey,
      JSON.stringify({ workspaceId: workspace.id, runId: lastRunId })
    )
  }, [hydrated, lastRunId, lastRunStorageKey, workspace.id])

  const refreshStudioContext = useCallback(async () => {
    const query = new URLSearchParams({ workspaceId: workspace.id })
    const response = await fetch(`/api/studio/context?${query}`)
    if (!response.ok) return
    setStudioContext((await response.json()) as StudioContextProjection)
  }, [workspace.id])

  useEffect(() => {
    if (!lastRunId) return
    let disposed = false
    let timer: number | undefined

    const poll = async () => {
      let shouldContinue = true
      try {
        const query = new URLSearchParams({
          runId: lastRunId,
          workspaceId: workspace.id,
        })
        const response = await fetch(`/api/studio/workflow-runs?${query}`)
        if (!response.ok || disposed) return
        const projection = (await response.json()) as DurableRunProjection
        if (disposed) return
        setDurableRun(projection)
        if (projection.status === "waiting") {
          setResumingAssetId(null)
          setNotice(t("status.serverHarnessWaiting"))
        } else if (projection.status === "completed") {
          shouldContinue = false
          setResumingAssetId(null)
          setCancellingRun(false)
          setNotice(t("status.serverHarnessCompleted"))
          void refreshStudioContext()
        } else if (projection.status === "cancelled") {
          shouldContinue = false
          setResumingAssetId(null)
          setCancellingRun(false)
          setNotice(t("status.serverHarnessCancelled"))
          void refreshStudioContext()
        } else if (projection.status === "failed") {
          shouldContinue = false
          setResumingAssetId(null)
          setCancellingRun(false)
          setNotice(t("status.serverHarnessFailed"))
          void refreshStudioContext()
        }
      } finally {
        if (!disposed && shouldContinue) {
          timer = window.setTimeout(poll, 600)
        }
      }
    }

    void poll()
    return () => {
      disposed = true
      if (timer) window.clearTimeout(timer)
    }
  }, [lastRunId, refreshStudioContext, t, workspace.id])

  const dispatch = useCallback(
    (payload: MusesCommandPayload | MusesCommandPayload[]) => {
      const payloads = Array.isArray(payload) ? payload : [payload]
      if (payloads.length === 0) return
      setWorkspace((current) => {
        const result = applyCommandSequence(current, payloads)
        if (!result.accepted) {
          setNotice(result.message)
          return current
        }
        setNotice(t("status.applied", { count: payloads.length }))
        return result.workspace
      })
    },
    [t]
  )

  const runImageGenerator = useCallback(
    (generatorNodeId: string) => {
      setSelectedNodeId(generatorNodeId)
      if (harnessTemplate) {
        setWorkspace((current) => {
          const selector = current.workflow.nodes.find(
            (node) =>
              node.data.kind === "selector" &&
              node.data.sourceGeneratorNodeId === generatorNodeId
          )
          if (!selector) return current
          const result = applyMusesCommand(
            current,
            createCommand(
              current,
              createDeterministicImageRun(current, generatorNodeId, selector.id)
            )
          )
          if (!result.accepted) return current
          setNotice(t("status.imageCompleted"))
          return result.workspace
        })
        return
      }
      void publishWorkflowRef.current()
    },
    [harnessTemplate, t]
  )

  const publishWorkflow = useCallback(async () => {
    setPublishing(true)
    setDurableRun(null)
    setResumingAssetId(null)
    setCancellingRun(false)
    setRetryingRun(false)
    setNotice(t("status.validating"))
    try {
      const response = await fetch("/api/studio/workflow-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          workflow: workspace.workflow,
          idempotencyKey: `workflow-run:${crypto.randomUUID()}`,
        }),
      })
      const result = (await response.json()) as {
        accepted?: boolean
        runId?: string
        validation?: { issues?: Array<{ message?: string }> }
        billing?: {
          estimatedMicros?: string
          availableAfterReserveMicros?: string
        }
      }
      if (!response.ok || !result.accepted || !result.runId) {
        const issue = result.validation?.issues?.[0]?.message
        setNotice(issue || t("status.publicationRejected"))
        return
      }
      setLastRunId(result.runId)
      if (result.billing?.availableAfterReserveMicros) {
        const availableMicros = result.billing.availableAfterReserveMicros
        setStudioContext((current) => ({
          ...current,
          credits: {
            ...current.credits,
            availableMicros,
            reservedMicros: (
              BigInt(current.credits.postedMicros) - BigInt(availableMicros)
            ).toString(),
          },
        }))
      }
      setNotice(t("status.publicationStarted", { runId: result.runId }))
    } catch {
      setNotice(t("status.publicationFailed"))
    } finally {
      setPublishing(false)
    }
  }, [t, workspace.id, workspace.workflow])

  const resumeDurableSelection = useCallback(
    async (assetId: string) => {
      if (!durableRun?.suspension) return
      setResumingAssetId(assetId)
      setNotice(t("status.serverHarnessResuming"))
      try {
        const response = await fetch("/api/studio/workflow-runs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspace.id,
            runId: durableRun.runId,
            suspensionId: durableRun.suspension.id,
            selectedAssetId: assetId,
            idempotencyKey: [
              "selector-resume",
              durableRun.runId,
              durableRun.suspension.id,
              assetId,
            ].join(":"),
          }),
        })
        if (!response.ok) {
          setResumingAssetId(null)
          setNotice(t("status.serverHarnessResumeFailed"))
        }
      } catch {
        setResumingAssetId(null)
        setNotice(t("status.serverHarnessResumeFailed"))
      }
    },
    [durableRun, t, workspace.id]
  )

  const cancelDurableRun = useCallback(async () => {
    if (
      !durableRun ||
      durableRun.status === "completed" ||
      durableRun.status === "failed" ||
      durableRun.status === "cancelled"
    ) {
      return
    }
    setCancellingRun(true)
    setNotice(t("status.serverHarnessCancelling"))
    try {
      const response = await fetch("/api/studio/workflow-runs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          runId: durableRun.runId,
          idempotencyKey: `workflow-cancel:${durableRun.runId}`,
          reason: "user-requested",
        }),
      })
      if (!response.ok) {
        setCancellingRun(false)
        setNotice(t("status.serverHarnessCancelFailed"))
      }
    } catch {
      setCancellingRun(false)
      setNotice(t("status.serverHarnessCancelFailed"))
    }
  }, [durableRun, t, workspace.id])

  const retryDurableRun = useCallback(async () => {
    if (
      !durableRun ||
      durableRun.status !== "failed" ||
      !durableRun.failure?.retryable
    ) {
      return
    }
    setRetryingRun(true)
    setNotice(t("status.serverHarnessRetrying"))
    try {
      const response = await fetch("/api/studio/workflow-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          retryOfRunId: durableRun.runId,
          idempotencyKey: `workflow-retry:${durableRun.runId}`,
        }),
      })
      const result = (await response.json()) as {
        accepted?: boolean
        runId?: string
      }
      if (!response.ok || !result.accepted || !result.runId) {
        setNotice(t("status.serverHarnessRetryFailed"))
        return
      }
      setDurableRun(null)
      setLastRunId(result.runId)
      setNotice(t("status.serverHarnessRetryStarted", { runId: result.runId }))
    } catch {
      setNotice(t("status.serverHarnessRetryFailed"))
    } finally {
      setRetryingRun(false)
    }
  }, [durableRun, t, workspace.id])

  const selectResult = useCallback(
    (resultNodeId: string) => {
      setWorkspace((current) => {
        const resultNode = current.workflow.nodes.find(
          (node) => node.id === resultNodeId
        )
        const selector = current.workflow.nodes.find(
          (node) =>
            node.data.kind === "selector" &&
            node.data.candidateNodeIds.includes(resultNodeId)
        )
        const designNode = current.workflow.nodes.find(
          (node) => node.data.kind === "design-document"
        )
        if (
          !resultNode ||
          resultNode.data.kind !== "image-result" ||
          !selector ||
          !designNode ||
          designNode.data.kind !== "design-document"
        ) {
          setNotice(t("status.selectionIncomplete"))
          return current
        }
        const result = applyCommandSequence(
          current,
          [
            {
              type: "workflow.result.select",
              selectorNodeId: selector.id,
              resultNodeId,
              designNodeId: designNode.id,
            },
            {
              type: "design.background.set",
              documentId: designNode.data.documentId,
              assetId: resultNode.data.assetId,
            },
          ],
          `select-${resultNodeId}`
        )
        if (!result.accepted) {
          setNotice(result.message)
          return current
        }
        setNotice(t("status.directionSelected"))
        return result.workspace
      })
    },
    [t]
  )

  const exportWorkspace = useCallback(() => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `muses-workspace-r${workspace.workflow.revision}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice(t("status.exported"))
  }, [t, workspace])
  publishWorkflowRef.current = publishWorkflow

  const actions = useMemo<StudioActions>(
    () => ({
      dispatch,
      exportWorkspace,
      openNodePanel: (request) => {
        setPaletteContext(request)
        setPaletteOpen(true)
      },
      openDesignDocument: setActiveDesignDocumentId,
      runImageGenerator,
      selectResult,
    }),
    [dispatch, exportWorkspace, runImageGenerator, selectResult]
  )

  const flowNodes = useMemo<MusesFlowNode[]>(
    () =>
      workspace.workflow.nodes
        .filter((node) => node.data.kind !== "image-result")
        .map((node) => {
          const assetId =
            node.data.kind === "design-document"
              ? node.data.previewAssetId
              : undefined
          const designDocument =
            node.data.kind === "design-document"
              ? workspace.designDocuments[node.data.documentId]
              : undefined
          const inputBindings = Object.fromEntries(
            node.inputPorts.map((port) => {
              if (node.data.kind === "selector" && port.id === "candidates") {
                const sourceGeneratorNodeId = node.data.sourceGeneratorNodeId
                const sourceNode = workspace.workflow.nodes.find(
                  (candidate) => candidate.id === sourceGeneratorNodeId
                )
                const sourcePort = sourceNode?.outputPorts.find(
                  (candidate) => candidate.id === "image"
                )
                if (sourceNode && sourcePort) {
                  const reference: WorkflowVariableReference = {
                    sourceNodeId: sourceNode.id,
                    sourcePortId: sourcePort.id,
                    path: [],
                  }
                  return [
                    port.id,
                    [
                      {
                        reference: formatVariableReference(reference),
                        sourceNodeTitle: nodeDisplayTitle(sourceNode, t),
                        sourcePortLabel: portDisplayLabel(sourcePort.id, t),
                        valueType: sourcePort.valueType,
                      },
                    ],
                  ]
                }
              }
              const bindings = workspace.workflow.edges
                .filter(
                  (edge) =>
                    edge.kind === "dataflow" &&
                    edge.targetNodeId === node.id &&
                    edge.targetPortId === port.id
                )
                .flatMap<CanvasInputBinding>((edge) => {
                  const sourceNode = workspace.workflow.nodes.find(
                    (candidate) => candidate.id === edge.sourceNodeId
                  )
                  const sourcePort = sourceNode?.outputPorts.find(
                    (candidate) => candidate.id === edge.sourcePortId
                  )
                  if (!sourceNode || !sourcePort) return []
                  const reference: WorkflowVariableReference = {
                    sourceNodeId: edge.sourceNodeId,
                    sourcePortId: edge.sourcePortId,
                    path: [],
                  }
                  return [
                    {
                      reference: formatVariableReference(reference),
                      sourceNodeTitle: nodeDisplayTitle(sourceNode, t),
                      sourcePortLabel: portDisplayLabel(sourcePort.id, t),
                      valueType: sourcePort.valueType,
                    },
                  ]
                })
              return [port.id, bindings]
            })
          )
          const data: CanvasNodeData = {
            domainNode: node,
            asset: assetId ? workspace.assets[assetId] : undefined,
            designDocument,
            inputBindings,
            modelDisplayName: getModelDisplayName(node, initialModelCatalog),
          }
          return {
            id: node.id,
            type: node.kind,
            position: node.position,
            data,
            deletable: node.kind !== "start" && node.kind !== "end",
            selected: selectedNodeId === node.id,
          }
        }),
    [initialModelCatalog.offerings, selectedNodeId, t, workspace]
  )

  const [canvasNodes, setCanvasNodes, onCanvasNodesChange] =
    useNodesState<MusesFlowNode>(flowNodes)

  useEffect(() => {
    setCanvasNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]))
      return flowNodes.map((node) => {
        const liveNode = currentById.get(node.id)
        if (!liveNode || !draggingNodeIds.current.has(node.id)) return node
        return {
          ...node,
          dragging: liveNode.dragging,
          position: liveNode.position,
        }
      })
    })
  }, [flowNodes, setCanvasNodes])

  const flowEdges = useMemo<Edge[]>(() => {
    const visibleNodeIds = new Set(flowNodes.map((node) => node.id))
    const domainEdges = workspace.workflow.edges.filter(
      (edge) =>
        visibleNodeIds.has(edge.sourceNodeId) &&
        visibleNodeIds.has(edge.targetNodeId)
    )

    return domainEdges.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
      label: edge.kind === "dataflow" ? undefined : edge.kind,
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edge.kind === "dataflow" ? "#8b5cf6" : "#64748b",
      },
      style: {
        stroke:
          edge.kind === "dataflow"
            ? "var(--muses-edge-dataflow)"
            : "var(--muses-edge-muted)",
        strokeWidth: edge.kind === "dataflow" ? 1.8 : 1.2,
        opacity: edge.kind === "dataflow" ? 0.76 : 0.5,
      },
      labelStyle: { fill: "#64748b", fontSize: 10 },
      labelBgStyle: { fill: "var(--muses-canvas)", fillOpacity: 0.92 },
    }))
  }, [flowNodes, workspace.workflow.edges])

  const selectedNode = workspace.workflow.nodes.find(
    (node) => node.id === selectedNodeId
  )
  const activeDocument = activeDesignDocumentId
    ? workspace.designDocuments[activeDesignDocumentId]
    : undefined

  const onConnect = useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        !connection.sourceHandle ||
        !connection.targetHandle
      ) {
        return
      }
      dispatch({
        type: "workflow.edge.add",
        edge: {
          id: `edge-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
          sourceNodeId: connection.source,
          sourcePortId: connection.sourceHandle,
          targetNodeId: connection.target,
          targetPortId: connection.targetHandle,
          kind: "dataflow",
        },
      })
    },
    [dispatch]
  )

  const bindVariable = useCallback(
    (
      targetNodeId: string,
      targetPortId: string,
      reference: WorkflowVariableReference | null
    ) => {
      const existing = workspace.workflow.edges.find(
        (edge) =>
          edge.kind === "dataflow" &&
          edge.targetNodeId === targetNodeId &&
          edge.targetPortId === targetPortId
      )
      if (
        existing &&
        reference &&
        existing.sourceNodeId === reference.sourceNodeId &&
        existing.sourcePortId === reference.sourcePortId
      ) {
        return
      }

      const payloads: MusesCommandPayload[] = []
      if (existing) {
        payloads.push({ type: "workflow.edge.remove", edgeId: existing.id })
      }
      if (reference) {
        payloads.push({
          type: "workflow.edge.add",
          edge: {
            id: `edge-variable-${reference.sourceNodeId}-${reference.sourcePortId}-${targetNodeId}-${targetPortId}`,
            sourceNodeId: reference.sourceNodeId,
            sourcePortId: reference.sourcePortId,
            targetNodeId,
            targetPortId,
            kind: "dataflow",
          },
        })
      }
      dispatch(payloads)
    },
    [dispatch, workspace.workflow.edges]
  )

  const onNodesDelete = useCallback<OnNodesDelete<Node>>(
    (nodes) =>
      dispatch(
        nodes
          .filter((node) => node.type !== "start" && node.type !== "end")
          .map((node) => ({
            type: "workflow.node.remove" as const,
            nodeId: node.id,
          }))
      ),
    [dispatch]
  )
  const onEdgesDelete = useCallback<OnEdgesDelete<Edge>>(
    (edges) =>
      dispatch(
        edges.map((edge) => ({
          type: "workflow.edge.remove" as const,
          edgeId: edge.id,
        }))
      ),
    [dispatch]
  )

  function addNode(kind: PaletteNodeKind) {
    let sequence = nodeCounter.current
    while (
      workspace.workflow.nodes.some((node) => node.id === `${kind}-${sequence}`)
    ) {
      sequence += 1
    }
    nodeCounter.current = sequence + 1
    const id = `${kind}-${sequence}`
    const sourceNode = paletteContext
      ? workspace.workflow.nodes.find(
          (candidate) => candidate.id === paletteContext.sourceNodeId
        )
      : undefined
    const position = paletteContext
      ? findContinuationPosition(
          workspace.workflow.nodes,
          sourceNode?.position || { x: 220, y: 120 }
        )
      : {
          x: 220 + (workspace.workflow.nodes.length % 4) * 420,
          y: 120 + (workspace.workflow.nodes.length % 3) * 260,
        }
    let node = createNodeDraft(kind, id, position)
    if (
      paletteContext &&
      node.data.kind === "selector" &&
      sourceNode?.data.kind === "image-generator"
    ) {
      node = {
        ...node,
        data: {
          ...node.data,
          sourceGeneratorNodeId: sourceNode.id,
        },
      }
    }
    const continuationPort = paletteContext
      ? findCompatibleInput(node, paletteContext.valueType)
      : undefined
    const payloads: MusesCommandPayload[] = [
      {
        type: "workflow.node.add",
        node,
        designDocument:
          node.data.kind === "design-document"
            ? createDesignDocument(
                node.data.documentId,
                `Design composition ${sequence}`
              )
            : undefined,
      },
    ]
    if (paletteContext && continuationPort) {
      payloads.push({
        type: "workflow.edge.add",
        edge: {
          id: `edge-${paletteContext.sourceNodeId}-${paletteContext.sourcePortId}-${node.id}-${continuationPort.id}`,
          sourceNodeId: paletteContext.sourceNodeId,
          sourcePortId: paletteContext.sourcePortId,
          targetNodeId: node.id,
          targetPortId: continuationPort.id,
          kind: "dataflow",
        },
      })
    }
    dispatch(payloads)
    setSelectedNodeId(id)
    setPaletteOpen(false)
    setPaletteContext(null)
  }

  function resetWorkspace() {
    window.localStorage.removeItem(workspaceStorageKey)
    window.localStorage.removeItem(lastRunStorageKey)
    setWorkspace(createWorkspace())
    setLastRunId(null)
    setDurableRun(null)
    setResumingAssetId(null)
    setCancellingRun(false)
    setSelectedNodeId("image-generator-1")
    setActiveDesignDocumentId(null)
    setPaletteContext(null)
    setPaletteOpen(false)
    setNotice(t("status.reset"))
  }

  return (
    <StudioActionsProvider value={actions}>
      <main className="relative flex h-svh min-h-[640px] flex-col overflow-hidden bg-background text-foreground">
        <StudioHeader
          workspace={workspace}
          studioContext={studioContext}
          user={user}
          hydrated={hydrated}
          locale={locale}
          onExport={exportWorkspace}
          onReset={resetWorkspace}
        />

        <div className="flex min-h-0 flex-1">
          <section className="relative min-w-0 flex-1 bg-muted/20">
            {paletteOpen ? (
              <Palette
                context={paletteContext}
                sourceNode={
                  paletteContext
                    ? workspace.workflow.nodes.find(
                        (node) => node.id === paletteContext.sourceNodeId
                      )
                    : undefined
                }
                onAdd={addNode}
                onClose={() => {
                  setPaletteOpen(false)
                  setPaletteContext(null)
                }}
              />
            ) : null}
            <div
              role="status"
              className="pointer-events-none absolute top-3 left-1/2 z-20 flex max-w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-lg border border-border/80 bg-background/90 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur"
            >
              <CircleDotIcon className="size-3 shrink-0 text-emerald-500" />
              <span className="truncate">{notice}</span>
            </div>
            {durableRun ? (
              <DurableRunPanel
                projection={durableRun}
                resumingAssetId={resumingAssetId}
                cancelling={cancellingRun}
                retrying={retryingRun}
                onSelect={(assetId) => void resumeDurableSelection(assetId)}
                onCancel={() => void cancelDurableRun()}
                onRetry={() => void retryDurableRun()}
              />
            ) : null}
            <Canvas<MusesFlowNode>
              nodes={canvasNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onConnect={onConnect}
              onNodesChange={onCanvasNodesChange}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              onNodeDragStart={(_, node) => {
                draggingNodeIds.current.add(node.id)
                setSelectedNodeId(node.id)
              }}
              onNodeDragStop={(_, node) => {
                draggingNodeIds.current.delete(node.id)
                dispatch({
                  type: "workflow.node.move",
                  nodeId: node.id,
                  position: node.position,
                })
              }}
              onNodesDelete={onNodesDelete}
              onEdgesDelete={onEdgesDelete}
              defaultEdgeOptions={{ type: "smoothstep" }}
              minZoom={0.2}
              maxZoom={1.8}
              proOptions={{ hideAttribution: false }}
              fitView={false}
              panOnDrag={canvasInputMode === "mouse"}
              panOnScroll={canvasInputMode === "trackpad"}
              selectionOnDrag={canvasInputMode === "trackpad"}
              zoomOnScroll={canvasInputMode === "mouse"}
              zoomOnPinch
              selectionKeyCode="Shift"
            >
              <CanvasBootstrap enabled={hydrated} />
              {miniMapVisible ? (
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  nodeColor={(node) =>
                    node.type === "design-document" ? "#fb7185" : "#8b5cf6"
                  }
                  maskColor="var(--muses-minimap-mask)"
                  className="!right-3 !bottom-16 !m-0 !rounded-lg !border !border-border !bg-background !shadow-sm"
                />
              ) : null}
              <ProfessionalToolbar
                inputMode={canvasInputMode}
                lastRunId={lastRunId}
                miniMapVisible={miniMapVisible}
                onAddNode={() => {
                  setPaletteContext(null)
                  setPaletteOpen((open) => !open)
                }}
                onInputModeChange={setCanvasInputMode}
                onMiniMapToggle={() => setMiniMapVisible((visible) => !visible)}
                onPublish={() => void publishWorkflow()}
                publishing={publishing}
              />
            </Canvas>
          </section>
          <Inspector
            selectedNode={selectedNode}
            workspace={workspace}
            modelCatalog={initialModelCatalog}
            dispatch={dispatch}
            onBindVariable={bindVariable}
            actions={actions}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>

        {activeDocument ? (
          <DesignEditor
            assets={workspace.assets}
            document={activeDocument}
            onClose={() => setActiveDesignDocumentId(null)}
            onDispatch={dispatch}
          />
        ) : null}
      </main>
    </StudioActionsProvider>
  )
}

function CanvasBootstrap({ enabled }: { enabled: boolean }) {
  const { fitView, getNodes } = useReactFlow<MusesFlowNode>()
  const fitted = useRef(false)

  useEffect(() => {
    if (!enabled || fitted.current) return
    const timer = window.setTimeout(() => {
      const initialNodes = getNodes().filter((node) =>
        ["start", "image-generator", "selector"].includes(node.type || "")
      )
      if (initialNodes.length === 0) return
      fitted.current = true
      void fitView({
        nodes: initialNodes,
        padding: 0.22,
        duration: 0,
        maxZoom: 0.9,
      })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [enabled, fitView, getNodes])

  return null
}

function StudioHeader({
  workspace,
  studioContext,
  user,
  hydrated,
  locale,
  onExport,
  onReset,
}: {
  workspace: MusesWorkspaceDraft
  studioContext: StudioContextProjection
  user: { name?: string | null; email: string }
  hydrated: boolean
  locale: "en" | "zh-CN"
  onExport: () => void
  onReset: () => void
}) {
  const t = useTranslations("Studio")
  return (
    <header className="relative flex h-15 shrink-0 items-center justify-between border-b border-border bg-background px-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background"
          aria-label="Muses"
        >
          <span className="text-xs font-black">M</span>
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{t("title")}</h1>
            <span className="rounded-full border border-violet-500/20 bg-violet-500/8 px-2 py-0.5 text-[8px] font-semibold tracking-[0.12em] text-violet-700 uppercase dark:text-violet-200">
              {t("alpha")}
            </span>
          </div>
          <p className="hidden text-[9px] text-muted-foreground sm:block">
            {t("subtitle")}
          </p>
        </div>
      </div>

      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-lg bg-muted p-0.5 md:flex">
        <button
          type="button"
          disabled
          className="rounded-md px-3 py-1.5 text-[10px] font-medium text-muted-foreground opacity-55"
          title={t("modes.creativeSoon")}
        >
          {t("modes.creative")}
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-[10px] font-semibold shadow-sm"
          aria-current="page"
        >
          {t("modes.professional")}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <span
          data-testid="studio-credit-balance"
          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-[9px] font-semibold"
          title={t("header.creditBalance")}
        >
          <CoinsIcon className="size-3.5 text-amber-500" />
          {formatCreditMicros(studioContext.credits.availableMicros)}
        </span>
        <span
          className="flex items-center gap-1.5 px-1.5 text-[9px] text-muted-foreground"
          aria-label={hydrated ? t("header.autosaved") : t("header.preparing")}
          title={hydrated ? t("header.autosaved") : t("header.preparing")}
        >
          <SaveIcon className="size-3" />
          <span className="hidden 2xl:inline">
            {hydrated ? t("header.autosaved") : t("header.preparing")}
          </span>
        </span>
        <span className="hidden rounded-md bg-muted px-2 py-1 text-[9px] text-muted-foreground 2xl:inline">
          r{workspace.workflow.revision}
        </span>
        <ToolbarButton
          icon={RotateCcwIcon}
          label={t("header.reset")}
          onClick={onReset}
        />
        <ToolbarButton
          icon={DownloadIcon}
          label={t("header.export")}
          onClick={onExport}
        />
        <ThemeToggle compact />
        <LanguageSwitcher compact locale={locale} />
        <Link
          href="/account"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("header.account", { email: user.email })}
          title={user.name || user.email}
        >
          <UserCircleIcon className="size-4" />
        </Link>
      </div>
    </header>
  )
}

function formatCreditMicros(value: string) {
  const micros = BigInt(value)
  const whole = micros / BigInt(1_000_000)
  const fraction = (micros % BigInt(1_000_000)) / BigInt(10_000)
  return fraction === BigInt(0)
    ? `${whole.toString()} cr`
    : `${whole.toString()}.${fraction.toString().padStart(2, "0")} cr`
}

function formatModelRefLabel(modelRef: string) {
  const modelId = modelRef.split("/").at(-1)?.split("@")[0] || modelRef
  return modelId
    .split("-")
    .map((part) =>
      part === "gpt"
        ? "GPT"
        : part === "image"
          ? "Image"
          : part.replace(/^\w/, (character) => character.toUpperCase())
    )
    .join(" ")
}

function findCompatibleInput(
  node: WorkflowNodeDraft,
  valueType: PortValueType
) {
  return node.inputPorts.find((port) =>
    (port.accepts || [port.valueType]).includes(valueType)
  )
}

function findContinuationPosition(
  nodes: WorkflowNodeDraft[],
  sourcePosition: { x: number; y: number }
) {
  const x = sourcePosition.x + 440
  const offsets = [0, 220, -220, 440, -440, 660, -660]
  const y =
    offsets
      .map((offset) => sourcePosition.y + offset)
      .find((candidateY) =>
        nodes.every(
          (node) =>
            Math.abs(node.position.x - x) >= 380 ||
            Math.abs(node.position.y - candidateY) >= 180
        )
      ) ?? sourcePosition.y + nodes.length * 40
  return { x, y }
}

function paletteItemAcceptsContext(
  kind: PaletteNodeKind,
  context: NodePanelRequest,
  sourceNode?: WorkflowNodeDraft
) {
  const candidate = createNodeDraft(kind, "palette-preview", { x: 0, y: 0 })
  if (kind === "selector" && sourceNode?.data.kind !== "image-generator") {
    return false
  }
  return Boolean(findCompatibleInput(candidate, context.valueType))
}

function Palette({
  context,
  sourceNode,
  onAdd,
  onClose,
}: {
  context: NodePanelRequest | null
  sourceNode?: WorkflowNodeDraft
  onAdd: (kind: PaletteNodeKind) => void
  onClose: () => void
}) {
  const t = useTranslations("Studio")
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLocaleLowerCase()
  const filtered = paletteItems.filter(
    (item) =>
      (!context || paletteItemAcceptsContext(item.kind, context, sourceNode)) &&
      [t(`nodes.${item.copyKey}.title`), t(`nodes.${item.copyKey}.description`)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized)
  )
  const categories = ["input", "media", "flow", "document", "output"] as const

  return (
    <aside
      data-testid="studio-node-library"
      data-contextual={context ? "true" : "false"}
      className={cn(
        "z-30 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_18px_56px_rgba(15,23,42,0.16)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.4)]",
        context
          ? "fixed max-h-[calc(100vh-84px)] w-[min(360px,calc(100vw-24px))]"
          : "absolute top-3 bottom-16 left-3 w-[min(492px,calc(100%-24px))]"
      )}
      style={
        context
          ? {
              left: `clamp(12px, ${context.anchor.x + 12}px, calc(100vw - 372px))`,
              top: `clamp(72px, ${context.anchor.y - 104}px, calc(100vh - 572px))`,
            }
          : undefined
      }
    >
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <BoxIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {context ? t("palette.continueTitle") : t("palette.title")}
              </span>
            </div>
            {context ? (
              <p className="mt-1 truncate pl-6 text-[9px] text-muted-foreground">
                {sourceNode
                  ? nodeDisplayTitle(sourceNode, t)
                  : context.sourceNodeId}{" "}
                · {portDisplayLabel(context.sourcePortId, t)} ·{" "}
                {t(`types.${context.valueType}`)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("palette.close")}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        <div className="relative mt-3">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("palette.search")}
            className="bg-background pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <p className="px-3 py-10 text-center text-xs text-muted-foreground">
            {t("palette.noResults")}
          </p>
        ) : (
          categories.map((category) => {
            const items = filtered.filter((item) => item.category === category)
            if (items.length === 0) return null
            return (
              <section key={category} className="mb-3">
                <p className="px-2 py-1.5 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {t(`palette.categories.${category}`)}
                </p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {items.map((item) => {
                    const Icon = item.icon
                    const title = t(`nodes.${item.copyKey}.title`)
                    return (
                      <button
                        type="button"
                        key={item.kind}
                        onClick={() => onAdd(item.kind)}
                        aria-label={t("palette.add", { node: title })}
                        className="group flex h-10 w-full items-center gap-2 rounded-lg px-1.5 text-left hover:bg-accent"
                      >
                        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground group-hover:border-violet-500/30 group-hover:text-violet-700 dark:group-hover:text-violet-300">
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-medium">
                            {title}
                          </span>
                          <span className="mt-0.5 block truncate text-[8px] text-muted-foreground">
                            {t(`nodes.${item.copyKey}.description`)}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>

      <div className="border-t border-border px-4 py-2.5 text-[9px] text-muted-foreground">
        {context ? t("palette.compatibleHint") : t("palette.hint")}
      </div>
    </aside>
  )
}

function Inspector({
  selectedNode,
  workspace,
  modelCatalog,
  dispatch,
  onBindVariable,
  actions,
  onClose,
}: {
  selectedNode?: WorkflowNodeDraft
  workspace: MusesWorkspaceDraft
  modelCatalog: ModelCatalogProjection
  dispatch: (payload: MusesCommandPayload | MusesCommandPayload[]) => void
  onBindVariable: (
    nodeId: string,
    portId: string,
    reference: WorkflowVariableReference | null
  ) => void
  actions: StudioActions
  onClose: () => void
}) {
  const t = useTranslations("Studio")
  const locale = useLocale()
  if (!selectedNode) return null

  const selectedDesignDocumentId =
    selectedNode.data.kind === "design-document"
      ? selectedNode.data.documentId
      : null
  const resultNodes = workspace.workflow.nodes.filter((node) => {
    if (node.data.kind !== "image-result") return false
    if (selectedNode.data.kind === "image-generator") {
      return node.data.generatorNodeId === selectedNode.id
    }
    if (selectedNode.data.kind === "selector") {
      return selectedNode.data.candidateNodeIds.includes(node.id)
    }
    return false
  })
  const latestJob =
    selectedNode.data.kind === "image-generator" && selectedNode.data.lastJobId
      ? workspace.jobs[selectedNode.data.lastJobId]
      : undefined

  return (
    <aside className="hidden w-[400px] shrink-0 overflow-y-auto border-l border-border bg-background xl:block">
      <div className="sticky top-0 z-20 border-b border-border bg-background/96 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Settings2Icon className="size-4 shrink-0 text-violet-600 dark:text-violet-300" />
              <h2 className="truncate text-sm font-semibold">
                {nodeDisplayTitle(selectedNode, t)}
              </h2>
            </div>
            <p className="mt-1 pl-6 text-[10px] text-muted-foreground">
              {t(`nodes.${nodeCopyKey(selectedNode.kind)}.description`)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("inspector.close")}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="px-4 pb-8">
        <InspectorSection title={t("inspector.configuration")}>
          {selectedNode.data.kind === "start" ? (
            <StartVariablesEditor node={selectedNode} dispatch={dispatch} />
          ) : null}
          {selectedNode.data.kind === "image-generator" ? (
            <ImageGeneratorEditor
              node={selectedNode}
              workspace={workspace}
              modelCatalog={modelCatalog}
              dispatch={dispatch}
              onBindVariable={onBindVariable}
              onRun={() => actions.runImageGenerator(selectedNode.id)}
            />
          ) : null}
          {selectedNode.data.kind === "selector" ? (
            <InspectorField
              label={t("nodes.reviewMode")}
              value={t("nodes.manualReview")}
            />
          ) : null}
          {selectedDesignDocumentId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() =>
                actions.openDesignDocument(selectedDesignDocumentId)
              }
            >
              <Layers3Icon className="size-3.5" />
              {t("inspector.openDocument")}
            </Button>
          ) : null}
          {selectedNode.data.kind === "end" ? (
            <InspectorField
              label={t("inspector.endBehavior")}
              value={t("inspector.endBehaviorValue")}
            />
          ) : null}
        </InspectorSection>

        {selectedNode.inputPorts.length > 0 &&
        selectedNode.data.kind !== "image-generator" ? (
          <InspectorSection title={t("inspector.inputs")}>
            {selectedNode.inputPorts.map((port) =>
              port.allowsMultiple ? (
                <div
                  key={port.id}
                  className="rounded-lg border border-border bg-muted/25 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-medium">
                      {portDisplayLabel(port.id, t)}
                    </span>
                    <span className="rounded bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {
                        workspace.workflow.edges.filter(
                          (edge) =>
                            edge.kind === "dataflow" &&
                            edge.targetNodeId === selectedNode.id &&
                            edge.targetPortId === port.id
                        ).length
                      }
                    </span>
                  </div>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {t("inspector.multiInputHint")}
                  </p>
                </div>
              ) : (
                <VariableBindingPicker
                  key={port.id}
                  workflow={workspace.workflow}
                  nodeId={selectedNode.id}
                  port={port}
                  onChange={(reference) =>
                    onBindVariable(selectedNode.id, port.id, reference)
                  }
                />
              )
            )}
          </InspectorSection>
        ) : null}

        {selectedNode.data.kind === "image-generator" ? (
          <ImageRunDetails
            job={latestJob}
            locale={locale}
            node={selectedNode}
            workspace={workspace}
          />
        ) : null}

        {selectedNode.outputPorts.length > 0 ? (
          <InspectorSection title={t("inspector.outputs")}>
            {selectedNode.outputPorts.map((port) => (
              <div
                key={port.id}
                className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5 text-[10px]"
              >
                <span>{portDisplayLabel(port.id, t)}</span>
                <span className="rounded bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {t(`types.${port.valueType}`)}
                </span>
              </div>
            ))}
          </InspectorSection>
        ) : null}

        {resultNodes.length > 0 ? (
          <InspectorSection title={t("inspector.results")}>
            <ResultGallery
              nodes={resultNodes}
              workspace={workspace}
              onSelect={actions.selectResult}
            />
          </InspectorSection>
        ) : null}
      </div>
    </aside>
  )
}

function ImageGeneratorEditor({
  node,
  workspace,
  modelCatalog,
  dispatch,
  onBindVariable,
  onRun,
}: {
  node: WorkflowNodeDraft
  workspace: MusesWorkspaceDraft
  modelCatalog: ModelCatalogProjection
  dispatch: (payload: MusesCommandPayload | MusesCommandPayload[]) => void
  onBindVariable: (
    nodeId: string,
    portId: string,
    reference: WorkflowVariableReference | null
  ) => void
  onRun: () => void
}) {
  const t = useTranslations("Studio")
  if (node.data.kind !== "image-generator") return null
  const imageData = node.data
  const modelOffering = modelCatalog.offerings.find(
    (offering) => offering.modelRef === imageData.modelRef
  )
  const promptValue =
    imageData.inputs.prompt.mode === "fixed"
      ? imageData.inputs.prompt.value
      : resolveImageGeneratorPrompt(workspace, node.id) || ""
  const [prompt, setPrompt] = useState(promptValue)
  const [uploadingReference, setUploadingReference] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => setPrompt(promptValue), [promptValue])

  const updateConfig = (
    patch: Partial<
      Pick<typeof imageData, "modelRef" | "inputs" | "output" | "quality">
    >
  ) =>
    dispatch({
      type: "workflow.image-generator.config.set",
      nodeId: node.id,
      config: {
        modelRef: patch.modelRef ?? imageData.modelRef,
        inputs: patch.inputs ?? imageData.inputs,
        output: patch.output ?? imageData.output,
        quality: patch.quality ?? imageData.quality,
      },
    })

  const commitPrompt = () => {
    if (imageData.inputs.prompt.mode !== "fixed") return
    const next = prompt.trim()
    if (!next || next === promptValue) return
    updateConfig({
      inputs: {
        ...imageData.inputs,
        prompt: { mode: "fixed", value: next },
      },
    })
  }

  const specification = modelOffering?.capability.specification
  const resolvedSize = specification
    ? resolveImageOutputSize(imageData.output.size, specification)
    : null
  const promptPort = node.inputPorts.find((port) => port.id === "prompt")
  const referencePort = node.inputPorts.find(
    (port) => port.id === "referenceImages"
  )
  const fixedReferenceIds =
    imageData.inputs.referenceImages.mode === "fixed"
      ? imageData.inputs.referenceImages.assetIds
      : []

  const setPromptMode = (mode: "variable" | "fixed") => {
    if (mode === imageData.inputs.prompt.mode) return
    updateConfig({
      inputs: {
        ...imageData.inputs,
        prompt:
          mode === "fixed"
            ? { mode: "fixed", value: promptValue }
            : { mode: "variable" },
      },
    })
  }

  const setReferenceMode = (mode: "variable" | "fixed") => {
    if (mode === imageData.inputs.referenceImages.mode) return
    updateConfig({
      inputs: {
        ...imageData.inputs,
        referenceImages:
          mode === "fixed"
            ? { mode: "fixed", assetIds: [] }
            : { mode: "variable" },
      },
    })
  }

  const uploadReferenceImage = async (file: File) => {
    if (!specification || uploadingReference) return
    if (fixedReferenceIds.length >= specification.referenceImages.maxCount) {
      setUploadError(
        t("inspector.referenceLimit", {
          count: specification.referenceImages.maxCount,
        })
      )
      return
    }
    setUploadingReference(true)
    setUploadError(null)
    try {
      const uploadResponse = await fetch(
        "/api/studio/reference-images/upload",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspace.id,
            fileName: file.name,
            contentType: file.type,
            size: file.size,
          }),
        }
      )
      const uploadResult = (await uploadResponse.json()) as {
        upload?: {
          assetId: string
          url: string
          method: "PUT"
          headers: Record<string, string>
        }
        message?: string
      }
      if (!uploadResponse.ok || !uploadResult.upload) {
        throw new Error(
          uploadResult.message || t("inspector.referenceUploadFailed")
        )
      }
      const putResponse = await fetch(uploadResult.upload.url, {
        method: uploadResult.upload.method,
        headers: uploadResult.upload.headers,
        body: file,
      })
      if (!putResponse.ok) throw new Error(t("inspector.referenceUploadFailed"))
      const confirmResponse = await fetch(
        "/api/studio/reference-images/confirm",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspace.id,
            assetId: uploadResult.upload.assetId,
          }),
        }
      )
      const confirmResult = (await confirmResponse.json()) as {
        asset?: { id: string }
        message?: string
      }
      if (!confirmResponse.ok || !confirmResult.asset) {
        throw new Error(
          confirmResult.message || t("inspector.referenceUploadFailed")
        )
      }
      updateConfig({
        inputs: {
          ...imageData.inputs,
          referenceImages: {
            mode: "fixed",
            assetIds: [...fixedReferenceIds, confirmResult.asset.id],
          },
        },
      })
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : t("inspector.referenceUploadFailed")
      )
    } finally {
      setUploadingReference(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2.5 border-b border-border pb-4">
        <ImageInputHeader
          label={t("inspector.prompt")}
          mode={imageData.inputs.prompt.mode}
          onChange={setPromptMode}
        />
        {imageData.inputs.prompt.mode === "variable" && promptPort ? (
          <>
            <VariableBindingPicker
              workflow={workspace.workflow}
              nodeId={node.id}
              port={promptPort}
              onChange={(reference) =>
                onBindVariable(node.id, promptPort.id, reference)
              }
            />
            <div className="rounded-md bg-muted/55 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
              <span className="font-medium text-foreground">
                {t("inspector.resolvedValue")}
              </span>
              <p className="mt-1 line-clamp-3">
                {promptValue || t("variables.unbound")}
              </p>
            </div>
          </>
        ) : (
          <textarea
            data-testid="image-prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={commitPrompt}
            rows={5}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10"
          />
        )}

        <ImageInputHeader
          label={t("inspector.referenceImages")}
          mode={imageData.inputs.referenceImages.mode}
          onChange={setReferenceMode}
        />
        {imageData.inputs.referenceImages.mode === "variable" &&
        referencePort ? (
          <VariableBindingPicker
            workflow={workspace.workflow}
            nodeId={node.id}
            port={referencePort}
            onChange={(reference) =>
              onBindVariable(node.id, referencePort.id, reference)
            }
          />
        ) : (
          <div className="space-y-2">
            {fixedReferenceIds.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {fixedReferenceIds.map((assetId) => (
                  <div
                    key={assetId}
                    className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/studio/reference-images/${assetId}?workspaceId=${encodeURIComponent(workspace.id)}`}
                      alt=""
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      className="absolute top-1 right-1 grid size-6 place-items-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
                      aria-label={t("inspector.removeReference")}
                      onClick={() =>
                        updateConfig({
                          inputs: {
                            ...imageData.inputs,
                            referenceImages: {
                              mode: "fixed",
                              assetIds: fixedReferenceIds.filter(
                                (candidate) => candidate !== assetId
                              ),
                            },
                          },
                        })
                      }
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input text-[10px] font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground">
              <UploadIcon className="size-3.5" />
              {uploadingReference
                ? t("inspector.referenceUploading")
                : t("inspector.addReference")}
              <input
                data-testid="reference-image-input"
                type="file"
                accept={specification?.referenceImages.mimeTypes.join(",")}
                disabled={uploadingReference || !specification}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (file) void uploadReferenceImage(file)
                }}
              />
            </label>
            <p className="text-[9px] text-muted-foreground">
              {t("inspector.referenceHint", {
                count: specification?.referenceImages.maxCount || 0,
              })}
            </p>
            {uploadError ? (
              <p className="text-[9px] text-destructive">{uploadError}</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ImageConfigSelect
          label={t("inspector.model")}
          value={imageData.modelRef}
          onChange={(value) => {
            const next = modelCatalog.offerings.find(
              (offering) => offering.modelRef === value
            )
            if (!next) return
            const nextSpecification = next.capability.specification
            const currentSize = imageData.output.size
            const nextSize =
              currentSize.mode === "custom" &&
              nextSpecification.customSize.enabled
                ? currentSize
                : currentSize.mode === "preset" &&
                    nextSpecification.resolutionPresets.some(
                      (preset) => preset.id === currentSize.presetId
                    ) &&
                    nextSpecification.aspectRatios.includes(
                      currentSize.aspectRatio
                    )
                  ? currentSize
                  : {
                      mode: "preset" as const,
                      presetId: nextSpecification.resolutionPresets[0].id,
                      aspectRatio: nextSpecification.aspectRatios[0],
                    }
            updateConfig({
              modelRef: next.modelRef,
              output: {
                size: nextSize,
                count: nextSpecification.outputCounts.includes(
                  imageData.output.count
                )
                  ? imageData.output.count
                  : nextSpecification.outputCounts[0],
              },
              quality: nextSpecification.parameters.quality.values.includes(
                imageData.quality
              )
                ? imageData.quality
                : nextSpecification.parameters.quality.default,
            })
          }}
          options={modelCatalog.offerings.map((offering) => ({
            value: offering.modelRef,
            label: offering.displayName,
          }))}
        />
        <ImageConfigSelect
          label={t("inspector.sizeMode")}
          value={imageData.output.size.mode}
          onChange={(value) => {
            if (!specification) return
            if (value === "custom") {
              const fallback = resolvedSize?.ok
                ? resolvedSize.value
                : { width: 1024, height: 1024 }
              updateConfig({
                output: {
                  ...imageData.output,
                  size: {
                    mode: "custom",
                    width: fallback.width,
                    height: fallback.height,
                  },
                },
              })
            } else {
              updateConfig({
                output: {
                  ...imageData.output,
                  size: {
                    mode: "preset",
                    presetId: specification.resolutionPresets[0].id,
                    aspectRatio: specification.aspectRatios[0],
                  },
                },
              })
            }
          }}
          options={[
            { value: "preset", label: t("inspector.sizePreset") },
            ...(specification?.customSize.enabled
              ? [{ value: "custom", label: t("inspector.sizeCustom") }]
              : []),
          ]}
        />
        {imageData.output.size.mode === "preset" ? (
          <>
            <ImageConfigSelect
              label={t("inspector.resolution")}
              value={imageData.output.size.presetId}
              onChange={(presetId) => {
                if (imageData.output.size.mode !== "preset") return
                updateConfig({
                  output: {
                    ...imageData.output,
                    size: {
                      mode: "preset",
                      presetId,
                      aspectRatio: imageData.output.size.aspectRatio,
                    },
                  },
                })
              }}
              options={(specification?.resolutionPresets || []).map(
                (preset) => ({
                  value: preset.id,
                  label: preset.label,
                })
              )}
            />
            <ImageConfigSelect
              label={t("inspector.ratio")}
              value={imageData.output.size.aspectRatio}
              onChange={(aspectRatio) => {
                if (imageData.output.size.mode !== "preset") return
                updateConfig({
                  output: {
                    ...imageData.output,
                    size: {
                      mode: "preset",
                      presetId: imageData.output.size.presetId,
                      aspectRatio,
                    },
                  },
                })
              }}
              options={(specification?.aspectRatios || []).map((ratio) => ({
                value: ratio,
                label: ratio,
              }))}
            />
          </>
        ) : (
          <>
            <ImageNumberInput
              label={t("inspector.width")}
              value={imageData.output.size.width}
              onChange={(width) => {
                if (imageData.output.size.mode !== "custom") return
                updateConfig({
                  output: {
                    ...imageData.output,
                    size: {
                      mode: "custom",
                      width,
                      height: imageData.output.size.height,
                    },
                  },
                })
              }}
            />
            <ImageNumberInput
              label={t("inspector.height")}
              value={imageData.output.size.height}
              onChange={(height) => {
                if (imageData.output.size.mode !== "custom") return
                updateConfig({
                  output: {
                    ...imageData.output,
                    size: {
                      mode: "custom",
                      width: imageData.output.size.width,
                      height,
                    },
                  },
                })
              }}
            />
          </>
        )}
        <ImageConfigSelect
          label={t("inspector.imageCount")}
          value={String(imageData.output.count)}
          onChange={(value) =>
            updateConfig({
              output: { ...imageData.output, count: Number(value) },
            })
          }
          options={(
            modelOffering?.capability.specification.outputCounts || [
              imageData.output.count,
            ]
          ).map((count) => ({
            value: String(count),
            label: String(count),
          }))}
        />
        <ImageConfigSelect
          label={t("inspector.quality")}
          value={imageData.quality}
          onChange={(value) =>
            updateConfig({ quality: value as typeof imageData.quality })
          }
          options={(
            modelOffering?.capability.specification.parameters.quality
              .values || [imageData.quality]
          ).map((quality) => ({
            value: quality,
            label: quality,
          }))}
        />
      </div>
      {resolvedSize?.ok ? (
        <div
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[9px]"
          data-testid="resolved-image-size"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              {t("inspector.requestedSize")}
            </span>
            <span className="font-medium">
              {resolvedSize.value.requested.width} x{" "}
              {resolvedSize.value.requested.height}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              {t("inspector.actualRequestSize")}
            </span>
            <span className="font-semibold">
              {resolvedSize.value.providerSize}
            </span>
          </div>
          {resolvedSize.value.adjusted ? (
            <p className="mt-1.5 text-amber-700 dark:text-amber-300">
              {t("inspector.sizeAdjusted")}
            </p>
          ) : null}
        </div>
      ) : resolvedSize ? (
        <p className="text-[9px] text-destructive">{resolvedSize.message}</p>
      ) : null}
      <p className="text-[9px] leading-4 text-muted-foreground">
        {modelOffering
          ? t("inspector.costNotice", {
              credits: formatCreditMicros(modelOffering.price.unitCreditMicros),
              priceVersion: modelOffering.price.priceBookVersion,
            })
          : t("inspector.modelUnavailable")}
      </p>
      <Button
        type="button"
        size="sm"
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        disabled={!modelOffering}
        onClick={() => {
          commitPrompt()
          window.setTimeout(onRun, 0)
        }}
      >
        <SparklesIcon className="size-3.5" />
        {t("inspector.generateImage")}
      </Button>
    </div>
  )
}

function ImageInputHeader({
  label,
  mode,
  onChange,
}: {
  label: string
  mode: "variable" | "fixed"
  onChange: (mode: "variable" | "fixed") => void
}) {
  const t = useTranslations("Studio")
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] font-semibold">{label}</span>
      <div className="flex rounded-md bg-muted p-0.5">
        {(["variable", "fixed"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={cn(
              "rounded px-2 py-1 text-[9px] font-medium",
              mode === candidate
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            )}
            onClick={() => onChange(candidate)}
          >
            {t(
              `inspector.inputMode${candidate === "variable" ? "Variable" : "Fixed"}`
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function ImageNumberInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="text-[9px] font-medium text-muted-foreground">
      {label}
      <input
        type="number"
        min={1}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[10px] font-medium text-foreground outline-none focus:border-violet-500"
      />
    </label>
  )
}

function ImageConfigSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="text-[9px] font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[10px] font-medium text-foreground outline-none focus:border-violet-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function StartVariablesEditor({
  node,
  dispatch,
}: {
  node: WorkflowNodeDraft
  dispatch: (payload: MusesCommandPayload) => void
}) {
  const t = useTranslations("Studio")
  if (node.data.kind !== "start") return null
  const variables = node.data.variables

  const setVariables = (nextVariables: typeof variables) =>
    dispatch({
      type: "workflow.start.variables.set",
      nodeId: node.id,
      variables: nextVariables,
    })

  const updateVariable = (
    index: number,
    update: Partial<(typeof variables)[number]>
  ) =>
    setVariables(
      variables.map((variable, candidateIndex) =>
        candidateIndex === index ? { ...variable, ...update } : variable
      )
    )

  const addVariable = () => {
    let sequence = variables.length + 1
    while (variables.some((variable) => variable.id === `input_${sequence}`)) {
      sequence += 1
    }
    setVariables([
      ...variables,
      {
        id: `input_${sequence}`,
        name: `input_${sequence}`,
        valueType: "text",
        required: false,
        defaultValue: "",
      },
    ])
  }

  return (
    <div className="space-y-2.5" data-testid="start-variable-editor">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold">
            {t("inspector.startVariables")}
          </p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            {t("inspector.startVariablesHint")}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addVariable}>
          <PlusIcon className="size-3.5" />
          {t("inspector.addVariable")}
        </Button>
      </div>
      {variables.map((variable, index) => (
        <div
          key={variable.id}
          className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5"
        >
          <div className="flex items-center gap-2">
            <Input
              key={`${variable.id}-${variable.name}`}
              defaultValue={variable.name}
              aria-label={t("inspector.variableName")}
              className="h-8 flex-1 text-[11px]"
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name && name !== variable.name) {
                  updateVariable(index, { name })
                }
              }}
            />
            <select
              value={variable.valueType}
              aria-label={t("inspector.variableType")}
              className="h-8 rounded-md border border-input bg-background px-2 text-[10px]"
              onChange={(event) => {
                const valueType = event.target.value as WorkflowInputValueType
                updateVariable(index, {
                  valueType,
                  defaultValue: defaultWorkflowInputValue(valueType),
                })
              }}
            >
              {(["text", "number", "boolean"] as const).map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t("inspector.removeVariable")}
              title={t("inspector.removeVariable")}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() =>
                setVariables(
                  variables.filter(
                    (_, candidateIndex) => candidateIndex !== index
                  )
                )
              }
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <WorkflowInputDefaultEditor
              variable={variable}
              onChange={(defaultValue) =>
                updateVariable(index, { defaultValue })
              }
            />
            <label className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[9px]">
              <input
                type="checkbox"
                checked={variable.required}
                onChange={(event) =>
                  updateVariable(index, { required: event.target.checked })
                }
              />
              {t("inspector.required")}
            </label>
          </div>
          <p className="font-mono text-[8px] text-muted-foreground">
            {variable.id}
          </p>
        </div>
      ))}
    </div>
  )
}

function WorkflowInputDefaultEditor({
  variable,
  onChange,
}: {
  variable: Extract<
    WorkflowNodeDraft["data"],
    { kind: "start" }
  >["variables"][number]
  onChange: (value: string | number | boolean | undefined) => void
}) {
  const t = useTranslations("Studio")
  if (variable.valueType === "boolean") {
    return (
      <select
        value={String(variable.defaultValue ?? false)}
        aria-label={t("inspector.defaultValue")}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[10px]"
        onChange={(event) => onChange(event.target.value === "true")}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  return (
    <Input
      type={variable.valueType === "number" ? "number" : "text"}
      value={String(variable.defaultValue ?? "")}
      aria-label={t("inspector.defaultValue")}
      placeholder={t("inspector.defaultValue")}
      className="h-8 min-w-0 flex-1 text-[10px]"
      onChange={(event) =>
        onChange(
          variable.valueType === "number"
            ? event.target.value === ""
              ? undefined
              : Number(event.target.value)
            : event.target.value
        )
      }
    />
  )
}

function defaultWorkflowInputValue(type: WorkflowInputValueType) {
  if (type === "number") return 0
  if (type === "boolean") return false
  return ""
}

function ImageRunDetails({
  job,
  locale,
  node,
  workspace,
}: {
  job?: JobDraft
  locale: string
  node: WorkflowNodeDraft
  workspace: MusesWorkspaceDraft
}) {
  const t = useTranslations("Studio")
  const prompt = resolveImageGeneratorPrompt(workspace, node.id)

  return (
    <InspectorSection title={t("inspector.runDetails")}>
      <div
        data-testid={`job-details-${node.id}`}
        className="space-y-3 rounded-xl border border-border bg-muted/20 p-3"
      >
        <div>
          <p className="text-[9px] font-medium text-muted-foreground">
            {t("inspector.actualPrompt")}
          </p>
          <p className="mt-1.5 max-h-24 overflow-y-auto rounded-lg bg-background px-2.5 py-2 text-[10px] leading-4">
            {prompt}
          </p>
        </div>
        {job ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <RunMetric
                label={t("inspector.jobStatus")}
                value={t(`inspector.jobStatuses.${job.status}`)}
              />
              <RunMetric
                label={t("inspector.outputAssets")}
                value={String(job.outputAssetIds.length)}
              />
              <RunMetric
                label={t("inspector.duration")}
                value={formatJobDuration(job, t)}
              />
              <RunMetric
                label={t("inspector.credits")}
                value={t("inspector.creditValue", {
                  count: job.costCredits,
                })}
              />
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <KeyValue
                label={t("inspector.startedAt")}
                value={formatJobTime(job.createdAt, locale)}
              />
              <KeyValue
                label={t("inspector.completedAt")}
                value={
                  job.completedAt
                    ? formatJobTime(job.completedAt, locale)
                    : t("inspector.pending")
                }
              />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-3 text-[10px] text-muted-foreground">
            <CircleDotIcon className="size-3.5 text-slate-400" />
            {t("inspector.notRunYet")}
          </div>
        )}
      </div>
    </InspectorSection>
  )
}

function RunMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background px-2.5 py-2">
      <p className="text-[8px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[10px] font-semibold">{value}</p>
    </div>
  )
}

function resolveImageGeneratorPrompt(
  workspace: MusesWorkspaceDraft,
  generatorNodeId: string
) {
  const promptEdge = workspace.workflow.edges.find(
    (edge) =>
      edge.kind === "dataflow" &&
      edge.targetNodeId === generatorNodeId &&
      edge.targetPortId === "prompt"
  )
  const sourceNode = promptEdge
    ? workspace.workflow.nodes.find(
        (node) => node.id === promptEdge.sourceNodeId
      )
    : undefined
  if (sourceNode?.data.kind === "start") {
    const variable = sourceNode.data.variables.find(
      (candidate) => candidate.id === promptEdge?.sourcePortId
    )
    return typeof variable?.defaultValue === "string"
      ? variable.defaultValue.trim() || "—"
      : "—"
  }
  return "—"
}

type GeneratedImageAsset = NonNullable<
  Extract<WorkflowRuntimeValue, { valueType: "image" }>["assets"]
>[number]

function generatedImageDownloadHref(asset: GeneratedImageAsset) {
  const query = new URLSearchParams({
    workspaceId: asset.source.workspaceId,
    runId: asset.source.runId,
  })
  return `/api/studio/generated-images/${encodeURIComponent(asset.id)}?${query}`
}

function generatedImageFilename(asset: GeneratedImageAsset) {
  const extension =
    asset.mimeType === "image/jpeg"
      ? "jpg"
      : asset.mimeType === "image/webp"
        ? "webp"
        : "png"
  return `${asset.id}.${extension}`
}

function formatJobTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value))
}

function formatJobDuration(
  job: JobDraft,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (!job.completedAt) return t("inspector.pending")
  const duration = Math.max(
    0,
    new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()
  )
  if (duration < 1000) {
    return t("inspector.durationMs", { count: duration })
  }
  return t("inspector.durationSeconds", {
    count: Math.round(duration / 100) / 10,
  })
}

function DurableRunPanel({
  projection,
  resumingAssetId,
  cancelling,
  retrying,
  onSelect,
  onCancel,
  onRetry,
}: {
  projection: DurableRunProjection
  resumingAssetId: string | null
  cancelling: boolean
  retrying: boolean
  onSelect: (assetId: string) => void
  onCancel: () => void
  onRetry: () => void
}) {
  const t = useTranslations("Studio")
  const documentOutput = projection.result?.outputs.document
  const designDocument =
    documentOutput?.valueType === "design-document" ? documentOutput : undefined
  const imageOutput = projection.result?.outputs.image
  const generatedImages =
    imageOutput?.valueType === "image" ? imageOutput.assets || [] : []
  const statusLabel =
    projection.status === "waiting"
      ? t("durableRun.waiting")
      : projection.status === "completed"
        ? t("durableRun.completed")
        : projection.status === "cancelled"
          ? t("durableRun.cancelled")
          : projection.status === "failed"
            ? t("durableRun.failed")
            : t("durableRun.running")
  const cancellable =
    projection.status === "pending" ||
    projection.status === "running" ||
    projection.status === "waiting"
  const retryable =
    projection.status === "failed" && Boolean(projection.failure?.retryable)

  return (
    <aside
      data-testid="durable-run-panel"
      className="absolute top-14 right-3 z-20 max-h-[calc(100%-76px)] w-[min(440px,calc(100%-24px))] overflow-y-auto rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-foreground">
            {t("durableRun.title")}
          </div>
          <div className="mt-0.5 text-[9px] text-muted-foreground">
            {generatedImages.length > 0
              ? t("durableRun.imageGeneration")
              : t("durableRun.creativeWorkflow")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {retryable ? (
            <button
              type="button"
              data-testid="durable-run-retry"
              disabled={retrying}
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[9px] font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCwIcon
                className={cn("size-2.5", retrying && "animate-spin")}
              />
              {retrying ? t("durableRun.retrying") : t("durableRun.retryRun")}
            </button>
          ) : null}
          {cancellable ? (
            <button
              type="button"
              data-testid="durable-run-cancel"
              disabled={cancelling || Boolean(resumingAssetId)}
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[9px] font-medium text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:cursor-wait disabled:opacity-60"
            >
              <XIcon className="size-2.5" />
              {cancelling
                ? t("durableRun.cancelling")
                : t("durableRun.cancelRun")}
            </button>
          ) : null}
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[9px] font-medium text-muted-foreground">
            <CircleDotIcon
              className={cn(
                "size-2.5",
                projection.status === "completed"
                  ? "text-emerald-500"
                  : projection.status === "waiting"
                    ? "text-amber-500"
                    : projection.status === "cancelled" ||
                        projection.status === "failed"
                      ? "text-rose-500"
                      : "text-violet-500"
              )}
            />
            {statusLabel}
          </span>
        </div>
      </div>

      {projection.observability ? (
        <DurableRunObservability
          projection={projection.observability}
          runStatus={projection.status}
        />
      ) : null}

      {projection.suspension ? (
        <div className="mt-3" data-testid="durable-run-suspension">
          <p className="text-[10px] leading-4 text-muted-foreground">
            {t("durableRun.selectionHint")}
          </p>
          <div className="mt-2 grid gap-1.5">
            {projection.suspension.candidateAssets.map((asset, index) => (
              <button
                key={asset.assetId}
                type="button"
                data-testid={`server-harness-candidate-${index + 1}`}
                disabled={Boolean(resumingAssetId) || cancelling}
                onClick={() => onSelect(asset.assetId)}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-2.5 py-2 text-left hover:border-violet-400 hover:bg-violet-500/5 disabled:cursor-wait disabled:opacity-60"
              >
                <span>
                  <span className="block text-[10px] font-medium text-foreground">
                    {t("durableRun.direction", { count: index + 1 })}
                  </span>
                  <span className="block text-[8px] text-muted-foreground">
                    {t("durableRun.serverReference")}
                  </span>
                </span>
                <span className="rounded-md bg-violet-500/10 px-2 py-1 text-[9px] font-semibold text-violet-700 dark:text-violet-200">
                  {resumingAssetId === asset.assetId
                    ? t("durableRun.resuming")
                    : t("durableRun.choose")}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {generatedImages.length > 0 ? (
        <div className="mt-3 space-y-3" data-testid="durable-run-images">
          {generatedImages.map((asset, index) => (
            <figure
              key={asset.id}
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              <a href={asset.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.url}
                  alt={asset.prompt}
                  className="max-h-[420px] w-full bg-muted object-contain"
                />
              </a>
              <figcaption className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-foreground">
                    {generatedImages.length > 1
                      ? t("durableRun.generatedImageNumber", {
                          count: index + 1,
                        })
                      : t("durableRun.generatedImage")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">
                    {asset.prompt}
                  </p>
                  <p className="mt-1 text-[8px] text-muted-foreground">
                    {formatModelRefLabel(asset.modelRef)} · {asset.width} ×{" "}
                    {asset.height}
                  </p>
                </div>
                <a
                  href={generatedImageDownloadHref(asset)}
                  download={generatedImageFilename(asset)}
                  className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
                  aria-label={t("durableRun.downloadImage")}
                  title={t("durableRun.downloadImage")}
                >
                  <DownloadIcon className="size-3.5" />
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {projection.attempts.length > 0 ? (
        <details className="mt-3" data-testid="durable-run-attempts">
          <summary className="cursor-pointer text-[9px] font-medium text-muted-foreground">
            {t("durableRun.executionDetails")}
          </summary>
          <div className="mt-2 grid gap-1.5">
            {projection.attempts.map((attempt) => (
              <div
                key={attempt.nodeId}
                data-testid={`durable-run-attempt-${attempt.nodeId}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/35 px-2.5 py-1.5 text-[9px]"
              >
                <span className="truncate font-medium text-foreground">
                  {durableNodeKindLabel(attempt.nodeKind, t)}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {t("durableRun.attempt", {
                    attempt: attempt.attempt,
                    maxAttempts: attempt.maxAttempts,
                  })}
                  {" · "}
                  {attempt.status === "succeeded"
                    ? t("durableRun.attemptSucceeded")
                    : attempt.status === "retrying"
                      ? t("durableRun.attemptRetrying")
                      : attempt.status === "failed"
                        ? t("durableRun.attemptFailed")
                        : t("durableRun.attemptRunning")}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {projection.failure ? (
        <div
          data-testid="durable-run-failure"
          className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/5 p-2.5"
        >
          <div className="text-[10px] font-semibold text-rose-700 dark:text-rose-300">
            {t("durableRun.failureTitle")}
          </div>
          <p className="mt-1 text-[9px] leading-4 text-foreground">
            {projection.failure.message}
          </p>
        </div>
      ) : null}

      {designDocument ? (
        <div
          data-testid="durable-run-output"
          className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckIcon className="size-3" />
            {t("durableRun.typedOutput")}
          </div>
          <div className="mt-1 font-mono text-[9px] text-foreground">
            {designDocument.documentId} · r{designDocument.revision}
          </div>
        </div>
      ) : null}
    </aside>
  )
}

function DurableRunObservability({
  projection,
  runStatus,
}: {
  projection: DurableRunObservabilityProjection
  runStatus: DurableRunProjection["status"]
}) {
  const t = useTranslations("Studio")
  const locale = useLocale()
  const terminal =
    runStatus === "completed" ||
    runStatus === "failed" ||
    runStatus === "cancelled"
  const displayedCredits = terminal
    ? projection.totals.actualMicros
    : projection.totals.estimatedMicros

  return (
    <section
      data-testid="durable-run-observability"
      className="mt-3 border-y border-border"
    >
      <div className="grid grid-cols-3 divide-x divide-border py-2.5">
        <RunSummaryMetric
          label={t("durableRun.duration")}
          value={formatRunDuration(projection.run.durationMs, t)}
        />
        <RunSummaryMetric
          label={t("durableRun.outputs")}
          value={t("durableRun.imageCount", {
            count: projection.totals.imageCount,
          })}
        />
        <RunSummaryMetric
          label={
            terminal
              ? t("durableRun.actualCredits")
              : t("durableRun.estimatedCredits")
          }
          value={formatCreditMicros(displayedCredits)}
        />
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border py-2 text-[8px] text-muted-foreground">
        <span>
          {t("durableRun.startedAt")}{" "}
          {formatRunTimestamp(projection.run.startedAt, locale, t)}
        </span>
        <span>
          {t("durableRun.completedAt")}{" "}
          {formatRunTimestamp(projection.run.completedAt, locale, t)}
        </span>
      </div>

      <div className="divide-y divide-border border-t border-border">
        {projection.nodes.map((node) => (
          <div
            key={node.nodeId}
            data-testid={`durable-run-node-${node.nodeId}`}
            className="py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold text-foreground">
                  {durableNodeKindLabel(node.nodeKind, t)}
                </p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">
                  {formatRunDuration(node.durationMs, t)}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-[8px] font-medium",
                  node.status === "succeeded"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : node.status === "failed" || node.status === "cancelled"
                      ? "text-rose-600 dark:text-rose-400"
                      : node.status === "waiting"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                )}
              >
                {durableNodeStatusLabel(node.status, t)}
              </span>
            </div>

            {node.inputSummary.length > 0 ? (
              <RunValueSummary
                label={t("durableRun.actualInput")}
                locale={locale}
                values={node.inputSummary}
              />
            ) : null}
            {node.outputSummary.length > 0 ? (
              <RunValueSummary
                label={t("durableRun.nodeOutput")}
                locale={locale}
                values={node.outputSummary}
              />
            ) : null}

            {node.model ? (
              <div className="mt-2 space-y-1 text-[8px] text-muted-foreground">
                <KeyValue
                  label={t("durableRun.model")}
                  value={`${formatModelRefLabel(node.model.modelRef)} · ${node.model.modelRef}`}
                />
                {node.model.capabilityProfile ? (
                  <KeyValue
                    label={t("durableRun.capabilityProfile")}
                    value={`${node.model.capabilityProfile.id} · ${node.model.capabilityProfile.version}`}
                  />
                ) : null}
                {node.model.resolvedSize ? (
                  <KeyValue
                    label={t("durableRun.requestSize")}
                    value={formatRunSize(node.model, t)}
                  />
                ) : null}
                {node.model.priceBook ? (
                  <KeyValue
                    label={t("durableRun.pricingVersion")}
                    value={`${node.model.priceBook.version} · ${formatCreditMicros(node.model.priceBook.unitCreditMicros)}/${t("durableRun.perImage")}`}
                  />
                ) : null}
              </div>
            ) : null}

            {node.usage ? (
              <div className="mt-2 text-[8px] text-muted-foreground">
                <KeyValue
                  label={t("durableRun.usage")}
                  value={formatRunUsage(node.usage, locale, t)}
                />
              </div>
            ) : null}
            {node.billing ? (
              <div className="mt-1 text-[8px] text-muted-foreground">
                <KeyValue
                  label={t("durableRun.credits")}
                  value={t("durableRun.creditComparison", {
                    actual: formatCreditMicros(node.billing.actualMicros),
                    estimated: formatCreditMicros(node.billing.estimatedMicros),
                  })}
                />
              </div>
            ) : null}
            {node.error ? (
              <p className="mt-2 text-[9px] leading-4 text-rose-700 dark:text-rose-300">
                {node.error.message}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function RunSummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 first:pl-0 last:pr-0">
      <p className="text-[8px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[10px] font-semibold text-foreground">
        {value}
      </p>
    </div>
  )
}

function RunValueSummary({
  label,
  locale,
  values,
}: {
  label: string
  locale: string
  values: DurableRunValueSummary[]
}) {
  const t = useTranslations("Studio")
  return (
    <dl className="mt-2 space-y-1.5 border-l-2 border-border pl-2.5">
      {values.map((value) => (
        <div key={`${value.portId}:${value.valueType}`}>
          <dt className="text-[8px] font-medium text-muted-foreground">
            {label} · {portDisplayLabel(value.portId, t)}
          </dt>
          <dd
            className={cn(
              "mt-0.5 text-[9px] leading-4 text-foreground",
              value.valueType === "text" &&
                "max-h-24 overflow-y-auto whitespace-pre-wrap"
            )}
          >
            {formatRunValueSummary(value, locale, t)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function formatRunValueSummary(
  value: DurableRunValueSummary,
  locale: string,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  switch (value.valueType) {
    case "text":
      return `${value.value}${value.truncated ? "..." : ""}`
    case "number":
      return new Intl.NumberFormat(locale).format(value.value)
    case "boolean":
      return value.value ? t("durableRun.true") : t("durableRun.false")
    case "image":
      return t("durableRun.imageCount", { count: value.count })
    case "design-document":
      return `${value.documentId} · r${value.revision}`
  }
}

function formatRunUsage(
  usage: DurableRunObservabilityProjection["nodes"][number]["usage"],
  locale: string,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (!usage) return t("durableRun.notAvailable")
  const imageUsage = t("durableRun.imageCount", { count: usage.imageCount })
  if (usage.tokenStatus === "not-reported") {
    return `${imageUsage} · ${t("durableRun.tokensNotReported")}`
  }
  const tokens =
    usage.totalTokens ??
    (usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : (usage.inputTokens ?? usage.outputTokens))
  return tokens === undefined
    ? `${imageUsage} · ${t("durableRun.tokensNotReported")}`
    : `${imageUsage} · ${t("durableRun.tokenCount", {
        count: new Intl.NumberFormat(locale).format(tokens),
      })}`
}

function formatRunSize(
  model: NonNullable<
    DurableRunObservabilityProjection["nodes"][number]["model"]
  >,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (!model.resolvedSize) return t("durableRun.notAvailable")
  const resolved = `${model.resolvedSize.width} × ${model.resolvedSize.height}`
  if (!model.requestedSize || !model.resolvedSize.adjusted) return resolved
  return t("durableRun.adjustedSize", {
    requested: `${model.requestedSize.width} × ${model.requestedSize.height}`,
    resolved,
  })
}

function formatRunTimestamp(
  value: string | undefined,
  locale: string,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (!value) return t("durableRun.pending")
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return t("durableRun.notAvailable")
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date)
}

function formatRunDuration(
  value: number | undefined,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (value === undefined) return t("durableRun.pending")
  if (value < 1_000) return t("durableRun.durationMs", { count: value })
  if (value < 60_000) {
    return t("durableRun.durationSeconds", {
      count: Math.round(value / 100) / 10,
    })
  }
  return t("durableRun.durationMinutes", {
    count: Math.round(value / 6_000) / 10,
  })
}

function durableNodeKindLabel(
  kind: string,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  switch (kind) {
    case "start":
      return t("nodes.start.title")
    case "image-generator":
      return t("nodes.imageGenerator.title")
    case "selector":
      return t("nodes.selector.title")
    case "design-document":
      return t("nodes.designDocument.title")
    case "end":
      return t("nodes.end.title")
    default:
      return kind
  }
}

function durableNodeStatusLabel(
  status: DurableRunObservabilityProjection["nodes"][number]["status"],
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  switch (status) {
    case "succeeded":
      return t("durableRun.nodeSucceeded")
    case "failed":
      return t("durableRun.nodeFailed")
    case "cancelled":
      return t("durableRun.nodeCancelled")
    case "waiting":
      return t("durableRun.nodeWaiting")
    case "running":
      return t("durableRun.nodeRunning")
  }
}

function ProfessionalToolbar({
  inputMode,
  lastRunId,
  miniMapVisible,
  onAddNode,
  onInputModeChange,
  onMiniMapToggle,
  onPublish,
  publishing,
}: {
  inputMode: CanvasInputMode
  lastRunId: string | null
  miniMapVisible: boolean
  onAddNode: () => void
  onInputModeChange: (mode: CanvasInputMode) => void
  onMiniMapToggle: () => void
  onPublish: () => void
  publishing: boolean
}) {
  const t = useTranslations("Studio")
  const { fitView, zoomIn, zoomOut } = useReactFlow<MusesFlowNode>()
  const { zoom } = useViewport()
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
      <div className="pointer-events-auto flex h-10 items-center gap-1 rounded-xl border border-border bg-background/95 px-1.5 shadow-lg backdrop-blur">
        <ToolbarIconButton
          active={inputMode === "mouse"}
          label={t("canvas.mouseMode")}
          onClick={() => onInputModeChange("mouse")}
        >
          <MousePointer2Icon className="size-3.5" />
        </ToolbarIconButton>
        <ToolbarIconButton
          active={inputMode === "trackpad"}
          label={t("canvas.trackpadMode")}
          onClick={() => onInputModeChange("trackpad")}
        >
          <HandIcon className="size-3.5" />
        </ToolbarIconButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarIconButton
          label={t("canvas.zoomOut")}
          onClick={() => void zoomOut({ duration: 120 })}
        >
          <MinusIcon className="size-3.5" />
        </ToolbarIconButton>
        <button
          type="button"
          className="min-w-12 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => void fitView({ duration: 160, padding: 0.2 })}
          title={t("canvas.fit")}
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarIconButton
          label={t("canvas.zoomIn")}
          onClick={() => void zoomIn({ duration: 120 })}
        >
          <PlusIcon className="size-3.5" />
        </ToolbarIconButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarIconButton
          active={miniMapVisible}
          label={t("canvas.minimap")}
          onClick={onMiniMapToggle}
        >
          <MapIcon className="size-3.5" />
        </ToolbarIconButton>
        <button
          type="button"
          onClick={onAddNode}
          className="ml-1 flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/8 px-2.5 py-1.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-500/15 dark:text-violet-200"
          title={t("canvas.addNode")}
        >
          <PlusIcon className="size-3.5" />
          {t("canvas.addNode")}
        </button>
      </div>
      <button
        type="button"
        onClick={onPublish}
        disabled={publishing}
        className="pointer-events-auto flex h-10 items-center gap-2 rounded-xl border border-emerald-600 bg-emerald-600 px-4 text-[11px] font-semibold text-white shadow-lg hover:bg-emerald-700"
        title={t("header.runHint")}
      >
        <PlayIcon className="size-3.5 fill-current" />
        {publishing ? t("header.publishing") : t("header.publish")}
        <span className="rounded bg-white/15 px-1.5 py-0.5 text-[9px]">
          {lastRunId ? t("header.durable") : t("header.validate")}
        </span>
      </button>
    </div>
  )
}

function ToolbarIconButton({
  active = false,
  children,
  label,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        active && "bg-muted text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function ResultGallery({
  nodes,
  workspace,
  onSelect,
}: {
  nodes: WorkflowNodeDraft[]
  workspace: MusesWorkspaceDraft
  onSelect: (nodeId: string) => void
}) {
  const t = useTranslations("Studio")
  return (
    <div className="grid grid-cols-2 gap-2">
      {nodes.map((node) => {
        if (node.data.kind !== "image-result") return null
        const asset = workspace.assets[node.data.assetId]
        return (
          <button
            type="button"
            key={node.id}
            data-testid={`workflow-result-${node.id}`}
            onClick={() => onSelect(node.id)}
            className={cn(
              "group overflow-hidden rounded-lg border text-left transition-colors hover:border-amber-500/65",
              node.data.selected
                ? "border-amber-500 ring-2 ring-amber-500/10"
                : "border-border"
            )}
          >
            <div className="relative aspect-video overflow-hidden bg-muted">
              {asset ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.dataUri}
                  alt={node.data.variantLabel}
                  className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                />
              ) : null}
              {node.data.selected ? (
                <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-amber-400 text-amber-950">
                  <CheckIcon className="size-3" />
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="truncate text-[9px] font-medium">
                {node.data.variantLabel}
              </span>
              <span className="shrink-0 text-[8px] text-muted-foreground">
                {node.data.selected
                  ? t("nodes.selectedShort")
                  : t("nodes.chooseShort")}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function InspectorSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <p className="mb-3 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[10px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right break-all">{value}</span>
    </div>
  )
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/25 px-3 py-2.5">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[11px] font-medium">{value}</p>
    </div>
  )
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof RotateCcwIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={label}
      title={label}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

function portDisplayLabel(
  portId: string,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  return t.has(`ports.${portId}`) ? t(`ports.${portId}`) : portId
}

function nodeCopyKey(kind: WorkflowNodeKind) {
  return {
    start: "start",
    "image-generator": "imageGenerator",
    "image-result": "imageResult",
    selector: "selector",
    "design-document": "designDocument",
    end: "end",
  }[kind] as
    | "start"
    | "imageGenerator"
    | "imageResult"
    | "selector"
    | "designDocument"
    | "end"
}

function nodeDisplayTitle(
  node: WorkflowNodeDraft,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  if (node.data.kind === "image-result") {
    return t("nodes.imageResult.title", {
      number: node.title.match(/\d+/)?.[0] || "—",
    })
  }
  return t(`nodes.${nodeCopyKey(node.kind)}.title`)
}

function getModelDisplayName(
  node: WorkflowNodeDraft,
  catalog: ModelCatalogProjection
) {
  if (node.data.kind !== "image-generator") return undefined
  const modelRef = node.data.modelRef
  return catalog.offerings.find((offering) => offering.modelRef === modelRef)
    ?.displayName
}
