create table if not exists muses_workspace (
  id text primary key,
  kind text not null default 'personal',
  name text not null,
  personal_owner_user_id text,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind in ('personal', 'team')),
  check (
    (kind = 'personal' and personal_owner_user_id is not null)
    or kind = 'team'
  )
);

create unique index if not exists muses_workspace_personal_owner_idx
  on muses_workspace (personal_owner_user_id)
  where personal_owner_user_id is not null;

create table if not exists muses_workspace_member (
  workspace_id text not null references muses_workspace (id) on delete cascade,
  user_id text not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  check (role in ('owner', 'admin', 'member', 'viewer')),
  check (status in ('active', 'suspended'))
);

create index if not exists muses_workspace_member_user_idx
  on muses_workspace_member (user_id, status, workspace_id);

create table if not exists credit_account (
  id text primary key,
  workspace_id text not null unique references muses_workspace (id) on delete restrict,
  currency text not null default 'MUSES_CREDIT',
  posted_balance_micros bigint not null default 0,
  reserved_balance_micros bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (posted_balance_micros >= 0),
  check (reserved_balance_micros >= 0),
  check (reserved_balance_micros <= posted_balance_micros)
);

create table if not exists muses_workflow_run (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete restrict,
  sdk_run_id text,
  submitted_by_user_id text not null,
  workflow_document_id text not null,
  workflow_document_revision integer not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  reservation_id text,
  status text not null default 'starting',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (workspace_id, idempotency_key),
  unique (sdk_run_id),
  check (status in ('starting', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'start_unknown')),
  check (workflow_document_revision >= 0)
);

create index if not exists muses_workflow_run_workspace_created_idx
  on muses_workflow_run (workspace_id, created_at desc);

create table if not exists credit_reservation (
  id text primary key,
  account_id text not null references credit_account (id) on delete restrict,
  workspace_id text not null references muses_workspace (id) on delete restrict,
  submission_id text not null references muses_workflow_run (id) on delete restrict,
  workflow_run_id text,
  idempotency_key text not null,
  status text not null default 'active',
  estimated_micros bigint not null,
  settled_micros bigint not null default 0,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (workspace_id, idempotency_key),
  unique (workflow_run_id),
  check (status in ('active', 'settled', 'released', 'review_required')),
  check (estimated_micros > 0),
  check (settled_micros >= 0),
  check (settled_micros <= estimated_micros)
);

create table if not exists credit_ledger_entry (
  id text primary key,
  account_id text not null references credit_account (id) on delete restrict,
  workspace_id text not null references muses_workspace (id) on delete restrict,
  kind text not null,
  balance_delta_micros bigint not null default 0,
  reserved_delta_micros bigint not null default 0,
  balance_after_micros bigint not null,
  reserved_after_micros bigint not null,
  reservation_id text references credit_reservation (id) on delete restrict,
  workflow_run_id text,
  idempotency_key text not null,
  actor_user_id text,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (account_id, idempotency_key),
  check (kind in ('grant', 'reserve', 'settle', 'release', 'refund', 'adjustment')),
  check (balance_after_micros >= 0),
  check (reserved_after_micros >= 0),
  check (reserved_after_micros <= balance_after_micros)
);

create index if not exists credit_ledger_workspace_created_idx
  on credit_ledger_entry (workspace_id, created_at desc);

create or replace function prevent_credit_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_ledger_entry is append-only';
end;
$$;

drop trigger if exists credit_ledger_entry_no_update on credit_ledger_entry;
create trigger credit_ledger_entry_no_update
before update on credit_ledger_entry
for each row execute function prevent_credit_ledger_mutation();

drop trigger if exists credit_ledger_entry_no_delete on credit_ledger_entry;
create trigger credit_ledger_entry_no_delete
before delete on credit_ledger_entry
for each row execute function prevent_credit_ledger_mutation();
