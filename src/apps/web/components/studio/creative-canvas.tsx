"use client"

import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react"
import {
  Controls,
  Handle,
  MiniMap,
  Position,
  useNodesState,
} from "@xyflow/react"
import {
  BotIcon,
  DownloadIcon,
  FileIcon,
  ImageIcon,
  Layers3Icon,
  WorkflowIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { memo, useMemo } from "react"

import type { CreativeCanvasItem } from "@muses/domain"

import { Canvas } from "@/components/ai-elements/canvas"
import type {
  CreativeCanvasAssetProjection,
  CreativeCanvasProjection,
} from "@/lib/creative-canvas-projection"
import { cn } from "@/lib/utils"

type CreativeItemNodeData = {
  item: CreativeCanvasItem
  asset?: CreativeCanvasAssetProjection
}

type CreativeItemNode = Node<CreativeItemNodeData, "creative-item">

const creativeItemIcons = {
  asset: ImageIcon,
  artifact: FileIcon,
  "professional-document": Layers3Icon,
  workflow: WorkflowIcon,
  "agent-run": BotIcon,
} satisfies Record<CreativeCanvasItem["kind"], typeof ImageIcon>

export function CreativeCanvasView({
  projection,
  onMoveItem,
}: {
  projection: CreativeCanvasProjection
  onMoveItem: (itemId: string, position: { x: number; y: number }) => void
}) {
  const t = useTranslations("Studio.creativeCanvas")
  const initialNodes = useMemo(
    () =>
      projection.canvas.items.map(
        (item): CreativeItemNode => ({
          id: item.id,
          type: "creative-item",
          position: item.position,
          data: { item, asset: projection.assets[item.refId] },
          style: creativeItemDimensions(item),
        })
      ),
    [projection]
  )
  const [nodes, , onNodesChange] = useNodesState<CreativeItemNode>(initialNodes)
  const edges = useMemo<Edge[]>(
    () =>
      projection.canvas.relations.map((relation) => ({
        id: relation.id,
        source: relation.sourceItemId,
        target: relation.targetItemId,
        type: "smoothstep",
        animated: relation.kind === "provenance",
        label: t(`relations.${relation.kind}`),
        style: { stroke: "var(--muted-foreground)", strokeWidth: 1.25 },
      })),
    [projection.canvas.relations, t]
  )

  return (
    <div className="size-full" data-testid="creative-canvas">
      <Canvas<CreativeItemNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => onMoveItem(node.id, node.position)}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.15}
        maxZoom={2.2}
        fitView
        fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
      >
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor="var(--foreground)"
          maskColor="var(--muses-minimap-mask)"
          className="!right-3 !bottom-3 !m-0 !rounded-lg !border !border-border !bg-background !shadow-sm"
        />
        <Controls
          position="bottom-center"
          showInteractive={false}
          className="!m-3 !overflow-hidden !rounded-lg !border !border-border !bg-background !shadow-sm"
        />
        {nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="grid justify-items-center gap-2 text-muted-foreground">
              <ImageIcon className="size-6" />
              <span className="text-[13px] font-medium">{t("empty")}</span>
            </div>
          </div>
        ) : null}
      </Canvas>
    </div>
  )
}

const CreativeItemCard = memo(function CreativeItemCard({
  data,
  selected,
}: NodeProps<CreativeItemNode>) {
  const t = useTranslations("Studio.creativeCanvas")
  const { item, asset } = data
  const Icon = creativeItemIcons[item.kind]

  return (
    <article
      data-testid={`creative-canvas-item-${item.id}`}
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-lg border bg-card shadow-[0_10px_32px_rgba(15,23,42,0.12)]",
        selected
          ? "border-foreground ring-2 ring-foreground/10"
          : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !opacity-0"
      />
      {asset ? (
        <div className="min-h-0 flex-1 bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.imageUrl}
            alt={item.title}
            className="size-full object-contain"
            draggable={false}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center bg-muted/40 text-muted-foreground">
          <Icon className="size-8" />
        </div>
      )}
      <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground text-background">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{item.title}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {asset
              ? t("assetMeta", {
                  model: modelLabel(asset.modelRef),
                  width: asset.width,
                  height: asset.height,
                })
              : t(`itemKinds.${item.kind}`)}
          </p>
        </div>
        {asset ? (
          <a
            href={asset.imageUrl}
            download
            className="nodrag nopan grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("download")}
            title={t("download")}
          >
            <DownloadIcon className="size-3.5" />
          </a>
        ) : null}
      </footer>
    </article>
  )
})

const nodeTypes = {
  "creative-item": CreativeItemCard,
} satisfies NodeTypes

function creativeItemDimensions(item: CreativeCanvasItem) {
  const sourceWidth = item.size?.width || 320
  const sourceHeight = item.size?.height || 220
  const width = Math.min(480, Math.max(220, sourceWidth))
  const mediaHeight = Math.min(560, Math.max(160, sourceHeight))
  return { width, height: mediaHeight + 48 }
}

function modelLabel(modelRef: string) {
  return modelRef.split("/").at(-1)?.split("@")[0] || modelRef
}
