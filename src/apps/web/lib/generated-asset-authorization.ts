import type { Pool } from "pg"

import type { AgentDelegationArtifactAuthorizationPort } from "@muses/agent-core"

import { getPgPool } from "./database"

export class PostgresGeneratedAssetAuthorization
  implements AgentDelegationArtifactAuthorizationPort
{
  constructor(private readonly pool: Pool = getPgPool()) {}

  async authorize(input: {
    readonly workspaceId: string
    readonly projectId: string
    readonly artifactRefs: readonly string[]
  }) {
    if (input.artifactRefs.length === 0) return { ok: true as const }
    const rows = await this.pool.query<{ id: string }>(
      `
        select id
        from muses_generated_asset
        where workspace_id = $1
          and project_id = $2
          and id = any($3::text[])
      `,
      [input.workspaceId, input.projectId, input.artifactRefs]
    )
    const authorized = new Set(rows.rows.map(({ id }) => id))
    const unauthorized = input.artifactRefs.filter((ref) => !authorized.has(ref))
    return unauthorized.length === 0
      ? { ok: true as const }
      : { ok: false as const, unauthorized }
  }
}
