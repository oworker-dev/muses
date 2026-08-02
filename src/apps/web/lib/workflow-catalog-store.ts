import type { PoolClient } from "pg"

import {
  WORKFLOW_CATALOG_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  compileWorkflowDefinition,
  createHarnessWorkspace,
  getWorkflowDefinitionRef,
  type MusesWorkspaceDraft,
  type WorkflowDefinition,
  type WorkflowDefinitionCatalogEntry,
  type WorkflowDefinitionRef,
  type WorkflowDeployment,
  type WorkflowInvocationTarget,
} from "@muses/domain"

import { getPgPool } from "@/lib/database"
import { prefixedId } from "@/lib/studio-access"

export type WorkflowPublication = {
  definition: WorkflowDefinitionRef
  deployment: WorkflowDeployment
  draftRevision: number
  published: boolean
}

export type WorkflowCatalogInspection = {
  definition: WorkflowDefinition
  projectId: string
  deployment?: WorkflowDeployment
  inputSchema: Readonly<Record<string, unknown>>
  outputSchema: Readonly<Record<string, unknown>>
  publishedAt: string
}

export class WorkflowCatalogStoreError extends Error {
  constructor(
    readonly code:
      | "workflow-draft-not-found"
      | "workflow-draft-archived"
      | "workflow-draft-revision-conflict"
      | "workflow-publication-invalid"
      | "workflow-definition-version-not-found"
      | "workflow-deployment-not-found"
      | "workflow-deployment-disabled"
      | "workflow-workspace-mismatch",
    message: string,
    readonly issues?: readonly unknown[]
  ) {
    super(message)
    this.name = "WorkflowCatalogStoreError"
  }
}

export async function publishWorkflowDraft(input: {
  workspaceId: string
  definitionId: string
  expectedDraftRevision?: number
  publishedByUserId: string
  deploymentAlias?: string
  fixture?: "durable-harness"
}): Promise<WorkflowPublication> {
  if (
    input.fixture === "durable-harness" &&
    input.definitionId !== durableHarnessDefinitionId(input.workspaceId)
  ) {
    throw new WorkflowCatalogStoreError(
      "workflow-publication-invalid",
      "The durable Harness fixture must use its server-owned definition id."
    )
  }
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`workflow-catalog:publish:${input.workspaceId}:${input.definitionId}`]
    )
    if (input.fixture === "durable-harness") {
      await ensureDurableHarnessDraft(client, input)
    }

    const draft = (
      await client.query<{
        revision: number
        lifecycleStatus: "draft" | "published" | "archived"
        document: MusesWorkspaceDraft
      }>(
        `
          select
            revision,
            lifecycle_status as "lifecycleStatus",
            document
          from muses_workflow_definition_draft
          where id = $1 and workspace_id = $2
          for update
        `,
        [input.definitionId, input.workspaceId]
      )
    ).rows[0]
    if (!draft) {
      throw new WorkflowCatalogStoreError(
        "workflow-draft-not-found",
        "The workflow draft was not found in this Workspace."
      )
    }
    if (draft.lifecycleStatus === "archived") {
      throw new WorkflowCatalogStoreError(
        "workflow-draft-archived",
        "An archived workflow draft cannot be published."
      )
    }
    if (
      input.expectedDraftRevision !== undefined &&
      input.expectedDraftRevision !== draft.revision
    ) {
      throw new WorkflowCatalogStoreError(
        "workflow-draft-revision-conflict",
        `Expected draft revision ${input.expectedDraftRevision}; current revision is ${draft.revision}.`
      )
    }

    const latest = (
      await client.query<{
        version: number
        definition: WorkflowDefinition
      }>(
        `
          select version, definition
          from muses_workflow_definition_version
          where definition_id = $1 and workspace_id = $2
          order by version desc
          limit 1
        `,
        [input.definitionId, input.workspaceId]
      )
    ).rows[0]
    const candidateVersion = (latest?.version || 0) + 1
    const compilation = compileWorkflowDefinition(draft.document.workflow, {
      workspaceId: input.workspaceId,
      definitionId: input.definitionId,
      version: candidateVersion,
    })
    if (!compilation.ok) {
      throw new WorkflowCatalogStoreError(
        "workflow-publication-invalid",
        "The workflow draft did not pass publication validation.",
        compilation.issues
      )
    }

    const published =
      !latest ||
      !sameDefinitionContent(latest.definition, compilation.definition)
    const definition = published ? compilation.definition : latest.definition
    if (published) {
      await client.query(
        `
          insert into muses_workflow_definition_version (
            definition_id,
            version,
            workspace_id,
            schema_version,
            definition,
            input_schema,
            output_schema,
            published_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          definition.definitionId,
          definition.version,
          definition.workspaceId,
          definition.schemaVersion,
          JSON.stringify(definition),
          JSON.stringify(workflowInputSchema(definition)),
          JSON.stringify(workflowOutputSchema(definition)),
          input.publishedByUserId,
        ]
      )
    }

    const deployment = await upsertDeployment(client, {
      workspaceId: input.workspaceId,
      definition: getWorkflowDefinitionRef(definition),
      alias: normalizedAlias(input.deploymentAlias),
      createdByUserId: input.publishedByUserId,
    })
    await client.query(
      `
        update muses_workflow_definition_draft
        set lifecycle_status = 'published', updated_at = now()
        where id = $1 and workspace_id = $2
      `,
      [input.definitionId, input.workspaceId]
    )
    await client.query("commit")
    return {
      definition: getWorkflowDefinitionRef(definition),
      deployment,
      draftRevision: draft.revision,
      published,
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function listWorkflowCatalog(input: {
  workspaceId: string
  projectId?: string
}): Promise<{
  definitions: readonly WorkflowDefinitionCatalogEntry[]
  deployments: readonly WorkflowDeployment[]
}> {
  const definitionParameters: unknown[] = [input.workspaceId]
  const projectCondition = input.projectId ? "and draft.project_id = $2" : ""
  if (input.projectId) definitionParameters.push(input.projectId)
  const definitions = await getPgPool().query<{
    projectId: string
    definitionId: string
    name: string
    description: string
    draftRevision: number
    latestPublishedVersion: number | null
    status: "draft" | "published" | "archived"
  }>(
    `
      select
        draft.project_id as "projectId",
        draft.id as "definitionId",
        draft.name,
        draft.description,
        draft.revision as "draftRevision",
        max(version.version) as "latestPublishedVersion",
        draft.lifecycle_status as status
      from muses_workflow_definition_draft draft
      left join muses_workflow_definition_version version
        on version.definition_id = draft.id
       and version.workspace_id = draft.workspace_id
      where draft.workspace_id = $1
        ${projectCondition}
      group by draft.id
      order by draft.created_at, draft.id
    `,
    definitionParameters
  )
  const definitionIds = definitions.rows.map(({ definitionId }) => definitionId)
  const deployments =
    definitionIds.length === 0
      ? []
      : (
          await getPgPool().query<{
            deploymentId: string
            alias: string
            status: "active" | "disabled"
            definitionId: string
            version: number
            schemaVersion: typeof WORKFLOW_DEFINITION_SCHEMA_VERSION
          }>(
            `
              select
                deployment.id as "deploymentId",
                deployment.alias,
                deployment.status,
                deployment.definition_id as "definitionId",
                deployment.version,
                version.schema_version as "schemaVersion"
              from muses_workflow_deployment deployment
              join muses_workflow_definition_version version
                on version.definition_id = deployment.definition_id
               and version.version = deployment.version
              where deployment.workspace_id = $1
                and deployment.definition_id = any($2::text[])
              order by deployment.definition_id, deployment.alias
            `,
            [input.workspaceId, definitionIds]
          )
        ).rows.map((row) => deploymentProjection(input.workspaceId, row))

  return {
    definitions: definitions.rows.map((row) => ({
      schemaVersion: WORKFLOW_CATALOG_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      projectId: row.projectId,
      definitionId: row.definitionId,
      name: row.name,
      description: row.description,
      draftRevision: row.draftRevision,
      ...(row.latestPublishedVersion === null
        ? {}
        : { latestPublishedVersion: Number(row.latestPublishedVersion) }),
      status: row.status,
      tags: [],
    })),
    deployments,
  }
}

export async function inspectWorkflowInvocationTarget(input: {
  workspaceId: string
  target: WorkflowInvocationTarget
}): Promise<WorkflowCatalogInspection> {
  if (input.target.kind === "definition-version") {
    if (input.target.definition.workspaceId !== input.workspaceId) {
      throw new WorkflowCatalogStoreError(
        "workflow-workspace-mismatch",
        "Workflow versions cannot be invoked across Workspace boundaries."
      )
    }
    return readDefinitionVersion(
      input.workspaceId,
      input.target.definition.definitionId,
      input.target.definition.version
    )
  }

  if (input.target.workspaceId !== input.workspaceId) {
    throw new WorkflowCatalogStoreError(
      "workflow-workspace-mismatch",
      "Workflow deployments cannot be invoked across Workspace boundaries."
    )
  }
  const row = (
    await getPgPool().query<{
      deploymentId: string
      alias: string
      status: "active" | "disabled"
      definitionId: string
      version: number
      schemaVersion: typeof WORKFLOW_DEFINITION_SCHEMA_VERSION
    }>(
      `
        select
          deployment.id as "deploymentId",
          deployment.alias,
          deployment.status,
          deployment.definition_id as "definitionId",
          deployment.version,
          version.schema_version as "schemaVersion"
        from muses_workflow_deployment deployment
        join muses_workflow_definition_version version
          on version.definition_id = deployment.definition_id
         and version.version = deployment.version
        where deployment.id = $1 and deployment.workspace_id = $2
        limit 1
      `,
      [input.target.deploymentId, input.workspaceId]
    )
  ).rows[0]
  if (!row) {
    throw new WorkflowCatalogStoreError(
      "workflow-deployment-not-found",
      "The workflow deployment was not found in this Workspace."
    )
  }
  if (row.status !== "active") {
    throw new WorkflowCatalogStoreError(
      "workflow-deployment-disabled",
      `Workflow deployment "${row.deploymentId}" is disabled.`
    )
  }
  const inspection = await readDefinitionVersion(
    input.workspaceId,
    row.definitionId,
    row.version
  )
  return {
    ...inspection,
    deployment: deploymentProjection(input.workspaceId, row),
  }
}

async function readDefinitionVersion(
  workspaceId: string,
  definitionId: string,
  version: number
): Promise<WorkflowCatalogInspection> {
  const row = (
    await getPgPool().query<{
      definition: WorkflowDefinition
      projectId: string
      inputSchema: Readonly<Record<string, unknown>>
      outputSchema: Readonly<Record<string, unknown>>
      publishedAt: Date | string
    }>(
      `
        select
          version.definition,
          draft.project_id as "projectId",
          version.input_schema as "inputSchema",
          version.output_schema as "outputSchema",
          version.published_at as "publishedAt"
        from muses_workflow_definition_version version
        join muses_workflow_definition_draft draft
          on draft.id = version.definition_id
         and draft.workspace_id = version.workspace_id
        where version.definition_id = $1
          and version.version = $2
          and version.workspace_id = $3
        limit 1
      `,
      [definitionId, version, workspaceId]
    )
  ).rows[0]
  if (
    !row ||
    !isStoredWorkflowDefinition(
      row.definition,
      workspaceId,
      definitionId,
      version
    )
  ) {
    throw new WorkflowCatalogStoreError(
      "workflow-definition-version-not-found",
      "The exact published workflow version was not found in this Workspace."
    )
  }
  return {
    definition: row.definition,
    projectId: row.projectId,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    publishedAt: new Date(row.publishedAt).toISOString(),
  }
}

async function ensureDurableHarnessDraft(
  client: PoolClient,
  input: {
    workspaceId: string
    definitionId: string
    publishedByUserId: string
  }
) {
  const owner = (
    await client.query<{
      projectId: string
      professionalWorkspaceId: string
    }>(
      `
        select
          project_id as "projectId",
          id as "professionalWorkspaceId"
        from muses_professional_workspace
        where workspace_id = $1
        order by created_at, id
        limit 1
      `,
      [input.workspaceId]
    )
  ).rows[0]
  if (!owner) {
    throw new WorkflowCatalogStoreError(
      "workflow-draft-not-found",
      "The durable Harness requires an initialized professional workspace."
    )
  }
  const fixture = createHarnessWorkspace()
  const document: MusesWorkspaceDraft = {
    ...fixture,
    id: input.workspaceId,
    workflow: { ...fixture.workflow, id: input.definitionId },
  }
  const existing = (
    await client.query<{ revision: number; document: MusesWorkspaceDraft }>(
      `
        select revision, document
        from muses_workflow_definition_draft
        where id = $1 and workspace_id = $2
        for update
      `,
      [input.definitionId, input.workspaceId]
    )
  ).rows[0]
  if (!existing) {
    await client.query(
      `
        insert into muses_workflow_definition_draft (
          id,
          workspace_id,
          project_id,
          professional_workspace_id,
          name,
          description,
          schema_version,
          revision,
          document,
          created_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)
      `,
      [
        input.definitionId,
        input.workspaceId,
        owner.projectId,
        owner.professionalWorkspaceId,
        "Durable runtime Harness",
        "Server-owned regression fixture for durable waiting and recovery.",
        WORKSPACE_SCHEMA_VERSION,
        JSON.stringify(document),
        input.publishedByUserId,
      ]
    )
    return
  }
  if (stableJson(existing.document) === stableJson(document)) return
  await client.query(
    `
      update muses_workflow_definition_draft
      set revision = $3, document = $4, lifecycle_status = 'draft', updated_at = now()
      where id = $1 and workspace_id = $2
    `,
    [
      input.definitionId,
      input.workspaceId,
      existing.revision + 1,
      JSON.stringify(document),
    ]
  )
}

async function upsertDeployment(
  client: PoolClient,
  input: {
    workspaceId: string
    definition: WorkflowDefinitionRef
    alias: string
    createdByUserId: string
  }
): Promise<WorkflowDeployment> {
  const row = (
    await client.query<{ deploymentId: string }>(
      `
        insert into muses_workflow_deployment (
          id,
          workspace_id,
          definition_id,
          alias,
          version,
          status,
          created_by_user_id
        )
        values ($1, $2, $3, $4, $5, 'active', $6)
        on conflict (workspace_id, definition_id, alias) do update
        set version = excluded.version, status = 'active', updated_at = now()
        returning id as "deploymentId"
      `,
      [
        prefixedId("mwdep"),
        input.workspaceId,
        input.definition.definitionId,
        input.alias,
        input.definition.version,
        input.createdByUserId,
      ]
    )
  ).rows[0]
  return {
    schemaVersion: WORKFLOW_CATALOG_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    deploymentId: row.deploymentId,
    alias: input.alias,
    definition: input.definition,
    status: "active",
  }
}

function deploymentProjection(
  workspaceId: string,
  row: {
    deploymentId: string
    alias: string
    status: "active" | "disabled"
    definitionId: string
    version: number
    schemaVersion: typeof WORKFLOW_DEFINITION_SCHEMA_VERSION
  }
): WorkflowDeployment {
  return {
    schemaVersion: WORKFLOW_CATALOG_SCHEMA_VERSION,
    workspaceId,
    deploymentId: row.deploymentId,
    alias: row.alias,
    definition: {
      workspaceId,
      definitionId: row.definitionId,
      version: row.version,
      schemaVersion: row.schemaVersion,
    },
    status: row.status,
  }
}

function isStoredWorkflowDefinition(
  value: unknown,
  workspaceId: string,
  definitionId: string,
  version: number
): value is WorkflowDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<WorkflowDefinition>
  return (
    candidate.workspaceId === workspaceId &&
    candidate.definitionId === definitionId &&
    candidate.version === version &&
    candidate.schemaVersion === WORKFLOW_DEFINITION_SCHEMA_VERSION &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.executionOrder)
  )
}

function sameDefinitionContent(
  current: WorkflowDefinition,
  candidate: WorkflowDefinition
) {
  return (
    stableJson(executableDefinitionContent(current)) ===
    stableJson(executableDefinitionContent(candidate))
  )
}

function executableDefinitionContent(definition: WorkflowDefinition) {
  return {
    ...definition,
    version: 0,
    source: { ...definition.source, documentRevision: 0 },
  }
}

function durableHarnessDefinitionId(workspaceId: string) {
  return `${workspaceId}:durable-harness`
}

function workflowInputSchema(definition: WorkflowDefinition) {
  return {
    type: "object",
    properties: Object.fromEntries(
      definition.inputs.map((input) => [
        input.id,
        runtimeScalarSchema(input.valueType),
      ])
    ),
    required: definition.inputs
      .filter((input) => input.required && input.defaultValue === undefined)
      .map((input) => input.id),
    additionalProperties: false,
  }
}

function workflowOutputSchema(definition: WorkflowDefinition) {
  return {
    type: "object",
    properties: Object.fromEntries(
      definition.outputs.map((output) => [
        output.id,
        {
          title: output.name,
          type: "object",
          properties: { valueType: { const: output.valueType } },
        },
      ])
    ),
    required: definition.outputs
      .filter((output) => output.required)
      .map((output) => output.id),
    additionalProperties: false,
  }
}

function runtimeScalarSchema(valueType: "text" | "number" | "boolean") {
  return {
    type: "object",
    properties: {
      valueType: { const: valueType },
      value: {
        type:
          valueType === "text"
            ? "string"
            : valueType === "number"
              ? "number"
              : "boolean",
      },
    },
    required: ["valueType", "value"],
    additionalProperties: false,
  }
}

function normalizedAlias(value?: string) {
  const alias = value?.trim() || "production"
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(alias)) {
    throw new WorkflowCatalogStoreError(
      "workflow-publication-invalid",
      "A deployment alias must start with a letter and contain only lowercase letters, numbers, or hyphens."
    )
  }
  return alias
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
