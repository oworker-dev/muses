import pg from "pg";

export const MUSES_WORKFLOW_SPEC_VERSION = "3";

export function analyzeWorkflowWorldSnapshot(snapshot) {
  const diagnostics = [];
  const expectedTasks = new Set([
    `${snapshot.expectedJobPrefix}flows`,
    `${snapshot.expectedJobPrefix}steps`,
  ]);

  if (!snapshot.workflowRunsTable) {
    diagnostics.push({
      code: "workflow-world-schema",
      level: "error",
      message: "The workflow.workflow_runs table is missing. Bootstrap the Muses Workflow World before deployment.",
    });
    return diagnostics;
  }

  for (const row of snapshot.specVersions) {
    if (row.specVersion !== MUSES_WORKFLOW_SPEC_VERSION && row.count > 0) {
      diagnostics.push({
        code: "workflow-world-spec-contamination",
        level: "error",
        message: `Found ${row.count} Workflow Run(s) with incompatible spec ${row.specVersion || "unset"}; Muses accepts spec ${MUSES_WORKFLOW_SPEC_VERSION}. Use an isolated World and the reviewed recovery runbook.`,
      });
    }
  }

  if (!snapshot.jobsView) {
    diagnostics.push({
      code: "workflow-world-queue-schema",
      level: "error",
      message: "The graphile_worker.jobs view is missing. Bootstrap the configured PostgreSQL World before deployment.",
    });
    return diagnostics;
  }

  for (const row of snapshot.jobGroups) {
    if (!expectedTasks.has(row.taskIdentifier)) {
      diagnostics.push({
        code: "workflow-world-shared-queue",
        level: "error",
        message: `Found ${row.count} queued job(s) owned by unexpected task ${row.taskIdentifier}. Muses requires an isolated Workflow World database, not only a unique queue prefix.`,
      });
      continue;
    }
    if (row.exhausted > 0) {
      diagnostics.push({
        code: "workflow-world-exhausted-jobs",
        level: "warning",
        message: `Found ${row.exhausted} exhausted ${row.taskIdentifier} job(s). Review their Run state before applying the recovery runbook.`,
      });
    }
  }

  return diagnostics;
}
export async function inspectWorkflowWorld({ connectionString, jobPrefix }) {
  if (!connectionString?.trim()) {
    throw new Error("WORKFLOW_POSTGRES_URL is required for the Workflow World inspection.");
  }
  if (!jobPrefix?.trim()) {
    throw new Error("WORKFLOW_POSTGRES_JOB_PREFIX is required for the Workflow World inspection.");
  }

  const client = new pg.Client({
    application_name: "muses-production-doctor",
    connectionString,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });

  await client.connect();
  try {
    await client.query("begin read only");
    const relations = await client.query(`
      select
        to_regclass('workflow.workflow_runs') is not null as workflow_runs_table,
        to_regclass('graphile_worker.jobs') is not null as jobs_view
    `);
    const workflowRunsTable = relations.rows[0]?.workflow_runs_table === true;
    const jobsView = relations.rows[0]?.jobs_view === true;
    const specVersions = workflowRunsTable
      ? (await client.query(`
          select coalesce(spec_version, '') as spec_version, count(*)::integer as count
          from workflow.workflow_runs
          group by spec_version
          order by spec_version
        `)).rows.map((row) => ({ count: row.count, specVersion: row.spec_version }))
      : [];
    const jobGroups = jobsView
      ? (await client.query(`
          select
            task_identifier,
            count(*)::integer as count,
            count(*) filter (where attempts >= max_attempts)::integer as exhausted
          from graphile_worker.jobs
          where task_identifier ~ '(_flows|_steps)$'
          group by task_identifier
          order by task_identifier
        `)).rows.map((row) => ({
          count: row.count,
          exhausted: row.exhausted,
          taskIdentifier: row.task_identifier,
        }))
      : [];
    await client.query("commit");

    return analyzeWorkflowWorldSnapshot({
      expectedJobPrefix: jobPrefix.trim(),
      jobGroups,
      jobsView,
      specVersions,
      workflowRunsTable,
    });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
