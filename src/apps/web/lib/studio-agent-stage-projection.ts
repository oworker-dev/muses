import type { AgentEvent, AgentRunSnapshot } from "@muses/agent-core"

export function agentStages(
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
  const failed = run?.status === "failed" || run?.status === "cancelled"

  return [
    {
      key: "understand" as const,
      state: eventTypes.has("model.completed")
        ? "done"
        : failed
          ? "failed"
          : run
            ? "active"
            : "idle",
    },
    {
      key: "create" as const,
      state: imageCompleted
        ? "done"
        : imageRequested
          ? failed
            ? "failed"
            : "active"
          : "idle",
    },
    {
      key: "place" as const,
      state: completed
        ? "done"
        : imageCompleted
          ? failed
            ? "failed"
            : "active"
          : "idle",
    },
  ] as const
}
