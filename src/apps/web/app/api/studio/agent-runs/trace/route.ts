import { readAgentTrace } from "@/lib/agent-trace"
import { authorizeAgentRun } from "@/lib/agent-state-store"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const workspaceId = search.get("workspaceId") || ""
  const runId = search.get("runId") || ""
  if (!workspaceId || !runId) {
    return Response.json(
      {
        error: "invalid-agent-trace-request",
        message: "workspaceId and runId are required.",
      },
      { status: 400 }
    )
  }
  const access = await requireStudioApiAccess(workspaceId)
  if (!access.ok) return access.response
  const owned = await authorizeAgentRun(workspaceId, runId)
  if (!owned) {
    return Response.json(
      { error: "agent-run-not-found", message: "AgentRun was not found." },
      { status: 404 }
    )
  }
  return Response.json(
    await readAgentTrace({
      workspaceId,
      run: owned.snapshot,
      driverRunId: owned.driverRunId,
    })
  )
}
