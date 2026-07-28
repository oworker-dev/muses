create table if not exists muses_project (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  name text not null,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists muses_project_workspace_name_idx
  on muses_project (workspace_id, name);

create table if not exists muses_creative_canvas (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  project_id text not null references muses_project (id) on delete cascade,
  schema_version text not null,
  revision integer not null default 0,
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revision >= 0)
);

create unique index if not exists muses_creative_canvas_project_idx
  on muses_creative_canvas (workspace_id, project_id);

create table if not exists muses_professional_workspace (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  project_id text not null references muses_project (id) on delete cascade,
  schema_version text not null,
  revision integer not null default 0,
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revision >= 0)
);

create unique index if not exists muses_professional_workspace_project_idx
  on muses_professional_workspace (workspace_id, project_id);

create table if not exists muses_workflow_definition_draft (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  project_id text not null references muses_project (id) on delete cascade,
  professional_workspace_id text not null references muses_professional_workspace (id) on delete cascade,
  name text not null,
  description text not null default '',
  schema_version text not null,
  revision integer not null default 0,
  lifecycle_status text not null default 'draft',
  document jsonb not null,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revision >= 0),
  check (lifecycle_status in ('draft', 'published', 'archived'))
);

create index if not exists muses_workflow_definition_draft_project_idx
  on muses_workflow_definition_draft (workspace_id, project_id);

create table if not exists muses_workflow_definition_version (
  definition_id text not null,
  version integer not null,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  schema_version text not null,
  definition jsonb not null,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  published_by_user_id text not null,
  published_at timestamptz not null default now(),
  primary key (definition_id, version),
  check (version >= 1)
);

create table if not exists muses_workflow_deployment (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  definition_id text not null,
  alias text not null,
  version integer not null,
  status text not null default 'active',
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (definition_id, version)
    references muses_workflow_definition_version (definition_id, version)
    on delete restrict,
  check (version >= 1),
  check (status in ('active', 'disabled'))
);

create unique index if not exists muses_workflow_deployment_alias_idx
  on muses_workflow_deployment (workspace_id, definition_id, alias);

create table if not exists muses_operation_command_receipt (
  workspace_id text not null references muses_workspace (id) on delete cascade,
  target_type text not null,
  target_id text not null,
  idempotency_key text not null,
  command_id text not null,
  actor_kind text not null,
  actor_id text not null,
  expected_revision integer not null,
  resulting_revision integer,
  status text not null default 'processing',
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, target_type, target_id, idempotency_key),
  check (expected_revision >= 0),
  check (resulting_revision is null or resulting_revision >= 0),
  check (actor_kind in ('user', 'agent', 'api')),
  check (status in ('processing', 'accepted', 'rejected'))
);

create unique index if not exists muses_operation_command_receipt_command_idx
  on muses_operation_command_receipt (workspace_id, command_id);
