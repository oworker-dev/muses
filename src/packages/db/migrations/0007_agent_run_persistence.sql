create table if not exists muses_agent_run (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  project_id text not null references muses_project (id) on delete cascade,
  canvas_id text,
  session_id text not null,
  profile_id text not null,
  profile_version text not null,
  model_ref text not null,
  status text not null,
  revision integer not null default 0,
  snapshot jsonb not null,
  driver_status text not null default 'unclaimed',
  driver_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (revision >= 0),
  check (
    status in (
      'queued',
      'running',
      'waiting-approval',
      'waiting-input',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  check (
    driver_status in (
      'unclaimed',
      'starting',
      'running',
      'completed',
      'failed'
    )
  )
);

create index if not exists muses_agent_run_workspace_updated_idx
  on muses_agent_run (workspace_id, updated_at desc);

create index if not exists muses_agent_run_session_idx
  on muses_agent_run (workspace_id, session_id, created_at desc);

create unique index if not exists muses_agent_run_driver_idx
  on muses_agent_run (driver_run_id)
  where driver_run_id is not null;

create table if not exists muses_agent_event (
  run_id text not null references muses_agent_run (id) on delete cascade,
  sequence integer not null,
  event_id text not null,
  schema_version text not null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  primary key (run_id, sequence),
  unique (event_id),
  check (sequence >= 1)
);

create index if not exists muses_agent_event_type_idx
  on muses_agent_event (run_id, type, sequence);
