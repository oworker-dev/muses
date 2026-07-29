import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Pool } from "pg"

import { PostgresGeneratedAssetAuthorization } from "../lib/generated-asset-authorization"
import {
  getGeneratedImageAsset,
  recordGeneratedImageAsset,
} from "../lib/generated-asset-store"
import { getDatabaseUrl } from "../lib/database"

const fixtureId = randomUUID().replaceAll("-", "")
const schemaName = `a10_asset_scope_${fixtureId}`
const workspaceId = `workspace_${fixtureId}`
const foreignWorkspaceId = `workspace_foreign_${fixtureId}`
const publishedProjectId = `project_published_${fixtureId}`
const agentProjectId = `project_agent_${fixtureId}`
const foreignProjectId = `project_foreign_${fixtureId}`
const userId = `user_${fixtureId}`
const definitionId = `definition_${fixtureId}`
const agentRunId = `arun_${fixtureId}`
const publishedSdkRunId = `wrun_published_${fixtureId}`
const agentSdkRunId = `wrun_agent_${fixtureId}`
const orphanSdkRunId = `wrun_orphan_${fixtureId}`
const migrationName = "0014_generated_asset_project_scope.sql"
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db/migrations"
)

const admin = new Pool({ connectionString: getDatabaseUrl(), max: 1 })
const fixture = new Pool({
  connectionString: getDatabaseUrl(),
  max: 4,
  options: `-c search_path=${schemaName},public`,
})

async function main() {
  try {
    await admin.query(`create schema "${schemaName}"`)
    await applyMigrationsBeforeProjectScope()
    await seedLegacyAssets()
    await fixture.query(
      await readFile(join(migrationsDirectory, migrationName), "utf8")
    )

    const backfill = await verifyBackfill()
    const persistence = await verifyNewWrite()
    const authorization = await verifyAuthorization()
    await verifyCrossWorkspaceProjectRejected()

    console.log(
      JSON.stringify({
        passed: true,
        schemaIsolated: true,
        backfill,
        persistence,
        authorization,
        crossWorkspaceProject: "denied",
      })
    )
  } finally {
    await fixture.end().catch(() => undefined)
    await admin
      .query(`drop schema if exists "${schemaName}" cascade`)
      .catch(() => undefined)
    await admin.end()
  }
}

async function applyMigrationsBeforeProjectScope() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name) && name < migrationName)
    .sort()
  for (const name of names) {
    await fixture.query(await readFile(join(migrationsDirectory, name), "utf8"))
  }
}

async function seedLegacyAssets() {
  await fixture.query(
    `insert into muses_workspace (
       id, kind, name, personal_owner_user_id, created_by_user_id
     ) values
       ($1, 'personal', 'Asset scope fixture', $3, $3),
       ($2, 'personal', 'Foreign asset scope fixture', $4, $4)`,
    [workspaceId, foreignWorkspaceId, userId, `${userId}_foreign`]
  )
  await fixture.query(
    `insert into muses_project (id, workspace_id, name, created_by_user_id)
     values
       ($1, $4, 'Published project', $6),
       ($2, $4, 'Agent project', $6),
       ($3, $5, 'Foreign project', $7)`,
    [
      publishedProjectId,
      agentProjectId,
      foreignProjectId,
      workspaceId,
      foreignWorkspaceId,
      userId,
      `${userId}_foreign`,
    ]
  )
  await fixture.query(
    `insert into muses_professional_workspace (
       id, workspace_id, project_id, schema_version, document
     ) values ($1, $2, $3, 'fixture', '{}')`,
    [`professional_${fixtureId}`, workspaceId, publishedProjectId]
  )
  await fixture.query(
    `insert into muses_workflow_definition_draft (
       id, workspace_id, project_id, professional_workspace_id, name,
       schema_version, document, created_by_user_id
     ) values ($1, $2, $3, $4, 'Published fixture', 'fixture', '{}', $5)`,
    [
      definitionId,
      workspaceId,
      publishedProjectId,
      `professional_${fixtureId}`,
      userId,
    ]
  )
  await fixture.query(
    `insert into muses_agent_run (
       id, workspace_id, project_id, session_id, profile_id, profile_version,
       model_ref, status, revision, snapshot
     ) values ($1, $2, $3, $4, 'fixture', '1.0.0', 'fixture/model',
       'completed', 0, '{}')`,
    [agentRunId, workspaceId, agentProjectId, `session_${fixtureId}`]
  )

  await seedWorkflowRun({
    id: `submission_published_${fixtureId}`,
    sdkRunId: publishedSdkRunId,
    definitionId,
  })
  await seedWorkflowRun({
    id: `submission_agent_${fixtureId}`,
    sdkRunId: agentSdkRunId,
    callerKind: "agent",
    callerId: agentRunId,
  })
  await seedWorkflowRun({
    id: `submission_orphan_${fixtureId}`,
    sdkRunId: orphanSdkRunId,
  })

  await Promise.all([
    seedLegacyAsset("legacy-published", publishedSdkRunId),
    seedLegacyAsset("legacy-agent", agentSdkRunId),
    seedLegacyAsset("legacy-orphan", orphanSdkRunId),
  ])
}

async function seedWorkflowRun(input: {
  id: string
  sdkRunId: string
  definitionId?: string
  callerKind?: "agent"
  callerId?: string
}) {
  await fixture.query(
    `insert into muses_workflow_run (
       id, workspace_id, sdk_run_id, submitted_by_user_id,
       workflow_document_id, workflow_document_revision, idempotency_key,
       request_fingerprint, status, workflow_definition_id,
       workflow_definition_version, caller_kind, caller_id
     ) values ($1, $2, $3, $4, 'fixture-document', 0, $5, $6, 'completed',
       $7, $8, $9, $10)`,
    [
      input.id,
      workspaceId,
      input.sdkRunId,
      userId,
      `idempotency_${input.id}`,
      `fingerprint_${input.id}`,
      input.definitionId || null,
      input.definitionId ? 1 : null,
      input.callerKind || null,
      input.callerId || null,
    ]
  )
}

async function seedLegacyAsset(id: string, workflowRunId: string) {
  await fixture.query(
    `insert into muses_generated_asset (
       id, workspace_id, workflow_run_id, node_id, step_id, asset_index,
       object_key, mime_type, byte_size, width, height, prompt, provider,
       model_ref, created_at
     ) values ($1, $2, $3, 'image-node', 'image-step', 0, $4, 'image/png',
       4, 1, 1, 'fixture', 'fixture', 'fixture/model', now())`,
    [id, workspaceId, workflowRunId, `generated/${fixtureId}/${id}.png`]
  )
}

async function verifyBackfill() {
  const rows = (
    await fixture.query<{ id: string; projectId: string | null }>(
      `select id, project_id as "projectId"
       from muses_generated_asset
       where id like 'legacy-%'
       order by id`
    )
  ).rows
  const projects = new Map(rows.map(({ id, projectId }) => [id, projectId]))
  if (
    projects.get("legacy-published") !== publishedProjectId ||
    projects.get("legacy-agent") !== agentProjectId ||
    projects.get("legacy-orphan") !== null
  ) {
    throw new Error(`Generated Asset backfill drifted: ${JSON.stringify(rows)}`)
  }
  return {
    publishedWorkflow: "backfilled",
    agentWorkflow: "backfilled",
    unverifiableOrphan: "preserved-null",
  }
}

async function verifyNewWrite() {
  const id = `image_${fixtureId.slice(0, 24)}`
  const record = await recordGeneratedImageAsset(
    {
      id,
      workspaceId,
      projectId: agentProjectId,
      workflowRunId: `wrun_new_${fixtureId}`,
      nodeId: "image-node",
      stepId: "image-step",
      assetIndex: 0,
      objectKey: `generated/${fixtureId}/${id}.png`,
      mimeType: "image/png",
      byteSize: "4",
      width: 1,
      height: 1,
      prompt: "fixture",
      provider: "fixture",
      modelRef: "fixture/model",
      createdAt: new Date().toISOString(),
    },
    fixture
  )
  const persisted = await getGeneratedImageAsset(
    { workspaceId, workflowRunId: record.workflowRunId, assetId: id },
    fixture
  )
  if (persisted?.projectId !== agentProjectId) {
    throw new Error("A new generated Asset lost its Project authority.")
  }
  return { projectId: "persisted" }
}

async function verifyAuthorization() {
  const authorization = new PostgresGeneratedAssetAuthorization(fixture)
  const allowed = await authorization.authorize({
    workspaceId,
    projectId: publishedProjectId,
    artifactRefs: ["legacy-published"],
  })
  const denied = await authorization.authorize({
    workspaceId,
    projectId: agentProjectId,
    artifactRefs: ["legacy-published"],
  })
  if (!allowed.ok || denied.ok || denied.unauthorized[0] !== "legacy-published") {
    throw new Error("Generated Asset Project authorization did not fail closed.")
  }
  return { exactProject: "allowed", siblingProject: "denied" }
}

async function verifyCrossWorkspaceProjectRejected() {
  try {
    await fixture.query(
      `insert into muses_generated_asset (
         id, workspace_id, project_id, workflow_run_id, node_id, step_id,
         asset_index, object_key, mime_type, byte_size, width, height, prompt,
         provider, model_ref, created_at
       ) values ('cross-workspace', $1, $2, 'wrun-cross', 'node', 'step', 0,
         $3, 'image/png', 4, 1, 1, 'fixture', 'fixture', 'fixture/model', now())`,
      [
        workspaceId,
        foreignProjectId,
        `generated/${fixtureId}/cross-workspace.png`,
      ]
    )
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "constraint" in error &&
      error.constraint === "muses_generated_asset_project_scope_fk"
    ) {
      return
    }
    throw error
  }
  throw new Error("A cross-Workspace Project reference was accepted.")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
