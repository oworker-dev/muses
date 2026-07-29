import { start } from "workflow/api"

import {
  getWorkflowDefinitionRef,
  type WorkflowInvocationCaller,
  type WorkflowInvocationTarget,
  type WorkflowRuntimeScalarValue,
} from "@muses/domain"

import {
  attachWorkflowSdkRun,
  claimWorkflowSubmission,
  failWorkflowStart,
  fingerprintWorkflowSubmission,
} from "@/lib/credit-ledger"
import { ModelCatalogError } from "@/lib/model-catalog"
import {
  WorkflowCatalogStoreError,
  inspectWorkflowInvocationTarget,
} from "@/lib/workflow-catalog-store"
import {
  workflowDefinitionInterpreter,
  type WorkflowInterpreterHarnessOptions,
} from "@/workflows/workflow-definition-interpreter"

export type StartPublishedWorkflowInvocationResult =
  | {
      state: "started" | "replayed"
      runId: string
      definition: ReturnType<typeof getWorkflowDefinitionRef>
      deploymentId?: string
      idempotentReplay: boolean
      estimatedMicros: bigint
      availableAfterReserveMicros?: bigint
      topologicalOrder: readonly string[]
    }
  | { state: "in-progress" }
  | { state: "idempotency-conflict" }
  | {
      state: "insufficient-credits"
      requiredMicros: bigint
      availableMicros: bigint
    }
  | { state: "runtime-unavailable" }

export async function startPublishedWorkflowInvocation(input: {
  workspaceId: string
  submittedByUserId: string
  caller: WorkflowInvocationCaller
  target: WorkflowInvocationTarget
  inputs: Readonly<Record<string, WorkflowRuntimeScalarValue>>
  idempotencyKey: string
  harnessOptions?: WorkflowInterpreterHarnessOptions
}): Promise<StartPublishedWorkflowInvocationResult> {
  const inspection = await inspectWorkflowInvocationTarget({
    workspaceId: input.workspaceId,
    target: input.target,
  })
  const deploymentId = inspection.deployment?.deploymentId
  const harnessOptions = input.harnessOptions || {}
  const requestFingerprint = fingerprintWorkflowSubmission({
    definition: inspection.definition,
    deploymentId,
    caller: input.caller,
    inputs: input.inputs,
    harnessOptions,
  })
  const claim = await claimWorkflowSubmission({
    workspaceId: input.workspaceId,
    userId: input.submittedByUserId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    definition: inspection.definition,
    deploymentId,
    caller: input.caller,
  }).catch((error: unknown) => {
    if (
      error instanceof ModelCatalogError ||
      error instanceof WorkflowCatalogStoreError
    ) {
      throw error
    }
    throw error
  })
  if (claim.state === "replayed") {
    return {
      state: "replayed",
      runId: claim.sdkRunId,
      definition: getWorkflowDefinitionRef(inspection.definition),
      ...(deploymentId ? { deploymentId } : {}),
      idempotentReplay: true,
      estimatedMicros: claim.estimatedMicros,
      topologicalOrder: inspection.definition.executionOrder,
    }
  }
  if (claim.state !== "claimed") return claim

  try {
    const run = await start(workflowDefinitionInterpreter, [
      inspection.definition,
      input.inputs,
      {
        ...harnessOptions,
        submissionId: claim.submissionId,
        creditContext: claim.creditContext,
      },
    ])
    await attachWorkflowSdkRun(claim.submissionId, run.runId)
    return {
      state: "started",
      runId: run.runId,
      definition: getWorkflowDefinitionRef(inspection.definition),
      ...(deploymentId ? { deploymentId } : {}),
      idempotentReplay: false,
      estimatedMicros: claim.estimatedMicros,
      availableAfterReserveMicros: claim.availableAfterReserveMicros,
      topologicalOrder: inspection.definition.executionOrder,
    }
  } catch {
    await failWorkflowStart(
      claim.submissionId,
      "Workflow SDK did not accept the run submission."
    ).catch(() => undefined)
    return { state: "runtime-unavailable" }
  }
}
