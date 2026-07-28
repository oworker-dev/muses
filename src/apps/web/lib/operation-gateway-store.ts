import {
  CREATIVE_CANVAS_SCHEMA_VERSION,
  OPERATION_COMMAND_SCHEMA_VERSION,
  PROFESSIONAL_WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  applyCreativeCanvasCommand,
  applyMusesCommand,
  applyProfessionalWorkspaceCommand,
  createInitialWorkspace,
  type ApplyOperationDocumentCommandResult,
  type CreativeCanvas,
  type MusesCommandEnvelope,
  type MusesCommandPayload,
  type MusesWorkspaceDraft,
  type OperationActor,
  type OperationCommandEnvelope,
  type OperationCommandRejectionCode,
  type OperationCommandResponse,
  type OperationGatewaySnapshot,
  type ProfessionalWorkspace,
  type ProfessionalWorkspaceCommandPayload,
} from "@muses/domain"
import type { PoolClient } from "pg"

import { getPgPool } from "@/lib/database"
import { prefixedId } from "@/lib/studio-access"

const DEFAULT_PROJECT_NAME = "Untitled project"
const DEFAULT_WORKFLOW_NAME = "Image generation"

export class OperationGatewayStoreError extends Error {
  constructor(
    readonly code:
      | "project-not-found"
      | "target-not-found"
      | "actor-mismatch"
      | "command-id-conflict"
      | "receipt-incomplete"
      | "document-invalid",
    message: string
  ) {
    super(message)
    this.name = "OperationGatewayStoreError"
  }
}

export async function getOrCreateOperationGatewaySnapshot(input: {
  workspaceId: string
  userId: string
  projectId?: string
}): Promise<OperationGatewaySnapshot> {
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    await lock(client, `operation-gateway:init:${input.workspaceId}`)
    const project = await getOrCreateProject(client, input)
    await ensureProjectDocuments(client, {
      workspaceId: input.workspaceId,
      projectId: project.id,
      userId: input.userId,
    })
    const snapshot = await readSnapshot(client, input.workspaceId, project.id)
    await client.query("commit")
    return snapshot
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function executeOperationCommand(input: {
  command: OperationCommandEnvelope
  authorizedActor: OperationActor
  actorEmail?: string
}): Promise<OperationCommandResponse> {
  assertActor(input.command.actor, input.authorizedActor)
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    await lock(
      client,
      [
        "operation-gateway:command",
        input.command.workspaceId,
        input.command.target.type,
        input.command.target.id,
      ].join(":")
    )

    await requireProject(
      client,
      input.command.workspaceId,
      input.command.projectId
    )

    const replay = await findReceipt(client, input.command)
    if (replay) {
      await client.query("commit")
      return { ...replay, duplicate: true }
    }
    await rejectReusedCommandId(client, input.command)

    const actorId = getActorId(input.command.actor)
    await client.query(
      `
        insert into muses_operation_command_receipt (
          workspace_id,
          target_type,
          target_id,
          idempotency_key,
          command_id,
          actor_kind,
          actor_id,
          expected_revision
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        input.command.workspaceId,
        input.command.target.type,
        input.command.target.id,
        input.command.idempotencyKey,
        input.command.commandId,
        input.command.actor.kind,
        actorId,
        input.command.expectedRevision,
      ]
    )

    const applied = await applyCommand(client, input.command)
    const snapshot = await readSnapshot(
      client,
      input.command.workspaceId,
      input.command.projectId
    )
    const response: OperationCommandResponse = {
      accepted: applied.accepted,
      duplicate: false,
      commandId: input.command.commandId,
      idempotencyKey: input.command.idempotencyKey,
      target: input.command.target,
      resultingRevision: applied.revision,
      ...(applied.accepted
        ? {}
        : { code: applied.code, message: applied.message }),
      snapshot,
    }

    await client.query(
      `
        update muses_operation_command_receipt
        set
          resulting_revision = $5,
          status = $6,
          response = $7,
          completed_at = now()
        where workspace_id = $1
          and target_type = $2
          and target_id = $3
          and idempotency_key = $4
      `,
      [
        input.command.workspaceId,
        input.command.target.type,
        input.command.target.id,
        input.command.idempotencyKey,
        applied.revision,
        applied.accepted ? "accepted" : "rejected",
        JSON.stringify(response),
      ]
    )

    if (applied.accepted) {
      await writeAuditLog(client, input, actorId, applied.revision)
    }
    await client.query("commit")
    return response
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

type AppliedCommand =
  | { accepted: true; revision: number }
  | {
      accepted: false
      revision: number
      code: OperationCommandRejectionCode
      message: string
    }

async function applyCommand(
  client: PoolClient,
  command: OperationCommandEnvelope
): Promise<AppliedCommand> {
  switch (command.target.type) {
    case "creative-canvas":
      return applyCreativeCommand(client, command)
    case "professional-workspace":
      return applyProfessionalCommand(client, command)
    case "workflow-definition":
      return applyWorkflowDefinitionCommand(client, command)
  }
}

async function applyCreativeCommand(
  client: PoolClient,
  command: OperationCommandEnvelope
): Promise<AppliedCommand> {
  const row = (
    await client.query<{ document: CreativeCanvas; revision: number }>(
      `
        select document, revision
        from muses_creative_canvas
        where id = $1 and workspace_id = $2 and project_id = $3
        for update
      `,
      [command.target.id, command.workspaceId, command.projectId]
    )
  ).rows[0]
  if (!row) throw targetNotFound(command)
  const result = applyCreativeCanvasCommand(row.document, command)
  if (!result.accepted) return rejected(row.revision, result)
  await client.query(
    `
      update muses_creative_canvas
      set revision = $2, document = $3, updated_at = now()
      where id = $1
    `,
    [
      command.target.id,
      result.document.revision,
      JSON.stringify(result.document),
    ]
  )
  return { accepted: true, revision: result.document.revision }
}

async function applyProfessionalCommand(
  client: PoolClient,
  command: OperationCommandEnvelope
): Promise<AppliedCommand> {
  const row = (
    await client.query<{ document: ProfessionalWorkspace; revision: number }>(
      `
        select document, revision
        from muses_professional_workspace
        where id = $1 and workspace_id = $2 and project_id = $3
        for update
      `,
      [command.target.id, command.workspaceId, command.projectId]
    )
  ).rows[0]
  if (!row) throw targetNotFound(command)

  const payload = command.payload as ProfessionalWorkspaceCommandPayload
  if (payload.type === "professional.workflow.create") {
    const existing = await client.query(
      `select 1 from muses_workflow_definition_draft where id = $1 limit 1`,
      [payload.definitionId]
    )
    if (existing.rowCount) {
      return {
        accepted: false,
        revision: row.revision,
        code: "document-invalid",
        message: `WorkflowDefinition "${payload.definitionId}" already exists.`,
      }
    }
  }
  if (payload.type === "professional.workflow.place") {
    const definition = await client.query(
      `
        select 1
        from muses_workflow_definition_draft
        where id = $1 and workspace_id = $2 and project_id = $3
        limit 1
      `,
      [
        payload.placement.workflowDefinitionId,
        command.workspaceId,
        command.projectId,
      ]
    )
    if (!definition.rowCount) {
      return {
        accepted: false,
        revision: row.revision,
        code: "document-invalid",
        message:
          "Only a WorkflowDefinition in this Project can be placed here.",
      }
    }
  }

  const result = applyProfessionalWorkspaceCommand(row.document, command)
  if (!result.accepted) return rejected(row.revision, result)

  if (payload.type === "professional.workflow.create") {
    const document = createDefinitionDocument(
      command.workspaceId,
      payload.definitionId
    )
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
        payload.definitionId,
        command.workspaceId,
        command.projectId,
        command.target.id,
        payload.name.trim(),
        payload.description?.trim() || "",
        WORKSPACE_SCHEMA_VERSION,
        JSON.stringify(document),
        getActorId(command.actor),
      ]
    )
  }

  await client.query(
    `
      update muses_professional_workspace
      set revision = $2, document = $3, updated_at = now()
      where id = $1
    `,
    [
      command.target.id,
      result.document.revision,
      JSON.stringify(result.document),
    ]
  )
  return { accepted: true, revision: result.document.revision }
}

async function applyWorkflowDefinitionCommand(
  client: PoolClient,
  command: OperationCommandEnvelope
): Promise<AppliedCommand> {
  const row = (
    await client.query<{
      document: MusesWorkspaceDraft
      revision: number
    }>(
      `
        select document, revision
        from muses_workflow_definition_draft
        where id = $1 and workspace_id = $2 and project_id = $3
        for update
      `,
      [command.target.id, command.workspaceId, command.projectId]
    )
  ).rows[0]
  if (!row) throw targetNotFound(command)
  if (command.expectedRevision !== row.revision) {
    return {
      accepted: false,
      revision: row.revision,
      code: "revision-conflict",
      message: `Expected revision ${command.expectedRevision}; current revision is ${row.revision}.`,
    }
  }
  if (command.payload.type === "workflow.definition.reset") {
    const nextRevision = row.revision + 1
    const document = createDefinitionDocument(
      command.workspaceId,
      command.target.id
    )
    await client.query(
      `
        update muses_workflow_definition_draft
        set revision = $2, document = $3, updated_at = now()
        where id = $1
      `,
      [command.target.id, nextRevision, JSON.stringify(document)]
    )
    return { accepted: true, revision: nextRevision }
  }
  if (command.payload.type !== "workflow.definition.command") {
    return {
      accepted: false,
      revision: row.revision,
      code: "target-mismatch",
      message: "Command does not contain a WorkflowDefinition mutation.",
    }
  }
  const inner = createInnerCommand(
    row.document,
    command,
    command.payload.command
  )
  let result
  try {
    result = applyMusesCommand(row.document, inner)
  } catch {
    return {
      accepted: false,
      revision: row.revision,
      code: "document-invalid",
      message: "The WorkflowDefinition command payload is invalid.",
    }
  }
  if (!result.accepted) {
    return {
      accepted: false,
      revision: row.revision,
      code:
        result.code === "revision-conflict"
          ? "revision-conflict"
          : "document-invalid",
      message: result.message,
    }
  }

  const nextRevision = row.revision + 1
  await client.query(
    `
      update muses_workflow_definition_draft
      set revision = $2, document = $3, updated_at = now()
      where id = $1
    `,
    [command.target.id, nextRevision, JSON.stringify(result.workspace)]
  )
  return { accepted: true, revision: nextRevision }
}

function createInnerCommand(
  document: MusesWorkspaceDraft,
  outer: OperationCommandEnvelope,
  payload: MusesCommandPayload
): MusesCommandEnvelope {
  const documentId = getDesignDocumentId(payload)
  return {
    id: outer.commandId,
    idempotencyKey: outer.idempotencyKey,
    correlationId: outer.commandId,
    targetType: documentId ? "design-document" : "workflow",
    targetId: documentId || document.workflow.id,
    expectedRevision: documentId
      ? (document.designDocuments[documentId]?.revision ?? -1)
      : document.workflow.revision,
    issuedAt: outer.issuedAt,
    payload,
  }
}

function getDesignDocumentId(payload: MusesCommandPayload) {
  switch (payload.type) {
    case "design.background.set":
    case "design.text.update":
    case "design.element.move":
      return payload.documentId
    default:
      return undefined
  }
}

async function getOrCreateProject(
  client: PoolClient,
  input: { workspaceId: string; userId: string; projectId?: string }
) {
  if (input.projectId) {
    return requireProject(client, input.workspaceId, input.projectId)
  }
  const existing = (
    await client.query<{ id: string; name: string }>(
      `
        select id, name
        from muses_project
        where workspace_id = $1
        order by created_at, id
        limit 1
      `,
      [input.workspaceId]
    )
  ).rows[0]
  if (existing) return existing

  const project = { id: prefixedId("mproj"), name: DEFAULT_PROJECT_NAME }
  await client.query(
    `
      insert into muses_project (id, workspace_id, name, created_by_user_id)
      values ($1, $2, $3, $4)
    `,
    [project.id, input.workspaceId, project.name, input.userId]
  )
  return project
}

async function requireProject(
  client: PoolClient,
  workspaceId: string,
  projectId: string
) {
  const project = (
    await client.query<{ id: string; name: string }>(
      `
        select id, name
        from muses_project
        where id = $1 and workspace_id = $2
        limit 1
      `,
      [projectId, workspaceId]
    )
  ).rows[0]
  if (!project) {
    throw new OperationGatewayStoreError(
      "project-not-found",
      "Project was not found in this Workspace."
    )
  }
  return project
}

async function ensureProjectDocuments(
  client: PoolClient,
  input: { workspaceId: string; projectId: string; userId: string }
) {
  let professionalWorkspaceId = (
    await client.query<{ id: string }>(
      `
        select id
        from muses_professional_workspace
        where workspace_id = $1 and project_id = $2
        limit 1
      `,
      [input.workspaceId, input.projectId]
    )
  ).rows[0]?.id
  if (!professionalWorkspaceId) professionalWorkspaceId = prefixedId("mpws")

  let definitionId = (
    await client.query<{ id: string }>(
      `
        select id
        from muses_workflow_definition_draft
        where workspace_id = $1 and project_id = $2
        order by created_at, id
        limit 1
      `,
      [input.workspaceId, input.projectId]
    )
  ).rows[0]?.id
  if (!definitionId) definitionId = prefixedId("mwfd")

  const canvasId = prefixedId("mcanvas")
  const creativeCanvas: CreativeCanvas = {
    schemaVersion: CREATIVE_CANVAS_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    canvasId,
    revision: 0,
    items: [],
    relations: [],
  }
  await client.query(
    `
      insert into muses_creative_canvas (
        id, workspace_id, project_id, schema_version, revision, document
      )
      values ($1, $2, $3, $4, 0, $5)
      on conflict (workspace_id, project_id) do nothing
    `,
    [
      canvasId,
      input.workspaceId,
      input.projectId,
      CREATIVE_CANVAS_SCHEMA_VERSION,
      JSON.stringify(creativeCanvas),
    ]
  )

  const professionalWorkspace: ProfessionalWorkspace = {
    schemaVersion: PROFESSIONAL_WORKSPACE_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    professionalWorkspaceId,
    revision: 0,
    workflows: [
      {
        workflowDefinitionId: definitionId,
        position: { x: 80, y: 120 },
        collapsed: false,
      },
    ],
  }
  await client.query(
    `
      insert into muses_professional_workspace (
        id, workspace_id, project_id, schema_version, revision, document
      )
      values ($1, $2, $3, $4, 0, $5)
      on conflict (workspace_id, project_id) do nothing
    `,
    [
      professionalWorkspaceId,
      input.workspaceId,
      input.projectId,
      PROFESSIONAL_WORKSPACE_SCHEMA_VERSION,
      JSON.stringify(professionalWorkspace),
    ]
  )

  const definition = createDefinitionDocument(input.workspaceId, definitionId)
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
      values ($1, $2, $3, $4, $5, '', $6, 0, $7, $8)
      on conflict (id) do nothing
    `,
    [
      definitionId,
      input.workspaceId,
      input.projectId,
      professionalWorkspaceId,
      DEFAULT_WORKFLOW_NAME,
      WORKSPACE_SCHEMA_VERSION,
      JSON.stringify(definition),
      input.userId,
    ]
  )
}

function createDefinitionDocument(
  workspaceId: string,
  definitionId: string
): MusesWorkspaceDraft {
  const initial = createInitialWorkspace()
  return {
    ...initial,
    id: workspaceId,
    workflow: { ...initial.workflow, id: definitionId },
  }
}

async function readSnapshot(
  client: PoolClient,
  workspaceId: string,
  projectId: string
): Promise<OperationGatewaySnapshot> {
  const project = await requireProject(client, workspaceId, projectId)
  const [canvasResult, professionalResult, definitionsResult] =
    await Promise.all([
      client.query<{ document: CreativeCanvas }>(
        `
          select document
          from muses_creative_canvas
          where workspace_id = $1 and project_id = $2
          limit 1
        `,
        [workspaceId, projectId]
      ),
      client.query<{ document: ProfessionalWorkspace }>(
        `
          select document
          from muses_professional_workspace
          where workspace_id = $1 and project_id = $2
          limit 1
        `,
        [workspaceId, projectId]
      ),
      client.query<{
        id: string
        name: string
        description: string
        revision: number
        lifecycleStatus: "draft" | "published" | "archived"
        document: MusesWorkspaceDraft
      }>(
        `
          select
            id,
            name,
            description,
            revision,
            lifecycle_status as "lifecycleStatus",
            document
          from muses_workflow_definition_draft
          where workspace_id = $1 and project_id = $2
          order by created_at, id
        `,
        [workspaceId, projectId]
      ),
    ])
  const creativeCanvas = canvasResult.rows[0]?.document
  const professionalWorkspace = professionalResult.rows[0]?.document
  if (!creativeCanvas || !professionalWorkspace) {
    throw new OperationGatewayStoreError(
      "document-invalid",
      "Project operation documents are incomplete."
    )
  }
  return {
    schemaVersion: OPERATION_COMMAND_SCHEMA_VERSION,
    workspaceId,
    project,
    creativeCanvas,
    professionalWorkspace,
    workflowDefinitions: definitionsResult.rows.map((row) => ({
      definitionId: row.id,
      name: row.name,
      description: row.description,
      revision: row.revision,
      lifecycleStatus: row.lifecycleStatus,
      document: row.document,
    })),
  }
}

async function findReceipt(
  client: PoolClient,
  command: OperationCommandEnvelope
): Promise<OperationCommandResponse | null> {
  const receipt = (
    await client.query<{
      commandId: string
      response: OperationCommandResponse | null
      status: string
    }>(
      `
        select command_id as "commandId", response, status
        from muses_operation_command_receipt
        where workspace_id = $1
          and target_type = $2
          and target_id = $3
          and idempotency_key = $4
        for update
      `,
      [
        command.workspaceId,
        command.target.type,
        command.target.id,
        command.idempotencyKey,
      ]
    )
  ).rows[0]
  if (!receipt) return null
  if (receipt.commandId !== command.commandId) {
    throw new OperationGatewayStoreError(
      "command-id-conflict",
      "The idempotency key is already associated with another command."
    )
  }
  if (!receipt.response || receipt.status === "processing") {
    throw new OperationGatewayStoreError(
      "receipt-incomplete",
      "The previous command receipt is incomplete."
    )
  }
  return receipt.response
}

async function rejectReusedCommandId(
  client: PoolClient,
  command: OperationCommandEnvelope
) {
  const existing = await client.query(
    `
      select 1
      from muses_operation_command_receipt
      where workspace_id = $1 and command_id = $2
      limit 1
    `,
    [command.workspaceId, command.commandId]
  )
  if (existing.rowCount) {
    throw new OperationGatewayStoreError(
      "command-id-conflict",
      "The command id has already been used in this Workspace."
    )
  }
}

async function writeAuditLog(
  client: PoolClient,
  input: {
    command: OperationCommandEnvelope
    authorizedActor: OperationActor
    actorEmail?: string
  },
  actorId: string,
  resultingRevision: number
) {
  await client.query(
    `
      insert into audit_log (
        id,
        actor_user_id,
        actor_email,
        action,
        target_type,
        target_id,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      prefixedId("audit"),
      input.command.actor.kind === "user" ? actorId : null,
      input.actorEmail || null,
      input.command.payload.type,
      input.command.target.type,
      input.command.target.id,
      JSON.stringify({
        workspaceId: input.command.workspaceId,
        projectId: input.command.projectId,
        actorKind: input.command.actor.kind,
        actorId,
        commandId: input.command.commandId,
        resultingRevision,
      }),
    ]
  )
}

function rejected<Document>(
  revision: number,
  result: Extract<
    ApplyOperationDocumentCommandResult<Document>,
    { accepted: false }
  >
): AppliedCommand {
  return {
    accepted: false,
    revision,
    code: result.code,
    message: result.message,
  }
}

function targetNotFound(command: OperationCommandEnvelope) {
  return new OperationGatewayStoreError(
    "target-not-found",
    `${command.target.type} "${command.target.id}" was not found in this Project.`
  )
}

function assertActor(actual: OperationActor, authorized: OperationActor) {
  if (
    actual.kind !== authorized.kind ||
    getActorId(actual) !== getActorId(authorized)
  ) {
    throw new OperationGatewayStoreError(
      "actor-mismatch",
      "The command actor does not match the authenticated principal."
    )
  }
}

function getActorId(actor: OperationActor) {
  switch (actor.kind) {
    case "user":
      return actor.userId
    case "agent":
      return actor.agentRunId
    case "api":
      return actor.clientId
  }
}

async function lock(client: PoolClient, key: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 7))", [
    key,
  ])
}
