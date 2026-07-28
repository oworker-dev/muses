"use client"

import { createContext, useContext } from "react"

import type { MusesCommandPayload, PortValueType } from "@muses/domain"

export type NodePanelRequest = {
  sourceNodeId: string
  sourcePortId: string
  valueType: PortValueType
  anchor: {
    x: number
    y: number
  }
}

export type StudioActions = {
  dispatch: (payload: MusesCommandPayload | MusesCommandPayload[]) => void
  exportWorkspace: () => void
  openNodePanel: (request: NodePanelRequest) => void
  openDesignDocument: (documentId: string) => void
  runImageGenerator: (generatorNodeId: string) => void
  selectResult: (resultNodeId: string) => void
}

const StudioActionsContext = createContext<StudioActions | null>(null)

export const StudioActionsProvider = StudioActionsContext.Provider

export function useStudioActions() {
  const value = useContext(StudioActionsContext)
  if (!value) {
    throw new Error("Studio actions must be used inside StudioActionsProvider.")
  }
  return value
}
