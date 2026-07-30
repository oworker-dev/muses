create unique index if not exists muses_agent_delegation_exact_scope_idx
  on muses_agent_delegation_run (
    id,
    workspace_id,
    project_id,
    session_id,
    root_run_id,
    parent_run_id
  );

create table if not exists muses_agent_delegation_continuation (
  delegation_run_id text primary key,
  workspace_id text not null,
  project_id text not null,
  session_id text not null,
  root_run_id text not null,
  parent_run_id text not null,
  terminal_status text not null,
  projection_fingerprint text not null,
  projection jsonb not null,
  message_id text not null unique,
  message_created_at timestamptz not null,
  status text not null default 'pending',
  attempt_id text,
  lease_expires_at timestamptz,
  message_committed_at timestamptz,
  parent_driver jsonb,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (
    delegation_run_id,
    workspace_id,
    project_id,
    session_id,
    root_run_id,
    parent_run_id
  ) references muses_agent_delegation_run (
    id,
    workspace_id,
    project_id,
    session_id,
    root_run_id,
    parent_run_id
  ) on delete cascade,
  foreign key (parent_run_id, workspace_id, project_id, session_id)
    references muses_agent_run (id, workspace_id, project_id, session_id)
    on delete cascade,
  foreign key (root_run_id, workspace_id, project_id, session_id)
    references muses_agent_run (id, workspace_id, project_id, session_id)
    on delete cascade,
  check (
    terminal_status in (
      'completed',
      'completed-with-failures',
      'failed',
      'cancelled'
    )
  ),
  check (status in ('pending', 'processing', 'completed', 'skipped', 'failed')),
  check (length(btrim(projection_fingerprint)) > 0),
  check (length(btrim(message_id)) > 0),
  check (
    (status = 'pending'
      and attempt_id is null
      and lease_expires_at is null
      and completed_at is null)
    or
    (status = 'processing'
      and attempt_id is not null
      and lease_expires_at is not null
      and completed_at is null)
    or
    (status in ('completed', 'skipped', 'failed')
      and attempt_id is null
      and lease_expires_at is null
      and completed_at is not null)
  ),
  check (status <> 'completed' or message_committed_at is not null)
);

create index if not exists muses_agent_delegation_continuation_lease_idx
  on muses_agent_delegation_continuation (status, lease_expires_at)
  where status = 'processing';

create index if not exists muses_agent_delegation_continuation_parent_idx
  on muses_agent_delegation_continuation (
    workspace_id,
    parent_run_id,
    created_at desc
  );

alter table muses_agent_delegation_run
  drop constraint if exists muses_agent_delegation_driver_lease_check;

alter table muses_agent_delegation_run
  add constraint muses_agent_delegation_driver_lease_check check (
    driver_status in (
      'unclaimed',
      'starting',
      'running',
      'completed',
      'failed',
      'cancelled'
    )
    and (
      (driver_status = 'unclaimed'
        and driver_run_id is null
        and driver_attempt_id is null
        and driver_lease_expires_at is null)
      or
      (driver_status = 'starting'
        and driver_run_id is null
        and driver_attempt_id is not null
        and driver_lease_expires_at is not null)
      or
      (driver_status = 'running'
        and driver_run_id is not null
        and driver_attempt_id is not null
        and driver_lease_expires_at is not null)
      or
      (driver_status in ('completed', 'failed', 'cancelled')
        and driver_run_id is not null
        and driver_attempt_id is not null
        and driver_lease_expires_at is null)
    )
  );
