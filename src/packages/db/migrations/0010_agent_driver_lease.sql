alter table muses_agent_run
  add column if not exists driver_attempt_id text,
  add column if not exists driver_lease_expires_at timestamptz,
  add column if not exists driver_last_heartbeat_at timestamptz;

update muses_agent_run
set driver_attempt_id = coalesce(
      driver_attempt_id,
      'adriver_legacy_' || md5(id || ':' || coalesce(driver_run_id, ''))
    ),
    driver_lease_expires_at = coalesce(driver_lease_expires_at, now()),
    driver_last_heartbeat_at = coalesce(driver_last_heartbeat_at, updated_at)
where driver_status in ('starting', 'running');

alter table muses_agent_run
  drop constraint if exists muses_agent_run_driver_lease_check;

alter table muses_agent_run
  add constraint muses_agent_run_driver_lease_check check (
    driver_status not in ('starting', 'running')
    or (
      driver_attempt_id is not null
      and driver_lease_expires_at is not null
      and driver_last_heartbeat_at is not null
      and (driver_status <> 'starting' or driver_run_id is null)
      and (driver_status <> 'running' or driver_run_id is not null)
    )
  );

create index if not exists muses_agent_run_driver_lease_idx
  on muses_agent_run (driver_status, driver_lease_expires_at)
  where driver_status in ('starting', 'running');
