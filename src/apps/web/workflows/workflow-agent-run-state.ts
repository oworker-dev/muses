import type { WorkflowRuntimeEvent } from "./workflow-definition-interpreter"

export function getActiveAgentRunIds(events: readonly WorkflowRuntimeEvent[]) {
  const started = new Map<string, string>()
  const terminalNodes = new Set<string>()
  for (const event of events) {
    if (event.type === "node.agent.started") {
      started.set(event.nodeId, event.agentRunId)
    } else if (event.type === "node.succeeded") {
      terminalNodes.add(event.nodeId)
    } else if (event.type === "run.failed" && event.failure.nodeId) {
      terminalNodes.add(event.failure.nodeId)
    }
  }
  return [...started.entries()]
    .filter(([nodeId]) => !terminalNodes.has(nodeId))
    .map(([, agentRunId]) => agentRunId)
}

export function mergeAgentRunIds(...sources: readonly (readonly string[])[]) {
  return [...new Set(sources.flat())]
}
