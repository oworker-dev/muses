"use client"

import { CheckIcon, ClipboardIcon, TerminalIcon } from "lucide-react"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"

export function CommandCopy({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  function copyCommand() {
    startTransition(async () => {
      const copiedToClipboard = await writeClipboard(command)

      if (copiedToClipboard) {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      } else {
        setCopied(false)
      }
    })
  }

  return (
    <div className="group inline-flex max-w-full items-center gap-3 rounded-lg border bg-background px-4 py-3 text-left shadow-sm">
      <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
      <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-sm font-medium sm:text-base">
        {command}
      </code>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={isPending}
        onClick={copyCommand}
        aria-label={copied ? "Command copied" : "Copy command"}
      >
        {copied ? <CheckIcon className="size-4" /> : <ClipboardIcon className="size-4" />}
      </Button>
    </div>
  )
}

async function writeClipboard(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the selection-based copy path for locked-down browsers.
  }

  const textArea = document.createElement("textarea")
  textArea.value = value
  textArea.setAttribute("readonly", "")
  textArea.style.position = "fixed"
  textArea.style.left = "-9999px"
  document.body.appendChild(textArea)
  textArea.select()

  try {
    return document.execCommand("copy")
  } finally {
    document.body.removeChild(textArea)
  }
}
