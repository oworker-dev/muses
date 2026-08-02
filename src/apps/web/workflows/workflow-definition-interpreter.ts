import {
  FatalError,
  RetryableError,
  createHook,
  getStepMetadata,
  getWorkflowMetadata,
  getWritable,
  sleep,
} from "workflow"
import {
  createOpenAI,
  type OpenAIImageModelGenerationOptions,
} from "@ai-sdk/openai"
import { generateImage } from "ai"
import sharp from "sharp"

import {
  commitWorkflowNodeOutputs,
  completeWorkflowExecution,
  createWorkflowExecutionState,
  getWorkflowDefinitionRef,
  prepareNextWorkflowNode,
  resumeWorkflowHumanSelection,
  type WorkflowDefinition,
  type WorkflowDefinitionInputPort,
  type WorkflowDefinitionRef,
  type WorkflowInterpreterIssue,
  type WorkflowRuntimeScalarValue,
  type WorkflowRuntimeImageAsset,
  type WorkflowRuntimeValue,
} from "@muses/domain"

import { getGeneratedImageAsset } from "@/lib/generated-asset-store"
import {
  readGeneratedImage,
  storeGeneratedImage,
} from "@/lib/generated-image-storage"
import {
  isDefinitiveImageProviderRejection,
  resolveOpenAiImageExecutionConfig,
} from "@/lib/openai-image-provider"
import { readReadyReferenceImageBytes } from "@/lib/reference-image-storage"
import {
  attachWorkflowSdkRun,
  creditChargeForNode,
  finalizeCreditReservation,
  finalizeUnreservedWorkflowSubmission,
  type WorkflowCreditContext,
} from "@/lib/credit-ledger"
import {
  createMusesAgentHostClient,
  type MusesAgentRunSnapshot,
} from "@/lib/muses-agent-host"
import {
  clampWorkflowAgentBudget,
  getWorkflowAgentProfile,
  hostCapabilitiesForWorkflowAgent,
} from "@/lib/agent-profile-catalog"
import { requireAgentJsonObject } from "@/lib/agent-json-boundary"

export const MUSES_RUNTIME_STREAM_NAMESPACE = "muses:runtime"
export const MUSES_SERVER_INTERPRETER_HARNESS =
  "muses-server-interpreter-harness" as const
export const MUSES_WORKFLOW_RUNTIME = "muses-workflow-runtime" as const
export const MUSES_OPENAI_IMAGE_ADAPTER = "openai-images" as const
export const MUSES_SUPPORTED_NODE_MAX_RETRIES = 2
export const MUSES_SUPPORTED_NODE_MAX_ATTEMPTS =
  MUSES_SUPPORTED_NODE_MAX_RETRIES + 1
export const MUSES_SELECTOR_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

export type WorkflowInterpreterHarnessOptions = {
  readonly projectId?: string
  readonly agentActorUserId?: string
  readonly retryOfRunId?: string
  readonly submissionId?: string
  readonly creditContext?: WorkflowCreditContext
  readonly selectorTimeoutMs?: number
  readonly failureFault?: {
    readonly nodeId: string
    readonly mode: "permanent" | "transient"
    readonly failThroughAttempt: number
  }
}

export type WorkflowRuntimeFailureProjection = {
  readonly code: string
  readonly category:
    | "definition"
    | "permanent"
    | "transient"
    | "transient-exhausted"
    | "timeout"
  readonly message: string
  readonly retryable: boolean
  readonly nodeId?: string
  readonly nodeKind?: string
  readonly attempts?: number
  readonly maxAttempts?: number
}

export type WorkflowRuntimeAttemptProjection = {
  readonly nodeId: string
  readonly nodeKind: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly status: "running" | "retrying" | "succeeded" | "failed"
}

export type ServerHarnessCandidateAsset = {
  readonly assetId: string
  readonly kind: "image"
  readonly source: "server-harness-fixture"
  readonly label: string
}

export type WorkflowRuntimeSuspensionProjection = {
  readonly id: string
  readonly nodeId: string
  readonly kind: "human-selection"
  readonly requestedPorts: readonly WorkflowDefinitionInputPort[]
  readonly candidateAssets: readonly ServerHarnessCandidateAsset[]
}

type WorkflowRuntimeEventPayload =
  | {
      readonly type: "run.started"
      readonly definition: WorkflowDefinitionRef
      readonly retryOfRunId?: string
    }
  | {
      readonly type: "node.started"
      readonly nodeId: string
      readonly nodeKind: string
    }
  | {
      readonly type: "node.attempt.started"
      readonly nodeId: string
      readonly nodeKind: string
      readonly attempt: number
      readonly maxAttempts: number
    }
  | {
      readonly type: "node.attempt.failed"
      readonly nodeId: string
      readonly nodeKind: string
      readonly attempt: number
      readonly maxAttempts: number
      readonly willRetry: boolean
      readonly failure: Omit<
        WorkflowRuntimeFailureProjection,
        "nodeId" | "nodeKind" | "attempts" | "maxAttempts"
      >
    }
  | {
      readonly type: "node.attempt.succeeded"
      readonly nodeId: string
      readonly nodeKind: string
      readonly attempt: number
      readonly maxAttempts: number
    }
  | {
      readonly type: "node.succeeded"
      readonly nodeId: string
      readonly nodeKind: string
      readonly outputs: Readonly<Record<string, WorkflowRuntimeValue>>
      readonly adapter?:
        | typeof MUSES_SERVER_INTERPRETER_HARNESS
        | typeof MUSES_OPENAI_IMAGE_ADAPTER
        | "muses-agent-headless"
      readonly usage?: WorkflowRuntimeUsageProjection
    }
  | {
      readonly type: "node.agent.started"
      readonly nodeId: string
      readonly nodeKind: "agent-run"
      readonly agentRunId: string
    }
  | {
      readonly type: "node.waiting"
      readonly nodeId: string
      readonly nodeKind: "selector"
      readonly suspension: WorkflowRuntimeSuspensionProjection
    }
  | {
      readonly type: "run.succeeded"
      readonly outputs: Readonly<Record<string, WorkflowRuntimeValue>>
    }
  | {
      readonly type: "run.failed"
      readonly failure: WorkflowRuntimeFailureProjection
    }

export type WorkflowRuntimeEvent = WorkflowRuntimeEventPayload & {
  readonly eventId: string
  readonly runId: string
  readonly at: string
}

export type WorkflowDefinitionInterpreterResult = {
  readonly accepted: true
  readonly runtime: typeof MUSES_WORKFLOW_RUNTIME
  readonly definition: WorkflowDefinitionRef
  readonly completedNodeIds: readonly string[]
  readonly outputs: Readonly<Record<string, WorkflowRuntimeValue>>
}

export type WorkflowHumanSelectionPayload = {
  readonly suspensionId: string
  readonly selectedAssetId: string
}

export type WorkflowRuntimeUsageProjection = {
  readonly creditMicros: string
  readonly imageCount: number
  readonly providerUsage?: unknown
  readonly agentRunId?: string
  readonly agentEventCount?: number
  readonly agentUsage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
    readonly costUsd: number
    readonly steps: number
  }
}

export type WorkflowSelectorHookMetadata = {
  readonly runtime: typeof MUSES_WORKFLOW_RUNTIME
  readonly workspaceId: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly nodeId: string
  readonly suspensionId: string
  readonly candidateAssetIds: string[]
}

export async function workflowDefinitionInterpreter(
  definition: WorkflowDefinition,
  suppliedInputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>,
  options: WorkflowInterpreterHarnessOptions = {}
): Promise<WorkflowDefinitionInterpreterResult> {
  "use workflow"

  const runId = getWorkflowMetadata().workflowRunId
  let actualCreditMicros = BigInt(0)
  if (options.submissionId) {
    await attachWorkflowSdkRunStep(options.submissionId, runId)
  }
  const initial = createWorkflowExecutionState(definition, suppliedInputs)
  if (!initial.ok) {
    return finalizeAndFailInterpreterRun(
      runId,
      definitionFailure(initial.issue),
      options,
      actualCreditMicros
    )
  }
  let state = initial.value
  await emitRuntimeEventStep(runId, {
    type: "run.started",
    definition: getWorkflowDefinitionRef(definition),
    retryOfRunId: options.retryOfRunId,
  })

  while (state.nextNodeIndex < definition.executionOrder.length) {
    const preparation = prepareNextWorkflowNode(definition, state)
    if (!preparation.ok) {
      return finalizeAndFailInterpreterRun(
        runId,
        definitionFailure(preparation.issue),
        options,
        actualCreditMicros
      )
    }
    const node = preparation.value.node
    await emitRuntimeEventStep(runId, {
      type: "node.started",
      nodeId: node.id,
      nodeKind: node.kind,
    })

    switch (preparation.value.kind) {
      case "intrinsic": {
        const committed = commitWorkflowNodeOutputs(
          definition,
          state,
          node.id,
          preparation.value.outputs
        )
        if (!committed.ok) {
          return finalizeAndFailInterpreterRun(
            runId,
            definitionFailure(committed.issue),
            options,
            actualCreditMicros
          )
        }
        state = committed.value
        await emitRuntimeEventStep(runId, {
          type: "node.succeeded",
          nodeId: node.id,
          nodeKind: node.kind,
          outputs: preparation.value.outputs,
        })
        break
      }
      case "execute": {
        let execution: Awaited<ReturnType<typeof executeSupportedNodeStep>>
        try {
          const request = {
            runId,
            definition: getWorkflowDefinitionRef(definition),
            projectId: options.projectId,
            node: preparation.value.node,
            inputs: preparation.value.inputs,
            creditContext: options.creditContext,
            failureFault:
              options.failureFault?.nodeId === node.id
                ? options.failureFault
                : undefined,
          }
          execution =
            preparation.value.node.kind === "image-generator" &&
            preparation.value.node.config.capabilityId === "image.generate.v1"
              ? await executeRealImageNodeStep(
                  request as Parameters<typeof executeRealImageNodeStep>[0]
                )
              : preparation.value.node.kind === "agent-run"
                ? await executeAgentRunNode({
                    ...request,
                    node: preparation.value.node,
                    actorUserId: options.agentActorUserId,
                  })
                : await executeSupportedNodeStep(
                    request as Parameters<typeof executeSupportedNodeStep>[0]
                  )
        } catch (error) {
          const permanent = isFatalWorkflowError(error)
          const realImageNode =
            preparation.value.node.kind === "image-generator" &&
            preparation.value.node.config.capabilityId === "image.generate.v1"
          const maxAttempts = realImageNode
            ? 1
            : MUSES_SUPPORTED_NODE_MAX_ATTEMPTS
          return finalizeAndFailInterpreterRun(
            runId,
            {
              code: permanent
                ? "node-permanent-failure"
                : "node-transient-retries-exhausted",
              category: permanent ? "permanent" : "transient-exhausted",
              message: permanent
                ? `Node "${node.id}" failed permanently.`
                : realImageNode
                  ? `Node "${node.id}" stopped after a transient provider error to prevent duplicate charges.`
                  : `Node "${node.id}" exhausted its retry budget.`,
              retryable: !permanent,
              nodeId: node.id,
              nodeKind: node.kind,
              attempts: permanent ? 1 : maxAttempts,
              maxAttempts,
            },
            options,
            actualCreditMicros
          )
        }
        if (!execution.ok) {
          return finalizeAndFailInterpreterRun(
            runId,
            execution.failure,
            options,
            actualCreditMicros,
            execution.billingUncertain
          )
        }
        actualCreditMicros += BigInt(execution.usage?.creditMicros || 0)
        const committed = commitWorkflowNodeOutputs(
          definition,
          state,
          node.id,
          execution.outputs
        )
        if (!committed.ok) {
          return finalizeAndFailInterpreterRun(
            runId,
            definitionFailure(committed.issue),
            options,
            actualCreditMicros
          )
        }
        state = committed.value
        await emitRuntimeEventStep(runId, {
          type: "node.succeeded",
          nodeId: node.id,
          nodeKind: node.kind,
          outputs: execution.outputs,
          adapter: execution.adapter,
          usage: execution.usage,
        })
        break
      }
      case "suspend": {
        const suspensionId = selectorSuspensionId(node.id)
        using hook = createHook<WorkflowHumanSelectionPayload>({
          token: selectorHookToken(runId, suspensionId),
          metadata: {
            runtime: MUSES_WORKFLOW_RUNTIME,
            workspaceId: definition.workspaceId,
            definitionId: definition.definitionId,
            definitionVersion: definition.version,
            nodeId: node.id,
            suspensionId,
            candidateAssetIds: [...preparation.value.candidateAssetIds],
          } satisfies WorkflowSelectorHookMetadata,
        })
        const conflict = await hook.getConflict()
        if (conflict) {
          return finalizeAndFailInterpreterRun(
            runId,
            definitionFailure({
              code: "execution-order-invalid",
              message: `Selector hook is already owned by run "${conflict.runId}".`,
              nodeId: node.id,
            }),
            options,
            actualCreditMicros
          )
        }
        await emitRuntimeEventStep(runId, {
          type: "node.waiting",
          nodeId: node.id,
          nodeKind: "selector",
          suspension: {
            id: suspensionId,
            nodeId: node.id,
            kind: "human-selection",
            requestedPorts: preparation.value.requestedPorts,
            candidateAssets: preparation.value.candidateAssetIds.map(
              (assetId, index) => ({
                assetId,
                kind: "image" as const,
                source: "server-harness-fixture" as const,
                label: `Server direction ${index + 1}`,
              })
            ),
          },
        })
        const waitResult = await Promise.race([
          hook.then((selection) => ({ kind: "selected" as const, selection })),
          sleep(options.selectorTimeoutMs ?? MUSES_SELECTOR_TIMEOUT_MS).then(
            () => ({ kind: "timed-out" as const })
          ),
        ])
        if (waitResult.kind === "timed-out") {
          return finalizeAndFailInterpreterRun(
            runId,
            {
              code: "human-input-timeout",
              category: "timeout",
              message: `Selector node "${node.id}" timed out while waiting for human input.`,
              retryable: true,
              nodeId: node.id,
              nodeKind: node.kind,
            },
            options,
            actualCreditMicros
          )
        }
        const selection = waitResult.selection
        if (selection.suspensionId !== suspensionId) {
          return finalizeAndFailInterpreterRun(
            runId,
            definitionFailure({
              code: "invalid-human-selection",
              message: "Human selection does not match the active suspension.",
              nodeId: node.id,
            }),
            options,
            actualCreditMicros
          )
        }
        const resumed = resumeWorkflowHumanSelection(
          definition,
          state,
          node.id,
          selection.selectedAssetId
        )
        if (!resumed.ok) {
          return finalizeAndFailInterpreterRun(
            runId,
            definitionFailure(resumed.issue),
            options,
            actualCreditMicros
          )
        }
        state = resumed.value
        await emitRuntimeEventStep(runId, {
          type: "node.succeeded",
          nodeId: node.id,
          nodeKind: node.kind,
          outputs: {
            selected: {
              valueType: "image",
              assetIds: [selection.selectedAssetId],
            },
          },
        })
        break
      }
      case "complete": {
        const completed = completeWorkflowExecution(
          definition,
          state,
          preparation.value.outputs
        )
        if (!completed.ok) {
          return finalizeAndFailInterpreterRun(
            runId,
            definitionFailure(completed.issue),
            options,
            actualCreditMicros
          )
        }
        state = completed.value
        await emitRuntimeEventStep(runId, {
          type: "node.succeeded",
          nodeId: node.id,
          nodeKind: node.kind,
          outputs: preparation.value.outputs,
        })
        await emitRuntimeEventStep(runId, {
          type: "run.succeeded",
          outputs: preparation.value.outputs,
        })
        await finalizeWorkflowSubmissionStep(
          options,
          runId,
          "settle",
          actualCreditMicros,
          "Workflow run completed.",
          "completed"
        )
        return {
          accepted: true,
          runtime: MUSES_WORKFLOW_RUNTIME,
          definition: getWorkflowDefinitionRef(definition),
          completedNodeIds: state.completedNodeIds,
          outputs: preparation.value.outputs,
        }
      }
    }
  }

  return finalizeAndFailInterpreterRun(
    runId,
    definitionFailure({
      code: "execution-order-invalid",
      message: "Workflow execution order ended without a terminal result.",
    }),
    options,
    actualCreditMicros
  )
}

type WorkflowNodeExecutionSuccess = {
  readonly outputs: Readonly<Record<string, WorkflowRuntimeValue>>
  readonly adapter:
    | typeof MUSES_SERVER_INTERPRETER_HARNESS
    | typeof MUSES_OPENAI_IMAGE_ADAPTER
    | "muses-agent-headless"
  readonly usage?: WorkflowRuntimeUsageProjection
}

type WorkflowNodeExecutionResult =
  | ({ readonly ok: true } & WorkflowNodeExecutionSuccess)
  | {
      readonly ok: false
      readonly failure: WorkflowRuntimeFailureProjection
      readonly billingUncertain?: boolean
    }

async function executeSupportedNodeStep(request: {
  runId: string
  definition: WorkflowDefinitionRef
  projectId?: string
  node: Extract<WorkflowDefinition["nodes"][number], { kind: "image-generator" | "design-document" }>
  inputs: Readonly<Record<string, WorkflowRuntimeValue>>
  creditContext?: WorkflowCreditContext
  failureFault?: NonNullable<WorkflowInterpreterHarnessOptions["failureFault"]>
}): Promise<WorkflowNodeExecutionResult> {
  "use step"

  const metadata = getStepMetadata()
  const attempt = metadata.attempt
  await writeRuntimeEvent(
    request.runId,
    {
      type: "node.attempt.started",
      nodeId: request.node.id,
      nodeKind: request.node.kind,
      attempt,
      maxAttempts: MUSES_SUPPORTED_NODE_MAX_ATTEMPTS,
    },
    `${metadata.stepId}:attempt:${attempt}:started`
  )
  try {
    if (
      request.failureFault &&
      attempt <= request.failureFault.failThroughAttempt
    ) {
      if (request.failureFault.mode === "permanent") {
        throw new FatalError("Controlled permanent Harness failure.")
      }
      throw new RetryableError("Controlled transient Harness failure.", {
        retryAfter: 100,
      })
    }

    const result = executeSupportedNode(request, metadata.stepId)
    await writeRuntimeEvent(
      request.runId,
      {
        type: "node.attempt.succeeded",
        nodeId: request.node.id,
        nodeKind: request.node.kind,
        attempt,
        maxAttempts: MUSES_SUPPORTED_NODE_MAX_ATTEMPTS,
      },
      `${metadata.stepId}:attempt:${attempt}:succeeded`
    )
    return { ok: true, ...result }
  } catch (error) {
    const permanent = isFatalWorkflowError(error)
    await writeRuntimeEvent(
      request.runId,
      {
        type: "node.attempt.failed",
        nodeId: request.node.id,
        nodeKind: request.node.kind,
        attempt,
        maxAttempts: MUSES_SUPPORTED_NODE_MAX_ATTEMPTS,
        willRetry: !permanent && attempt < MUSES_SUPPORTED_NODE_MAX_ATTEMPTS,
        failure: {
          code: permanent ? "node-permanent-failure" : "node-transient-failure",
          category: permanent ? "permanent" : "transient",
          message: permanent
            ? `Node "${request.node.id}" failed permanently.`
            : `Node "${request.node.id}" failed transiently.`,
          retryable: !permanent,
        },
      },
      `${metadata.stepId}:attempt:${attempt}:failed`
    )
    if (!permanent && attempt < MUSES_SUPPORTED_NODE_MAX_ATTEMPTS) {
      throw error
    }
    return {
      ok: false,
      failure: {
        code: permanent
          ? "node-permanent-failure"
          : "node-transient-retries-exhausted",
        category: permanent ? "permanent" : "transient-exhausted",
        message: permanent
          ? `Node "${request.node.id}" failed permanently.`
          : `Node "${request.node.id}" exhausted its retry budget.`,
        retryable: !permanent,
        nodeId: request.node.id,
        nodeKind: request.node.kind,
        attempts: attempt,
        maxAttempts: MUSES_SUPPORTED_NODE_MAX_ATTEMPTS,
      },
    }
  }
}
executeSupportedNodeStep.maxRetries = MUSES_SUPPORTED_NODE_MAX_RETRIES

async function executeAgentRunNode(request: {
  runId: string
  definition: WorkflowDefinitionRef
  projectId?: string
  node: Extract<WorkflowDefinition["nodes"][number], { kind: "agent-run" }>
  inputs: Readonly<Record<string, WorkflowRuntimeValue>>
  actorUserId?: string
}): Promise<WorkflowNodeExecutionResult> {
  const message = request.inputs.message
  if (!message || message.valueType !== "text" || !message.value.trim()) {
    throw new FatalError("Agent run requires a non-empty message.")
  }
  if (!request.actorUserId?.trim()) {
    throw new FatalError("Agent run requires an authenticated host principal.")
  }

  const idempotencyKey = `workflow-agent-run:${request.runId}:${request.node.id}`
  let started: MusesAgentRunSnapshot
  try {
    started = await startAgentRunStep({
      actorUserId: request.actorUserId,
      definition: request.definition,
      projectId: request.projectId,
      idempotencyKey,
      message: message.value,
      node: request.node,
      runId: request.runId,
    })
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: "agent-run-submit-failed",
        category: "permanent",
        message: error instanceof Error ? error.message : "The AgentRun could not be submitted.",
        retryable: false,
        nodeId: request.node.id,
        nodeKind: request.node.kind,
      },
    }
  }

  await emitRuntimeEventStep(request.runId, {
    type: "node.agent.started",
    nodeId: request.node.id,
    nodeKind: request.node.kind,
    agentRunId: started.runId,
  })

  let snapshot = started
  // Workflows replay from their event log. A bounded poll count is stable across
  // replays, unlike a wall-clock deadline that can be reset by a resumed worker.
  const maxPolls = 450 // 15 minutes at the two-second durable poll interval.
  let polls = 0
  while (snapshot.status !== "completed" && snapshot.status !== "failed" && snapshot.status !== "cancelled") {
    if (polls >= maxPolls) {
      await cancelAgentRunStep({
        actorUserId: request.actorUserId,
        runId: snapshot.runId,
        workspaceId: request.definition.workspaceId,
        projectId: request.projectId,
      }).catch(() => undefined)
      return {
        ok: false,
        failure: {
          code: "agent-run-timeout",
          category: "timeout",
          message: "The AgentRun exceeded the 15 minute workflow node timeout.",
          retryable: true,
          nodeId: request.node.id,
          nodeKind: request.node.kind,
        },
      }
    }
    await sleep("2s")
    polls += 1
    snapshot = await inspectAgentRunStep({
      actorUserId: request.actorUserId,
      runId: snapshot.runId,
      workspaceId: request.definition.workspaceId,
      projectId: request.projectId,
    })
  }

  if (snapshot.status !== "completed" || !snapshot.result) {
    return {
      ok: false,
      failure: {
        code: snapshot.failure?.code || "agent-run-failed",
        category: "permanent",
        message: snapshot.failure?.message || "The AgentRun did not complete.",
        retryable: Boolean(snapshot.failure?.retryable),
        nodeId: request.node.id,
        nodeKind: request.node.kind,
      },
    }
  }
  const value = snapshot.result.kind === "text"
    ? String(snapshot.result.value)
    : JSON.stringify(snapshot.result.value)
  return {
    ok: true,
    adapter: "muses-agent-headless",
    outputs: { result: { valueType: "text", value } },
    usage: {
      creditMicros: "0",
      imageCount: 0,
      agentRunId: snapshot.runId,
      ...(typeof snapshot.eventCount === "number"
        ? { agentEventCount: snapshot.eventCount }
        : {}),
      agentUsage: snapshot.usage,
    },
  }
}

async function startAgentRunStep(request: {
  actorUserId: string
  definition: WorkflowDefinitionRef
  projectId?: string
  idempotencyKey: string
  message: string
  node: Extract<WorkflowDefinition["nodes"][number], { kind: "agent-run" }>
  runId: string
}): Promise<MusesAgentRunSnapshot> {
  "use step"

  const profile = getWorkflowAgentProfile(
    request.node.config.profileId,
    request.node.config.profileVersion,
  )
  if (!profile) {
    throw new FatalError(
      `Agent profile ${request.node.config.profileId}@${request.node.config.profileVersion} is not published.`,
    )
  }
  const requiredPermissions = request.node.config.requiredPermissions ?? profile.requiredPermissions
  const profilePermissions = new Set(profile.requiredPermissions)
  if (requiredPermissions.some((permission) => !profilePermissions.has(permission))) {
    throw new FatalError("The Agent node requests a permission outside its published Profile.")
  }
  const budget = clampWorkflowAgentBudget(profile, request.node.config.budget)
  const hostCapabilities = hostCapabilitiesForWorkflowAgent(profile, requiredPermissions)

  const client = createMusesAgentHostClient({
    userId: request.actorUserId,
    workspaceId: request.definition.workspaceId,
    actorType: "service",
    ...(request.projectId ? { projectId: request.projectId } : {}),
  })
  const response = await client.start({
    idempotencyKey: request.idempotencyKey,
    message: request.message,
    profile: {
      profileId: profile.profileId,
      version: profile.profileVersion,
    },
    policy: {
      hostCapabilities,
      limits: budget,
    },
    ...(request.node.config.outputMode === "json" && request.node.config.outputSchema
      ? { outputSchema: requireAgentJsonObject(request.node.config.outputSchema) }
      : {}),
    metadata: {
      workflowRunId: request.runId,
      workflowDefinitionId: request.definition.definitionId,
      workflowNodeId: request.node.id,
    },
  })
  return response.run
}
startAgentRunStep.maxRetries = 0

async function inspectAgentRunStep(request: {
  actorUserId: string
  runId: string
  workspaceId: string
  projectId?: string
}): Promise<MusesAgentRunSnapshot> {
  "use step"

  return createMusesAgentHostClient({
    userId: request.actorUserId,
    workspaceId: request.workspaceId,
    actorType: "service",
    ...(request.projectId ? { projectId: request.projectId } : {}),
  }).inspect(request.runId)
}
inspectAgentRunStep.maxRetries = 0

async function cancelAgentRunStep(request: {
  actorUserId: string
  runId: string
  workspaceId: string
  projectId?: string
}) {
  "use step"

  return createMusesAgentHostClient({
    userId: request.actorUserId,
    workspaceId: request.workspaceId,
    actorType: "service",
    ...(request.projectId ? { projectId: request.projectId } : {}),
  }).cancel(request.runId)
}
cancelAgentRunStep.maxRetries = 0

async function executeRealImageNodeStep(
  request: Parameters<typeof executeSupportedNodeStep>[0]
): Promise<Awaited<ReturnType<typeof executeSupportedNodeStep>>> {
  "use step"

  if (request.node.kind !== "image-generator") {
    throw new FatalError("The real image adapter only accepts image nodes.")
  }
  const projectId = request.projectId?.trim()
  if (!projectId) {
    throw new FatalError(
      "Image generation requires an authorized Project scope."
    )
  }
  const prompt = request.inputs.prompt
  if (!prompt || prompt.valueType !== "text" || !prompt.value.trim()) {
    throw new FatalError("Image generation requires a non-empty prompt.")
  }
  const imageConfig = request.node.config
  const executionModel = request.creditContext?.nodePrices.find(
    (candidate) => candidate.nodeId === request.node.id
  )
  if (
    !executionModel ||
    executionModel.modelRef !== imageConfig.modelRef ||
    executionModel.providerId !== "provider_openai"
  ) {
    throw new FatalError(
      "The image model execution snapshot is missing or incompatible."
    )
  }
  let providerConfig
  try {
    providerConfig = await resolveOpenAiImageExecutionConfig({
      providerId: executionModel.providerId,
      providerModelId: executionModel.providerModelId,
      offeringId: executionModel.modelOfferingId,
      providerConnectionId: executionModel.providerConnectionId,
    })
  } catch {
    throw new FatalError("The OpenAI image provider is misconfigured.")
  }
  if (!providerConfig) {
    throw new FatalError("The OpenAI image provider is not configured.")
  }

  const metadata = getStepMetadata()
  await writeRuntimeEvent(
    request.runId,
    {
      type: "node.attempt.started",
      nodeId: request.node.id,
      nodeKind: request.node.kind,
      attempt: 1,
      maxAttempts: 1,
    },
    `${metadata.stepId}:attempt:1:started`
  )

  try {
    const provider = createOpenAI({
      apiKey: providerConfig.apiKey,
      ...(providerConfig.baseURL ? { baseURL: providerConfig.baseURL } : {}),
    })
    const size = executionModel.resolvedSize
    const referenceImages = await resolveReferenceImageBytes(
      request.definition.workspaceId,
      request.inputs.referenceImages,
      executionModel.referenceImageAssetIds
    )
    if (referenceImages.length > executionModel.referenceImages.maxCount) {
      throw new FatalError("Reference image count exceeds the model profile.")
    }
    const result = await generateImage({
      model: provider.image(executionModel.providerModelId),
      prompt:
        referenceImages.length > 0
          ? { text: prompt.value.trim(), images: referenceImages }
          : prompt.value.trim(),
      n: imageConfig.output.count,
      size: size.providerSize,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(5 * 60 * 1000),
      providerOptions: {
        openai: {
          quality:
            imageConfig.quality as OpenAIImageModelGenerationOptions["quality"],
          outputFormat: "png",
        } satisfies OpenAIImageModelGenerationOptions,
      },
    })

    const createdAt = new Date().toISOString()
    const assets: WorkflowRuntimeImageAsset[] = await Promise.all(
      result.images.map(async (image, index) => {
        const mimeType = normalizeGeneratedImageMimeType(image.mediaType)
        const prepared = await inspectGeneratedImage(image.uint8Array, mimeType)
        const stored = await storeGeneratedImage({
          workspaceId: request.definition.workspaceId,
          projectId,
          runId: request.runId,
          nodeId: request.node.id,
          stepId: metadata.stepId,
          index,
          bytes: prepared.bytes,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          prompt: prompt.value.trim(),
          provider: "openai",
          modelRef: imageConfig.modelRef,
          createdAt,
        })
        return {
          id: stored.assetId,
          url: stored.url,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          prompt: prompt.value.trim(),
          provider: "openai",
          modelRef: imageConfig.modelRef,
          createdAt,
          outputSize: size,
          source: {
            workspaceId: request.definition.workspaceId,
            runId: request.runId,
            nodeId: request.node.id,
          },
        }
      })
    )

    await writeRuntimeEvent(
      request.runId,
      {
        type: "node.attempt.succeeded",
        nodeId: request.node.id,
        nodeKind: request.node.kind,
        attempt: 1,
        maxAttempts: 1,
      },
      `${metadata.stepId}:attempt:1:succeeded`
    )
    const creditMicros = creditChargeForNode(
      request.creditContext,
      request.node.id,
      assets.length
    )
    return {
      ok: true,
      adapter: MUSES_OPENAI_IMAGE_ADAPTER,
      usage: {
        creditMicros: creditMicros.toString(),
        imageCount: assets.length,
        providerUsage: result.usage,
      },
      outputs: {
        image: {
          valueType: "image",
          assetIds: assets.map((asset) => asset.id),
          assets,
        },
      },
    }
  } catch (error) {
    const permanent = isDefinitiveImageProviderRejection(error)
    await writeRuntimeEvent(
      request.runId,
      {
        type: "node.attempt.failed",
        nodeId: request.node.id,
        nodeKind: request.node.kind,
        attempt: 1,
        maxAttempts: 1,
        willRetry: false,
        failure: {
          code: permanent
            ? "image-provider-request-rejected"
            : "image-provider-temporary-failure",
          category: permanent ? "permanent" : "transient",
          message: permanent
            ? "The image provider rejected this request."
            : "The image provider is temporarily unavailable. Automatic retry was skipped to prevent duplicate charges.",
          retryable: !permanent,
        },
      },
      `${metadata.stepId}:attempt:1:failed`
    )
    return {
      ok: false,
      billingUncertain: !permanent,
      failure: {
        code: permanent
          ? "image-provider-request-rejected"
          : "image-provider-temporary-failure",
        category: permanent ? "permanent" : "transient-exhausted",
        message: permanent
          ? "The image provider rejected this request."
          : "The image provider is temporarily unavailable. Automatic retry was skipped to prevent duplicate charges.",
        retryable: !permanent,
        nodeId: request.node.id,
        nodeKind: request.node.kind,
        attempts: 1,
        maxAttempts: 1,
      },
    }
  }
}
executeRealImageNodeStep.maxRetries = 0

function executeSupportedNode(
  request: Parameters<typeof executeSupportedNodeStep>[0],
  stepId: string
): WorkflowNodeExecutionSuccess {
  switch (request.node.kind) {
    case "image-generator": {
      const prompt = request.inputs.prompt
      if (!prompt || prompt.valueType !== "text") {
        throw new FatalError("Server image Harness requires a text prompt.")
      }
      return {
        adapter: MUSES_SERVER_INTERPRETER_HARNESS,
        outputs: {
          image: {
            valueType: "image",
            assetIds: [1, 2, 3].map(
              (index) => `muses-server-fixture:${stepId}:image:${index}`
            ),
          },
        },
      }
    }
    case "design-document": {
      const image = request.inputs.image
      if (
        !image ||
        image.valueType !== "image" ||
        image.assetIds.length !== 1
      ) {
        throw new FatalError(
          "Server DesignDocument Harness requires one selected image."
        )
      }
      return {
        adapter: MUSES_SERVER_INTERPRETER_HARNESS,
        outputs: {
          document: {
            valueType: "design-document",
            documentId: request.node.config.documentId,
            revision: 0,
          },
        },
      }
    }
  }
}

function normalizeGeneratedImageMimeType(
  mediaType: string
): "image/png" | "image/jpeg" | "image/webp" {
  if (mediaType === "image/jpeg") return mediaType
  if (mediaType === "image/webp") return mediaType
  return "image/png"
}

async function inspectGeneratedImage(
  bytes: Uint8Array,
  mimeType: "image/png" | "image/jpeg" | "image/webp"
) {
  const input = Buffer.from(bytes)
  const metadata = await sharp(input).metadata()
  const originalWidth = metadata.width
  const originalHeight = metadata.height
  if (!originalWidth || !originalHeight) {
    throw new Error("The generated image dimensions could not be read.")
  }
  return {
    bytes,
    mimeType,
    width: originalWidth,
    height: originalHeight,
  }
}

async function resolveReferenceImageBytes(
  workspaceId: string,
  input: WorkflowRuntimeValue | undefined,
  fixedAssetIds: readonly string[]
) {
  if (!input || input.valueType !== "image" || input.assetIds.length === 0) {
    return []
  }
  if (fixedAssetIds.length > 0) {
    const references = await readReadyReferenceImageBytes({
      workspaceId,
      assetIds: fixedAssetIds,
    })
    return references.map((reference) => reference.bytes)
  }
  const assets = input.assets || []
  if (assets.length !== input.assetIds.length) {
    throw new FatalError(
      "Variable reference images require authorized runtime asset metadata."
    )
  }
  return Promise.all(
    assets.map(async (asset) => {
      if (asset.source.workspaceId !== workspaceId) {
        throw new FatalError(
          "Variable reference image belongs to another workspace."
        )
      }
      const persisted = await getGeneratedImageAsset({
        workspaceId,
        workflowRunId: asset.source.runId,
        assetId: asset.id,
      })
      if (!persisted || persisted.mimeType !== asset.mimeType) {
        throw new FatalError(
          "Variable reference image is not available in the Asset store."
        )
      }
      const object = await readGeneratedImage({
        objectKey: persisted.objectKey,
        mimeType: persisted.mimeType,
      })
      return object.bytes
    })
  )
}

function isFatalWorkflowError(error: unknown) {
  return (
    error instanceof FatalError ||
    (error !== null &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "FatalError")
  )
}

async function emitRuntimeEventStep(
  runId: string,
  payload: WorkflowRuntimeEventPayload
): Promise<WorkflowRuntimeEvent> {
  "use step"

  const event: WorkflowRuntimeEvent = {
    ...payload,
    eventId: getStepMetadata().stepId,
    runId,
    at: new Date().toISOString(),
  }
  await writeRuntimeEventValue(event)
  return event
}

async function writeRuntimeEvent(
  runId: string,
  payload: WorkflowRuntimeEventPayload,
  eventId: string
): Promise<WorkflowRuntimeEvent> {
  const event: WorkflowRuntimeEvent = {
    ...payload,
    eventId,
    runId,
    at: new Date().toISOString(),
  }
  await writeRuntimeEventValue(event)
  return event
}

async function writeRuntimeEventValue(event: WorkflowRuntimeEvent) {
  const writer = getWritable<WorkflowRuntimeEvent>({
    namespace: MUSES_RUNTIME_STREAM_NAMESPACE,
  }).getWriter()
  try {
    await writer.write(event)
  } finally {
    writer.releaseLock()
  }
}

async function failInterpreterRun(
  runId: string,
  failure: WorkflowRuntimeFailureProjection
): Promise<never> {
  await emitRuntimeEventStep(runId, { type: "run.failed", failure })
  throw new FatalError(failure.message)
}

async function finalizeAndFailInterpreterRun(
  runId: string,
  failure: WorkflowRuntimeFailureProjection,
  submission: Pick<
    WorkflowInterpreterHarnessOptions,
    "submissionId" | "creditContext"
  >,
  actualCreditMicros: bigint,
  billingUncertain = false
): Promise<never> {
  await finalizeWorkflowSubmissionStep(
    submission,
    runId,
    billingUncertain
      ? "review"
      : actualCreditMicros > BigInt(0)
        ? "settle"
        : "release",
    actualCreditMicros,
    billingUncertain
      ? "Provider result is uncertain and requires billing review."
      : failure.message,
    "failed"
  )
  return failInterpreterRun(runId, failure)
}

async function attachWorkflowSdkRunStep(submissionId: string, runId: string) {
  "use step"

  await attachWorkflowSdkRun(submissionId, runId)
}
attachWorkflowSdkRunStep.maxRetries = 3

async function finalizeWorkflowSubmissionStep(
  submission: Pick<
    WorkflowInterpreterHarnessOptions,
    "submissionId" | "creditContext"
  >,
  runId: string,
  status: "settle" | "release" | "review",
  actualCreditMicros: bigint,
  reason: string,
  workflowStatus: "completed" | "failed" | "cancelled"
) {
  "use step"

  if (submission.creditContext) {
    await finalizeCreditReservation({
      reservationId: submission.creditContext.reservationId,
      workflowRunId: runId,
      status,
      actualMicros: actualCreditMicros,
      reason,
      workflowStatus,
    })
  } else if (submission.submissionId) {
    await finalizeUnreservedWorkflowSubmission({
      submissionId: submission.submissionId,
      workflowRunId: runId,
      status: workflowStatus,
    })
  }
}
finalizeWorkflowSubmissionStep.maxRetries = 3

function definitionFailure(
  issue: WorkflowInterpreterIssue
): WorkflowRuntimeFailureProjection {
  return {
    code: issue.code,
    category: "definition",
    message: issue.message,
    retryable: false,
    nodeId: issue.nodeId,
  }
}

export function selectorSuspensionId(nodeId: string) {
  return `selector:${nodeId}`
}

export function selectorHookToken(runId: string, suspensionId: string) {
  return `muses:selector:${runId}:${suspensionId}`
}

export function isWorkflowSelectorHookMetadata(
  value: unknown
): value is WorkflowSelectorHookMetadata {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<WorkflowSelectorHookMetadata>
  return (
    candidate.runtime === MUSES_WORKFLOW_RUNTIME &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.definitionId === "string" &&
    typeof candidate.definitionVersion === "number" &&
    typeof candidate.nodeId === "string" &&
    typeof candidate.suspensionId === "string" &&
    Array.isArray(candidate.candidateAssetIds) &&
    candidate.candidateAssetIds.every((assetId) => typeof assetId === "string")
  )
}

export function getActiveRuntimeSuspension(
  events: readonly WorkflowRuntimeEvent[]
): WorkflowRuntimeSuspensionProjection | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== "node.waiting") continue
    const resumed = events
      .slice(index + 1)
      .some(
        (candidate) =>
          candidate.type === "node.succeeded" &&
          candidate.nodeId === event.nodeId
      )
    if (!resumed) return event.suspension
  }
  return undefined
}

export function getRunStartedEvent(events: readonly WorkflowRuntimeEvent[]) {
  return events.find(
    (event): event is Extract<WorkflowRuntimeEvent, { type: "run.started" }> =>
      event.type === "run.started"
  )
}

export function getRunFailureEvent(events: readonly WorkflowRuntimeEvent[]) {
  return events.findLast(
    (event): event is Extract<WorkflowRuntimeEvent, { type: "run.failed" }> =>
      event.type === "run.failed"
  )
}

export function getRuntimeAttemptProjections(
  events: readonly WorkflowRuntimeEvent[]
): WorkflowRuntimeAttemptProjection[] {
  const attempts = new Map<string, WorkflowRuntimeAttemptProjection>()
  for (const event of events) {
    if (
      event.type !== "node.attempt.started" &&
      event.type !== "node.attempt.failed" &&
      event.type !== "node.attempt.succeeded"
    ) {
      continue
    }
    const status =
      event.type === "node.attempt.started"
        ? "running"
        : event.type === "node.attempt.succeeded"
          ? "succeeded"
          : event.willRetry
            ? "retrying"
            : "failed"
    attempts.set(event.nodeId, {
      nodeId: event.nodeId,
      nodeKind: event.nodeKind,
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      status,
    })
  }
  return [...attempts.values()]
}

export function isWorkflowInterpreterHarnessOptions(
  value: unknown
): value is WorkflowInterpreterHarnessOptions {
  if (value === undefined) return true
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<WorkflowInterpreterHarnessOptions>
  if (
    candidate.projectId !== undefined &&
    (typeof candidate.projectId !== "string" || !candidate.projectId.trim())
  ) {
    return false
  }
  if (
    candidate.retryOfRunId !== undefined &&
    typeof candidate.retryOfRunId !== "string"
  ) {
    return false
  }
  if (
    candidate.submissionId !== undefined &&
    typeof candidate.submissionId !== "string"
  ) {
    return false
  }
  if (
    candidate.creditContext !== undefined &&
    !isWorkflowCreditContext(candidate.creditContext)
  ) {
    return false
  }
  if (
    candidate.selectorTimeoutMs !== undefined &&
    (!Number.isFinite(candidate.selectorTimeoutMs) ||
      candidate.selectorTimeoutMs <= 0)
  ) {
    return false
  }
  if (candidate.failureFault === undefined) return true
  const fault = candidate.failureFault
  return (
    typeof fault.nodeId === "string" &&
    (fault.mode === "permanent" || fault.mode === "transient") &&
    Number.isInteger(fault.failThroughAttempt) &&
    fault.failThroughAttempt > 0
  )
}

function isWorkflowCreditContext(
  value: unknown
): value is WorkflowCreditContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<WorkflowCreditContext>
  return (
    typeof candidate.reservationId === "string" &&
    typeof candidate.estimatedMicros === "string" &&
    Array.isArray(candidate.nodePrices) &&
    candidate.nodePrices.every(
      (price) =>
        typeof price.nodeId === "string" &&
        typeof price.priceBookEntryId === "string" &&
        typeof price.unitCreditMicros === "string"
    )
  )
}
