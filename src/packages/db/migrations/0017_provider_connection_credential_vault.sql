create table if not exists provider_connection (
  id text primary key,
  provider_id text not null references model_provider (id) on delete restrict,
  name text not null,
  base_url text,
  status text not null default 'active',
  capabilities jsonb not null,
  model_allowlist jsonb not null default '[]'::jsonb,
  priority integer not null default 100,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, name),
  check (status in ('active', 'disabled')),
  check (jsonb_typeof(capabilities) = 'array' and jsonb_array_length(capabilities) > 0),
  check (jsonb_typeof(model_allowlist) = 'array'),
  check (priority >= 0)
);

create index if not exists provider_connection_route_idx
  on provider_connection (provider_id, status, priority, created_at);

create table if not exists provider_credential_version (
  id text primary key,
  connection_id text not null references provider_connection (id) on delete restrict,
  encrypted_secret text not null,
  nonce text not null,
  auth_tag text not null,
  algorithm text not null default 'aes-256-gcm',
  key_id text not null,
  secret_hint text not null,
  status text not null default 'active',
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (algorithm = 'aes-256-gcm'),
  check (status in ('active', 'revoked')),
  check (secret_hint ~ '^.{0,4}$'),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create unique index if not exists provider_credential_one_active_idx
  on provider_credential_version (connection_id)
  where status = 'active';

create index if not exists provider_credential_connection_created_idx
  on provider_credential_version (connection_id, created_at desc);

create table if not exists provider_connection_offering (
  connection_id text not null references provider_connection (id) on delete cascade,
  model_offering_id text not null references model_offering (id) on delete restrict,
  enabled boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (connection_id, model_offering_id),
  check (priority >= 0)
);

create index if not exists provider_connection_offering_route_idx
  on provider_connection_offering (model_offering_id, enabled, priority);

create table if not exists provider_connection_health (
  connection_id text not null references provider_connection (id) on delete cascade,
  capability_family text not null,
  status text not null default 'unknown',
  http_status integer,
  latency_ms integer,
  result_code text,
  checked_at timestamptz,
  last_success_at timestamptz,
  primary key (connection_id, capability_family),
  check (capability_family in ('llm', 'image', 'video', 'audio', 'music')),
  check (status in ('unknown', 'healthy', 'degraded', 'unavailable')),
  check (http_status is null or (http_status >= 100 and http_status <= 599)),
  check (latency_ms is null or latency_ms >= 0),
  check (result_code is null or result_code ~ '^[a-z0-9_-]{1,80}$')
);

create index if not exists provider_connection_health_status_idx
  on provider_connection_health (capability_family, status, checked_at desc);

create or replace function validate_provider_connection_capabilities()
returns trigger
language plpgsql
as $$
declare
  capability text;
begin
  for capability in select jsonb_array_elements_text(new.capabilities)
  loop
    if capability not in ('llm', 'image', 'video', 'audio', 'music') then
      raise exception 'unsupported provider capability family: %', capability;
    end if;
  end loop;
  if jsonb_array_length(new.capabilities) <> (
    select count(distinct value) from jsonb_array_elements_text(new.capabilities)
  ) then
    raise exception 'provider connection capabilities must be unique';
  end if;
  return new;
end;
$$;

drop trigger if exists provider_connection_capabilities_valid on provider_connection;
create trigger provider_connection_capabilities_valid
before insert or update of capabilities on provider_connection
for each row execute function validate_provider_connection_capabilities();

create or replace function validate_provider_connection_offering()
returns trigger
language plpgsql
as $$
declare
  connection_provider_id text;
  connection_capabilities jsonb;
  offering_provider_id text;
  offering_capability text;
begin
  select provider_id, capabilities
  into connection_provider_id, connection_capabilities
  from provider_connection
  where id = new.connection_id;

  select provider_id, capability_family
  into offering_provider_id, offering_capability
  from model_offering
  where id = new.model_offering_id;

  if connection_provider_id is distinct from offering_provider_id then
    raise exception 'provider connection and offering must use the same provider';
  end if;
  if not connection_capabilities ? offering_capability then
    raise exception 'provider connection does not declare the offering capability';
  end if;
  return new;
end;
$$;

drop trigger if exists provider_connection_offering_valid on provider_connection_offering;
create trigger provider_connection_offering_valid
before insert or update of connection_id, model_offering_id on provider_connection_offering
for each row execute function validate_provider_connection_offering();
