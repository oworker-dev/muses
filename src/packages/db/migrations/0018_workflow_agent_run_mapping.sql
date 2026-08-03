create table if not exists muses_workflow_agent_run (
  workspace_id text not null references muses_workspace (id) on delete cascade,
  workflow_run_id text not null,
  workflow_node_id text not null,
  agent_run_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, workflow_run_id, workflow_node_id),
  check (length(trim(workflow_run_id)) > 0),
  check (length(trim(workflow_node_id)) > 0),
  check (length(trim(agent_run_id)) > 0)
);

create unique index if not exists muses_workflow_agent_run_agent_idx
  on muses_workflow_agent_run (workspace_id, agent_run_id);

create index if not exists muses_workflow_agent_run_workflow_idx
  on muses_workflow_agent_run (workspace_id, workflow_run_id, created_at);
