create table if not exists muses_generated_asset (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  workflow_run_id text not null,
  node_id text not null,
  step_id text not null,
  asset_index integer not null,
  object_key text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer not null,
  height integer not null,
  prompt text not null,
  provider text not null,
  model_ref text not null,
  created_at timestamptz not null,
  check (asset_index >= 0),
  check (byte_size > 0),
  check (width > 0),
  check (height > 0),
  check (mime_type in ('image/png', 'image/jpeg', 'image/webp'))
);

create unique index if not exists muses_generated_asset_object_key_idx
  on muses_generated_asset (object_key);

create index if not exists muses_generated_asset_run_idx
  on muses_generated_asset (workspace_id, workflow_run_id, created_at);
