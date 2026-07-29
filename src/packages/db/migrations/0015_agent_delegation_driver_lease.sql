alter table muses_agent_delegation_run
  add column if not exists driver_status text not null default 'unclaimed',
  add column if not exists driver_run_id text,
  add column if not exists driver_attempt_id text,
  add column if not exists driver_lease_expires_at timestamptz,
  add column if not exists driver_last_heartbeat_at timestamptz;

alter table muses_agent_delegation_run
  drop constraint if exists muses_agent_delegation_driver_lease_check;

alter table muses_agent_delegation_run
  add constraint muses_agent_delegation_driver_lease_check check (
    driver_status in ('unclaimed', 'starting', 'running', 'completed', 'failed')
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
      (driver_status in ('completed', 'failed')
        and driver_run_id is not null
        and driver_attempt_id is not null
        and driver_lease_expires_at is null)
    )
  );

create unique index if not exists muses_agent_delegation_driver_run_idx
  on muses_agent_delegation_run (driver_run_id)
  where driver_run_id is not null;

create index if not exists muses_agent_delegation_driver_lease_idx
  on muses_agent_delegation_run (driver_status, driver_lease_expires_at)
  where driver_status in ('starting', 'running');
