"use client"

import type { Edge, Node, ReactFlowProps } from "@xyflow/react"
import { Background, ReactFlow } from "@xyflow/react"
import type { ReactNode } from "react"

type CanvasProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> =
  ReactFlowProps<NodeType, EdgeType> & {
  children?: ReactNode
}

const deleteKeyCode = ["Backspace", "Delete"]

// Adapted from Vercel AI Elements' Apache-2.0 Canvas primitive. Muses keeps
// domain state outside React Flow and uses this component only as a projection.
export function Canvas<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  children,
  ...props
}: CanvasProps<NodeType, EdgeType>) {
  return (
    <ReactFlow
      deleteKeyCode={deleteKeyCode}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      panOnDrag={false}
      panOnScroll
      selectionOnDrag
      zoomOnDoubleClick={false}
      {...props}
    >
      <Background bgColor="var(--muses-canvas)" color="var(--muses-grid)" gap={24} size={1} />
      {children}
    </ReactFlow>
  )
}
