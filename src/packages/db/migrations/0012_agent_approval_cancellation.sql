create table if not exists muses_agent_cancel_receipt (
  workspace_id text not null references muses_workspace (id) on delete cascade,
  agent_run_id text not null references muses_agent_run (id) on delete cascade,
  idempotency_key text not null,
  requested_by_user_id text not null,
  reason text,
  status text not null default 'processing',
  attempt_id text not null,
  lease_expires_at timestamptz not null,
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, agent_run_id, idempotency_key),
  unique (workspace_id, agent_run_id),
  check (status in ('processing', 'completed'))
);

create index if not exists muses_agent_cancel_receipt_updated_idx
  on muses_agent_cancel_receipt (status, lease_expires_at, updated_at desc);
