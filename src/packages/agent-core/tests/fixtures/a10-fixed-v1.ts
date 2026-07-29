export const A10_FIXED_EVAL_SUITE = {
  schemaVersion: "muses-agent-eval-suite-v1",
  suiteId: "agent-orchestration-a10-recovery",
  version: "1.0.0",
  runtime: "muses-delegation-scheduler",
  childRuntimeFixture: "fixture/delegated-child-v1",
  cases: [
    {
      id: "parallel-dag-aggregates",
      category: "success",
      expected: {
        status: "completed",
        completedTasks: 3,
        childStarts: 3,
        uniqueChildRuns: 3,
        envelopeSettles: 1,
        taskSettles: 3,
        terminalEvent: "delegation.completed",
      },
    },
    {
      id: "restart-reclaims-expired-lease",
      category: "recovery",
      expected: {
        firstFailure: "profile-registry-unavailable",
        statusBeforeRestart: "running",
        status: "completed",
        claimEvents: 2,
        recoveredClaims: 1,
        childStarts: 1,
      },
    },
    {
      id: "receipt-survives-budget-outage",
      category: "recovery",
      expected: {
        firstFailure: "task-reservation-unavailable",
        preparedChildIdentity: true,
        status: "completed",
        childSubmissionEvents: 1,
        childStarts: 1,
        childIdentityStable: true,
      },
    },
    {
      id: "isolate-preserves-independent-branch",
      category: "failure-isolation",
      expected: {
        status: "completed-with-failures",
        failedTasks: 1,
        completedTasks: 1,
        blockedTasks: 1,
        blockedChildStarts: 0,
      },
    },
    {
      id: "fail-fast-cancels-running-sibling",
      category: "cancellation",
      expected: {
        status: "failed",
        failureCode: "required-failed",
        cancelledTasks: 1,
        childCancellations: 1,
        taskCancelEvents: 1,
      },
    },
    {
      id: "ambiguous-cost-requires-review",
      category: "billing",
      expected: {
        status: "completed",
        taskBudgetStatus: "review-required",
        envelopeBudgetStatus: "review-required",
        taskReviews: 1,
        envelopeReviews: 1,
        duplicateFinalizations: 0,
      },
    },
  ],
} as const;

export type A10FixedEvalCase = (typeof A10_FIXED_EVAL_SUITE.cases)[number];
