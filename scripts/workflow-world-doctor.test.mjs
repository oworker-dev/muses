import assert from "node:assert/strict";
import test from "node:test";

import {
  MUSES_WORKFLOW_SPEC_VERSION,
  analyzeWorkflowWorldSnapshot,
} from "./lib/workflow-world-doctor.mjs";

const cleanSnapshot = {
  expectedJobPrefix: "muses_",
  jobGroups: [
    { count: 2, exhausted: 0, taskIdentifier: "muses_flows" },
    { count: 1, exhausted: 0, taskIdentifier: "muses_steps" },
  ],
  jobsView: true,
  specVersions: [{ count: 3, specVersion: MUSES_WORKFLOW_SPEC_VERSION }],
  workflowRunsTable: true,
};

test("accepts one isolated Muses Workflow World", () => {
  assert.deepEqual(analyzeWorkflowWorldSnapshot(cleanSnapshot), []);
});

test("rejects incompatible specs and foreign queue owners", () => {
  const diagnostics = analyzeWorkflowWorldSnapshot({
    ...cleanSnapshot,
    jobGroups: [
      ...cleanSnapshot.jobGroups,
      { count: 2, exhausted: 2, taskIdentifier: "muses_agent_flows" },
    ],
    specVersions: [
      ...cleanSnapshot.specVersions,
      { count: 2, specVersion: "5" },
    ],
  });

  assert.deepEqual(
    diagnostics.filter((item) => item.level === "error").map((item) => item.code),
    ["workflow-world-spec-contamination", "workflow-world-shared-queue"],
  );
});

test("warns about exhausted jobs without hiding a clean spec boundary", () => {
  const diagnostics = analyzeWorkflowWorldSnapshot({
    ...cleanSnapshot,
    jobGroups: [{ count: 4, exhausted: 1, taskIdentifier: "muses_flows" }],
  });

  assert.deepEqual(diagnostics.map((item) => item.code), ["workflow-world-exhausted-jobs"]);
});

test("fails closed when the World schema is absent", () => {
  const diagnostics = analyzeWorkflowWorldSnapshot({
    ...cleanSnapshot,
    workflowRunsTable: false,
  });

  assert.deepEqual(diagnostics.map((item) => item.code), ["workflow-world-schema"]);
});
