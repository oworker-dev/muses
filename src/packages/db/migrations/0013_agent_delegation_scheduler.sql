create unique index if not exists muses_agent_run_delegation_scope_idx
  on muses_agent_run (id, workspace_id, project_id, session_id);

create table if not exists muses_agent_delegation_run (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  project_id text not null references muses_project (id) on delete cascade,
  session_id text not null,
  root_run_id text not null,
  parent_run_id text not null,
  plan_id text not null,
  plan_revision integer not null,
  idempotency_key text not null,
  plan_fingerprint text not null,
  authority_fingerprint text not null,
  status text not null,
  revision integer not null default 0,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  unique (workspace_id, idempotency_key),
  unique (id, workspace_id, parent_run_id),
  foreign key (root_run_id, workspace_id, project_id, session_id)
    references muses_agent_run (id, workspace_id, project_id, session_id)
    on delete cascade,
  foreign key (parent_run_id, workspace_id, project_id, session_id)
    references muses_agent_run (id, workspace_id, project_id, session_id)
    on delete cascade,
  check (plan_revision >= 0),
  check (revision >= 0),
  check (length(btrim(idempotency_key)) > 0),
  check (length(btrim(plan_fingerprint)) > 0),
  check (length(btrim(authority_fingerprint)) > 0),
  check (
    status in (
      'queued',
      'running',
      'cancelling',
      'completed',
      'completed-with-failures',
      'failed',
      'cancelled'
    )
  )
);

create index if not exists muses_agent_delegation_parent_created_idx
  on muses_agent_delegation_run (workspace_id, parent_run_id, created_at desc);

create index if not exists muses_agent_delegation_root_created_idx
  on muses_agent_delegation_run (workspace_id, root_run_id, created_at desc);

create table if not exists muses_agent_delegation_event (
  delegation_run_id text not null
    references muses_agent_delegation_run (id) on delete cascade,
  sequence integer not null,
  event_id text not null unique,
  schema_version text not null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  primary key (delegation_run_id, sequence),
  check (sequence >= 1)
);

create index if not exists muses_agent_delegation_event_type_idx
  on muses_agent_delegation_event (delegation_run_id, type, sequence);

create table if not exists muses_agent_delegation_budget_reservation (
  id text primary key,
  delegation_run_id text not null,
  workspace_id text not null,
  parent_run_id text not null,
  parent_reservation_id text,
  task_id text,
  scope text not null,
  status text not null default 'active',
  reservation_idempotency_key text not null,
  finalization_idempotency_key text,
  limit_snapshot jsonb not null,
  usage_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (id, delegation_run_id, workspace_id, parent_run_id),
  foreign key (delegation_run_id, workspace_id, parent_run_id)
    references muses_agent_delegation_run (id, workspace_id, parent_run_id)
    on delete cascade,
  foreign key (
    parent_reservation_id,
    delegation_run_id,
    workspace_id,
    parent_run_id
  ) references muses_agent_delegation_budget_reservation (
    id,
    delegation_run_id,
    workspace_id,
    parent_run_id
  ) on delete cascade,
  check (scope in ('envelope', 'task')),
  check (status in ('active', 'settled', 'released', 'review_required')),
  check (length(btrim(reservation_idempotency_key)) > 0),
  check (
    (status = 'active' and finalization_idempotency_key is null and finalized_at is null)
    or
    (status <> 'active' and finalization_idempotency_key is not null and finalized_at is not null)
  ),
  check (
    (scope = 'envelope' and task_id is null and parent_reservation_id is null)
    or
    (scope = 'task' and task_id is not null and parent_reservation_id is not null)
  ),
  check (scope = 'task' or usage_snapshot is null)
);

create unique index if not exists muses_agent_delegation_budget_envelope_idx
  on muses_agent_delegation_budget_reservation (delegation_run_id)
  where scope = 'envelope';

create unique index if not exists muses_agent_delegation_budget_task_idx
  on muses_agent_delegation_budget_reservation (delegation_run_id, task_id)
  where scope = 'task';

create index if not exists muses_agent_delegation_budget_parent_active_idx
  on muses_agent_delegation_budget_reservation (
    workspace_id,
    parent_run_id,
    status
  )
  where scope = 'envelope' and status = 'active';
