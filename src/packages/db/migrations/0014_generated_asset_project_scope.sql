create unique index if not exists muses_project_id_workspace_idx
  on muses_project (id, workspace_id);

alter table muses_generated_asset
  add column if not exists project_id text;

update muses_generated_asset asset
set project_id = draft.project_id
from muses_workflow_run run
join muses_workflow_definition_draft draft
  on draft.id = run.workflow_definition_id
 and draft.workspace_id = run.workspace_id
where asset.project_id is null
  and asset.workspace_id = run.workspace_id
  and asset.workflow_run_id = run.sdk_run_id;

update muses_generated_asset asset
set project_id = agent.project_id
from muses_workflow_run run
join muses_agent_run agent
  on run.caller_kind = 'agent'
 and run.caller_id = agent.id
 and run.workspace_id = agent.workspace_id
where asset.project_id is null
  and asset.workspace_id = run.workspace_id
  and asset.workflow_run_id = run.sdk_run_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'muses_generated_asset_project_scope_fk'
      and conrelid = 'muses_generated_asset'::regclass
  ) then
    alter table muses_generated_asset
      add constraint muses_generated_asset_project_scope_fk
      foreign key (project_id, workspace_id)
      references muses_project (id, workspace_id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists muses_generated_asset_project_idx
  on muses_generated_asset (workspace_id, project_id, id)
  where project_id is not null;
