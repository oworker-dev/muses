# Workflow World Isolation And Recovery

Muses Workflow SDK 4.x currently persists spec `3`. Eve 0.27.8 uses a different
Workflow runtime generation and spec `5`. The two runtimes must use physically
separate PostgreSQL databases. Separate schemas or Graphile task prefixes do not
isolate the shared `workflow` schema and its persisted execution protocol.

## Read-only diagnosis

Run the production doctor against the same database and queue prefix that the
Muses Web worker will use:

```bash
pnpm run doctor:workflow-world
```

For deployment gating, load the full production environment and use:

```bash
pnpm run doctor:workflow-world:strict
```

The inspection opens a read-only transaction with five-second connection and
statement timeouts. It reports only aggregate spec/task counts. It never reads
job payloads, errors, prompts, outputs, or credentials and never mutates a Run
or queue item.

The equivalent evidence queries are:

```sql
select spec_version, count(*)
from workflow.workflow_runs
group by spec_version
order by spec_version;

select task_identifier,
       count(*) as jobs,
       count(*) filter (where attempts >= max_attempts) as exhausted
from graphile_worker.jobs
where task_identifier ~ '(_flows|_steps)$'
group by task_identifier
order by task_identifier;
```

Healthy Muses state contains only spec `3` and the configured
`<WORKFLOW_POSTGRES_JOB_PREFIX>flows` and
`<WORKFLOW_POSTGRES_JOB_PREFIX>steps` task identifiers.

## Recovery

Do not delete rows from `workflow.*` or Graphile Worker's private tables in
place. Queue rows and Workflow records are linked by internal payloads and event
history; deleting one side can strand the other or erase audit evidence.

Use this reviewed, recoverable procedure:

1. Stop every worker that can consume the affected database and record its
   application revision, Workflow SDK version, expected spec, and job prefix.
2. Take a database snapshot and verify that it can be restored into an isolated
   environment without starting a worker.
3. Record aggregate spec counts, task counts, affected Muses Run ids, and active
   product references. Do not export private inputs or outputs into the ticket.
4. Provision a new dedicated PostgreSQL database for the Muses World and run the
   installed `@workflow/world-postgres` bootstrap against it.
5. Point only the Muses worker at the new database with the `muses_` prefix. Keep
   the Eve World on its own database and `muses_agent_` prefix.
6. Run the strict World doctor. Start one canary worker and execute a new
   Start-to-End run, cancellation, and Agent-node bridge check.
7. Keep the contaminated database read-only for the approved audit/retention
   period. Resolve or export product-level Run references before retirement.
8. Delete the old database only through the infrastructure retention process
   after product-owner and operations approval. Record snapshot expiry and
   deletion evidence.

For a production World with valuable active runs, drain compatible runs with
the exact runtime generation that created them or escalate to Workflow SDK
maintainers. Do not attach a newer runtime merely to consume old jobs. Manual
Graphile private-table deletion is intentionally not an accepted recovery path.
