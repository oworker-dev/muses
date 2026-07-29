create or replace function prevent_muses_workflow_definition_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'muses_workflow_definition_version is immutable';
end;
$$;

drop trigger if exists muses_workflow_definition_version_no_update
  on muses_workflow_definition_version;
create trigger muses_workflow_definition_version_no_update
before update on muses_workflow_definition_version
for each row execute function prevent_muses_workflow_definition_version_mutation();

drop trigger if exists muses_workflow_definition_version_no_delete
  on muses_workflow_definition_version;
create trigger muses_workflow_definition_version_no_delete
before delete on muses_workflow_definition_version
for each row execute function prevent_muses_workflow_definition_version_mutation();

alter table muses_workflow_run
  add column if not exists workflow_definition_id text,
  add column if not exists workflow_definition_version integer,
  add column if not exists workflow_deployment_id text,
  add column if not exists caller_kind text,
  add column if not exists caller_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'muses_workflow_run_definition_version_check'
  ) then
    alter table muses_workflow_run
      add constraint muses_workflow_run_definition_version_check
      check (
        workflow_definition_version is null
        or workflow_definition_version >= 1
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'muses_workflow_run_caller_kind_check'
  ) then
    alter table muses_workflow_run
      add constraint muses_workflow_run_caller_kind_check
      check (
        caller_kind is null
        or caller_kind in ('user', 'agent', 'api', 'workflow')
      );
  end if;
end;
$$;

create index if not exists muses_workflow_run_definition_created_idx
  on muses_workflow_run (
    workspace_id,
    workflow_definition_id,
    workflow_definition_version,
    created_at desc
  );
