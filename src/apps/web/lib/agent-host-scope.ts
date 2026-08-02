import { getPgPool } from "./database"

export class AgentHostScopeError extends Error {
  constructor(
    readonly code: "agent-host-project-not-found" | "agent-host-canvas-not-found",
    message: string,
    readonly status = 404,
  ) {
    super(message)
    this.name = "AgentHostScopeError"
  }
}

export type AuthorizedAgentHostScope = {
  readonly projectId: string
  readonly canvasId: string
}

type AgentHostScopeRow = { readonly projectId: string; readonly canvasId: string | null }

type ScopeDatabase = {
  query(text: string, values: unknown[]): Promise<{ rows: AgentHostScopeRow[] }>
}

export async function requireAuthorizedAgentHostScope(
  input: {
    readonly workspaceId: string
    readonly projectId: string
    readonly canvasId?: string
  },
  database: ScopeDatabase = getPgPool(),
): Promise<AuthorizedAgentHostScope> {
  const result = await database.query(
    `
      select project.id as "projectId", canvas.id as "canvasId"
      from muses_project project
      left join muses_creative_canvas canvas
        on canvas.workspace_id = project.workspace_id
       and canvas.project_id = project.id
      where project.workspace_id = $1
        and project.id = $2
        and ($3::text is null or canvas.id = $3)
      limit 1
    `,
    [input.workspaceId, input.projectId, input.canvasId || null],
  )
  const row = result.rows[0]
  if (!row) {
    throw new AgentHostScopeError(
      input.canvasId ? "agent-host-canvas-not-found" : "agent-host-project-not-found",
      input.canvasId
        ? "Canvas was not found in the requested Project and Workspace."
        : "Project was not found in the requested Workspace.",
    )
  }
  if (!row.canvasId) {
    throw new AgentHostScopeError(
      "agent-host-canvas-not-found",
      "The requested Project does not have a Creative Canvas.",
    )
  }
  return { projectId: row.projectId, canvasId: row.canvasId }
}
