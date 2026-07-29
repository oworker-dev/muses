export const A9_FIXED_EVAL_SUITE = {
  schemaVersion: "muses-agent-eval-suite-v1",
  suiteId: "agent-core-a9-reliability",
  version: "1.0.0",
  runtime: "muses-headless",
  modelFixture: "fixture/deterministic-v1",
  cases: [
    {
      id: "success-canvas-command",
      category: "success",
      expected: {
        status: "completed",
        turns: 2,
        modelCalls: 2,
        toolCalls: 1,
        toolExecutions: 1,
        scopedToVerifiedRun: true,
        terminalCheckpoint: true,
      },
    },
    {
      id: "recover-after-driver-retry",
      category: "recovery",
      expected: {
        retryCode: "model-call-in-progress",
        statusBeforeRecovery: "running",
        modelEventsBeforeRecovery: 0,
        status: "completed",
        modelCalls: 1,
        toolCalls: 0,
        toolExecutions: 0,
      },
    },
    {
      id: "refuse-policy-denied-tool",
      category: "refusal",
      expected: {
        status: "completed",
        policyDenials: 1,
        toolCalls: 0,
        toolExecutions: 0,
      },
    },
    {
      id: "budget-stops-before-model",
      category: "budget",
      expected: {
        status: "failed",
        failureCode: "input-token-budget-exceeded",
        modelCompletions: 0,
        modelCalls: 0,
        toolCalls: 0,
        creditMicros: "0",
        toolExecutions: 0,
      },
    },
    {
      id: "approval-gates-external-tool",
      category: "approval",
      expected: {
        waitingStatus: "waiting-approval",
        executionsBeforeApproval: 0,
        status: "completed",
        approvalRequests: 1,
        approvalDecisions: 1,
        toolCalls: 1,
        toolExecutions: 1,
      },
    },
    {
      id: "cancellation-fences-late-model",
      category: "cancellation",
      expected: {
        lateResultError: "revision-conflict",
        status: "cancelled",
        turns: 0,
        modelCalls: 0,
        modelEvents: 0,
        cancellationEvents: 1,
        toolExecutions: 0,
      },
    },
    {
      id: "isolation-rejects-snapshot-drift",
      category: "isolation",
      expected: {
        snapshotState: "pinned",
        networkDefault: "deny",
        filesystemNamespace: "agent-run/eval-isolation",
        driftError: "extension-snapshot-invalid",
        modelCompletions: 0,
        toolExecutions: 0,
      },
    },
    {
      id: "unknown-tool-has-no-side-effect",
      category: "no-side-effect",
      expected: {
        status: "completed",
        toolDenials: 1,
        toolCalls: 0,
        toolExecutions: 0,
      },
    },
  ],
} as const;

export type A9FixedEvalCase = (typeof A9_FIXED_EVAL_SUITE.cases)[number];
