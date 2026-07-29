create table if not exists muses_agent_model_call (
  id text primary key,
  run_id text not null references muses_agent_run (id) on delete cascade,
  workspace_id text not null references muses_workspace (id) on delete restrict,
  turn integer not null,
  context_version integer not null,
  model_ref text not null,
  request_fingerprint text not null,
  status text not null default 'claimed',
  attempt_id text not null,
  lease_expires_at timestamptz not null,
  estimated_input_tokens integer not null,
  estimated_output_tokens integer not null,
  estimated_credit_micros bigint not null,
  actual_input_tokens integer,
  actual_output_tokens integer,
  actual_credit_micros bigint,
  result jsonb,
  provider_request_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (run_id, turn, context_version),
  check (status in ('claimed', 'calling', 'completed', 'failed', 'ambiguous')),
  check (turn >= 1),
  check (context_version >= 1),
  check (estimated_input_tokens >= 0),
  check (estimated_output_tokens >= 0),
  check (estimated_credit_micros >= 0),
  check (actual_input_tokens is null or actual_input_tokens >= 0),
  check (actual_output_tokens is null or actual_output_tokens >= 0),
  check (actual_credit_micros is null or actual_credit_micros >= 0),
  check ((status = 'completed' and result is not null) or status <> 'completed')
);

create index if not exists muses_agent_model_call_run_created_idx
  on muses_agent_model_call (run_id, created_at);

create index if not exists muses_agent_model_call_status_lease_idx
  on muses_agent_model_call (status, lease_expires_at);

alter table credit_reservation
  alter column submission_id drop not null,
  add column if not exists agent_model_call_id text
    references muses_agent_model_call (id) on delete restrict;

alter table credit_reservation
  drop constraint if exists credit_reservation_owner_check;

alter table credit_reservation
  add constraint credit_reservation_owner_check check (
    num_nonnulls(submission_id, agent_model_call_id) = 1
  );

create unique index if not exists credit_reservation_agent_model_call_idx
  on credit_reservation (agent_model_call_id)
  where agent_model_call_id is not null;

alter table credit_ledger_entry
  add column if not exists agent_run_id text
    references muses_agent_run (id) on delete restrict,
  add column if not exists agent_model_call_id text
    references muses_agent_model_call (id) on delete restrict;

create index if not exists credit_ledger_agent_run_created_idx
  on credit_ledger_entry (agent_run_id, created_at desc)
  where agent_run_id is not null;
