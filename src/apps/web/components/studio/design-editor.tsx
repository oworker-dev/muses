"use client"

import {
  ArrowLeftIcon,
  ImageIcon,
  Layers3Icon,
  MoveIcon,
  TypeIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva"

import type {
  AssetDraft,
  DesignDocumentDraft,
  DesignElement,
  MusesCommandPayload,
} from "@muses/domain"

type DesignEditorProps = {
  assets: Record<string, AssetDraft>
  document: DesignDocumentDraft
  onClose: () => void
  onDispatch: (payload: MusesCommandPayload) => void
}

export default function DesignEditor({
  assets,
  document,
  onClose,
  onDispatch,
}: DesignEditorProps) {
  const t = useTranslations("Studio")
  const background = document.backgroundAssetId
    ? assets[document.backgroundAssetId]
    : undefined
  const image = useLoadedImage(background?.dataUri)
  const textElements = document.elements.filter(
    (element) => element.kind === "text"
  )

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex h-15 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("design.back")}
          >
            <ArrowLeftIcon className="size-4" />
          </button>
          <div>
            <p className="text-[9px] font-semibold tracking-[0.16em] text-rose-700 uppercase dark:text-rose-300">
              {t("design.documentKind")}
            </p>
            <h1 className="text-sm font-semibold">{document.title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="rounded-lg border border-border bg-muted/50 px-2.5 py-1.5">
            960 × 540
          </span>
          <span className="rounded-lg border border-border bg-muted/50 px-2.5 py-1.5">
            {t("design.revision", { revision: document.revision })}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r border-border bg-card/70 p-4">
          <PanelTitle icon={Layers3Icon} label={t("design.layers")} />
          <div className="mt-4 space-y-2">
            {document.elements
              .slice()
              .reverse()
              .map((element) => (
                <div
                  key={element.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-muted-foreground"
                >
                  {element.kind === "text" ? (
                    <TypeIcon className="size-3.5 text-rose-600 dark:text-rose-300" />
                  ) : element.kind === "image" ? (
                    <ImageIcon className="size-3.5 text-sky-600 dark:text-sky-300" />
                  ) : (
                    <span className="size-3.5 rounded border border-amber-500/50" />
                  )}
                  <span className="truncate">{element.id}</span>
                </div>
              ))}
          </div>
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-3 text-[10px] leading-5 text-muted-foreground">
            <MoveIcon className="mb-2 size-4" />
            {t("design.moveHint")}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto bg-muted/30 p-8">
          <div className="mx-auto w-fit rounded-xl border border-border bg-slate-950 p-2 shadow-[0_28px_90px_rgba(15,23,42,0.20)] dark:shadow-[0_35px_120px_rgba(0,0,0,0.55)]">
            <Stage width={document.width} height={document.height}>
              <Layer>
                <Rect
                  width={document.width}
                  height={document.height}
                  fill="#171927"
                />
                {image ? (
                  <KonvaImage
                    image={image}
                    x={0}
                    y={0}
                    width={document.width}
                    height={document.height}
                  />
                ) : null}
                {document.elements
                  .filter((element) => element.kind !== "image")
                  .map((element) => (
                    <EditableElement
                      key={element.id}
                      element={element}
                      onMove={(position) =>
                        onDispatch({
                          type: "design.element.move",
                          documentId: document.id,
                          elementId: element.id,
                          position,
                        })
                      }
                    />
                  ))}
              </Layer>
            </Stage>
          </div>
        </main>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-card/70 p-4">
          <PanelTitle icon={TypeIcon} label={t("design.textContent")} />
          <div className="mt-4 space-y-4">
            {textElements.map((element) => (
              <label key={element.id} className="block">
                <span className="mb-2 block text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {element.id}
                </span>
                <textarea
                  value={element.text}
                  onChange={(event) =>
                    onDispatch({
                      type: "design.text.update",
                      documentId: document.id,
                      elementId: element.id,
                      text: event.target.value,
                    })
                  }
                  rows={element.id === "headline" ? 3 : 4}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-xs leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </label>
            ))}
          </div>
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {t("design.backgroundAsset")}
            </p>
            <p className="mt-2 text-[10px] leading-5 break-all text-muted-foreground">
              {document.backgroundAssetId || t("design.noBackground")}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function EditableElement({
  element,
  onMove,
}: {
  element: Exclude<DesignElement, { kind: "image" }>
  onMove: (position: { x: number; y: number }) => void
}) {
  if (element.kind === "shape") {
    return (
      <Rect
        draggable
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        fill={element.fill}
        cornerRadius={element.cornerRadius}
        onDragEnd={(event) =>
          onMove({ x: event.target.x(), y: event.target.y() })
        }
      />
    )
  }
  return (
    <Text
      draggable
      x={element.x}
      y={element.y}
      width={element.width}
      text={element.text}
      fontSize={element.fontSize}
      fill={element.fill}
      fontStyle={element.fontWeight}
      onDragEnd={(event) =>
        onMove({ x: event.target.x(), y: event.target.y() })
      }
    />
  )
}

function useLoadedImage(src?: string) {
  const [loaded, setLoaded] = useState<{
    src: string
    image: HTMLImageElement
  } | null>(null)
  useEffect(() => {
    if (!src) return
    const next = new window.Image()
    next.onload = () => setLoaded({ src, image: next })
    next.src = src
    return () => {
      next.onload = null
    }
  }, [src])
  return loaded && loaded.src === src ? loaded.image : null
}

function PanelTitle({
  icon: Icon,
  label,
}: {
  icon: typeof Layers3Icon
  label: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold">
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </div>
  )
}
