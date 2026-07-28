"use client"

import {
  BracesIcon,
  CheckIcon,
  ChevronDownIcon,
  SearchIcon,
  UnplugIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useMemo, useState } from "react"

import {
  formatVariableReference,
  getInputVariableReference,
  listAvailableWorkflowVariables,
  type PortSpec,
  type WorkflowDocumentDraft,
  type WorkflowVariableReference,
} from "@muses/domain"

import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function VariableBindingPicker({
  workflow,
  nodeId,
  port,
  onChange,
}: {
  workflow: WorkflowDocumentDraft
  nodeId: string
  port: PortSpec
  onChange: (reference: WorkflowVariableReference | null) => void
}) {
  const t = useTranslations("Studio")
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const variables = useMemo(
    () =>
      listAvailableWorkflowVariables(workflow, nodeId, port.id).map(
        (variable) => ({
          ...variable,
          nodeTitle: localizedNodeTitle(workflow, variable.nodeId, t),
          portLabel: t(`ports.${variable.portId}`),
        })
      ),
    [nodeId, port.id, t, workflow]
  )
  const current = getInputVariableReference(workflow, nodeId, port.id)
  const currentValue = current ? formatVariableReference(current) : null
  const currentVariable = currentValue
    ? variables.find(
        (variable) =>
          formatVariableReference(variable.reference) === currentValue
      )
    : undefined
  const portLabel = t(`ports.${port.id}`)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = variables.filter((variable) =>
    [
      variable.nodeTitle,
      variable.nodeId,
      variable.portLabel,
      variable.portId,
      variable.valueType,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )

  const groups = filtered.reduce<
    Array<{ nodeId: string; nodeTitle: string; variables: typeof filtered }>
  >((result, variable) => {
    const existing = result.find((group) => group.nodeId === variable.nodeId)
    if (existing) {
      existing.variables.push(variable)
    } else {
      result.push({
        nodeId: variable.nodeId,
        nodeTitle: variable.nodeTitle,
        variables: [variable],
      })
    }
    return result
  }, [])

  function select(reference: WorkflowVariableReference | null) {
    onChange(reference)
    setOpen(false)
    setQuery("")
  }

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-medium text-muted-foreground">
        {t("variables.field", { port: portLabel })}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 py-2 text-left text-[11px] hover:bg-accent"
            aria-label={t("variables.field", { port: portLabel })}
          >
            <span className="flex min-w-0 items-center gap-2">
              <BracesIcon className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
              <span
                className={cn(
                  "truncate",
                  currentValue ? "text-foreground" : "text-muted-foreground"
                )}
                title={currentValue || undefined}
              >
                {currentVariable
                  ? `${currentVariable.nodeTitle} · ${currentVariable.portLabel}`
                  : currentValue
                    ? t("variables.bound")
                    : t("variables.unbound")}
              </span>
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-2 p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("variables.search")}
              className="pl-8 text-xs"
              autoFocus
            />
          </div>

          {current ? (
            <button
              type="button"
              onClick={() => select(null)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <UnplugIcon className="size-3.5" />
              {t("variables.disconnect")}
            </button>
          ) : null}

          <div className="max-h-72 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {t("variables.noCompatible")}
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.nodeId} className="py-1">
                  <div className="px-2.5 py-1.5">
                    <p className="truncate text-[10px] font-semibold">
                      {group.nodeTitle}
                    </p>
                  </div>
                  {group.variables.map((variable) => {
                    const value = formatVariableReference(variable.reference)
                    const selected = value === currentValue
                    return (
                      <button
                        key={variable.id}
                        type="button"
                        onClick={() => select(variable.reference)}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent"
                      >
                        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                          <BracesIcon className="size-3" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium">
                            {variable.portLabel}
                          </span>
                          <span className="block truncate text-[9px] text-muted-foreground">
                            {t("variables.from", { node: group.nodeTitle })}
                          </span>
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">
                          {variable.valueType}
                        </span>
                        {selected ? (
                          <CheckIcon className="size-3.5 text-violet-600" />
                        ) : null}
                      </button>
                    )
                  })}
                </section>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function localizedNodeTitle(
  workflow: WorkflowDocumentDraft,
  nodeId: string,
  t: ReturnType<typeof useTranslations<"Studio">>
) {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return nodeId
  const copyKey = {
    start: "start",
    "image-generator": "imageGenerator",
    "image-result": "imageResult",
    selector: "selector",
    "design-document": "designDocument",
    end: "end",
  }[node.kind]
  if (node.data.kind === "image-result") {
    return t("nodes.imageResult.title", {
      number: node.title.match(/\d+/)?.[0] || "—",
    })
  }
  return t(`nodes.${copyKey}.title`)
}
