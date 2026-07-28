create table if not exists model_provider (
  id text primary key,
  slug text not null unique,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('active', 'disabled'))
);

create table if not exists model_offering (
  id text primary key,
  provider_id text not null references model_provider (id) on delete restrict,
  model_ref text not null unique,
  provider_model_id text not null,
  display_name text not null,
  capability_family text not null,
  specification_version text not null,
  lifecycle_status text not null default 'draft',
  enabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, provider_model_id, specification_version),
  check (capability_family in ('llm', 'image', 'video', 'audio', 'music')),
  check (lifecycle_status in ('draft', 'published', 'deprecated', 'retired')),
  check (model_ref ~ '^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$')
);

create index if not exists model_offering_catalog_idx
  on model_offering (capability_family, lifecycle_status, enabled, sort_order);

create table if not exists capability_profile (
  id text primary key,
  model_offering_id text not null references model_offering (id) on delete restrict,
  capability_id text not null,
  profile_version text not null,
  lifecycle_status text not null default 'draft',
  specification jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_offering_id, capability_id, profile_version),
  check (lifecycle_status in ('draft', 'published', 'deprecated', 'retired')),
  check (jsonb_typeof(specification) = 'object')
);

create index if not exists capability_profile_catalog_idx
  on capability_profile (model_offering_id, capability_id, lifecycle_status);

create table if not exists price_book_entry (
  id text primary key,
  model_offering_id text not null references model_offering (id) on delete restrict,
  price_book_version text not null,
  lifecycle_status text not null default 'draft',
  billing_unit text not null,
  unit_credit_micros bigint not null,
  currency_reference text,
  estimation_rule jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_offering_id, price_book_version, billing_unit),
  check (lifecycle_status in ('draft', 'published', 'deprecated', 'retired')),
  check (billing_unit in ('input-token', 'output-token', 'image-output', 'video-second', 'audio-second', 'music-second')),
  check (unit_credit_micros > 0),
  check (effective_to is null or effective_to > effective_from),
  check (jsonb_typeof(estimation_rule) = 'object')
);

create index if not exists price_book_entry_active_idx
  on price_book_entry (model_offering_id, lifecycle_status, effective_from, effective_to);

create or replace function prevent_published_catalog_spec_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'model_offering' then
    if old.lifecycle_status <> 'draft' and (
      new.provider_id is distinct from old.provider_id
      or new.model_ref is distinct from old.model_ref
      or new.provider_model_id is distinct from old.provider_model_id
      or new.capability_family is distinct from old.capability_family
      or new.specification_version is distinct from old.specification_version
    ) then
      raise exception 'published model offering identity is immutable';
    end if;
  elsif tg_table_name = 'capability_profile' then
    if old.lifecycle_status <> 'draft' and (
      new.model_offering_id is distinct from old.model_offering_id
      or new.capability_id is distinct from old.capability_id
      or new.profile_version is distinct from old.profile_version
      or new.specification is distinct from old.specification
    ) then
      raise exception 'published capability profile is immutable';
    end if;
  elsif tg_table_name = 'price_book_entry' then
    if old.lifecycle_status <> 'draft' and (
      new.model_offering_id is distinct from old.model_offering_id
      or new.price_book_version is distinct from old.price_book_version
      or new.billing_unit is distinct from old.billing_unit
      or new.unit_credit_micros is distinct from old.unit_credit_micros
      or new.currency_reference is distinct from old.currency_reference
      or new.estimation_rule is distinct from old.estimation_rule
      or new.effective_from is distinct from old.effective_from
    ) then
      raise exception 'published price book entry is immutable';
    end if;
  end if;
  return new;
end;
$$;

create or replace function prevent_published_catalog_version_delete()
returns trigger
language plpgsql
as $$
begin
  if old.lifecycle_status <> 'draft' then
    raise exception 'published catalog versions cannot be deleted';
  end if;
  return old;
end;
$$;

drop trigger if exists model_offering_published_spec_immutable on model_offering;
create trigger model_offering_published_spec_immutable
before update on model_offering
for each row execute function prevent_published_catalog_spec_mutation();

drop trigger if exists capability_profile_published_spec_immutable on capability_profile;
create trigger capability_profile_published_spec_immutable
before update on capability_profile
for each row execute function prevent_published_catalog_spec_mutation();

drop trigger if exists price_book_entry_published_spec_immutable on price_book_entry;
create trigger price_book_entry_published_spec_immutable
before update on price_book_entry
for each row execute function prevent_published_catalog_spec_mutation();

drop trigger if exists model_offering_published_no_delete on model_offering;
create trigger model_offering_published_no_delete
before delete on model_offering
for each row execute function prevent_published_catalog_version_delete();

drop trigger if exists capability_profile_published_no_delete on capability_profile;
create trigger capability_profile_published_no_delete
before delete on capability_profile
for each row execute function prevent_published_catalog_version_delete();

drop trigger if exists price_book_entry_published_no_delete on price_book_entry;
create trigger price_book_entry_published_no_delete
before delete on price_book_entry
for each row execute function prevent_published_catalog_version_delete();

insert into model_provider (id, slug, display_name, status)
values ('provider_openai', 'openai', 'OpenAI', 'active')
on conflict (id) do nothing;

insert into model_offering (
  id,
  provider_id,
  model_ref,
  provider_model_id,
  display_name,
  capability_family,
  specification_version,
  lifecycle_status,
  enabled,
  sort_order
)
values
  (
    'offering_openai_gpt_image_2_20260728',
    'provider_openai',
    'openai/gpt-image-2@2026-07-28',
    'gpt-image-2',
    'GPT Image 2',
    'image',
    '2026-07-28',
    'published',
    true,
    10
  ),
  (
    'offering_openai_gpt_image_15_20260728',
    'provider_openai',
    'openai/gpt-image-1.5@2026-07-28',
    'gpt-image-1.5',
    'GPT Image 1.5',
    'image',
    '2026-07-28',
    'published',
    true,
    20
  )
on conflict (id) do nothing;

insert into capability_profile (
  id,
  model_offering_id,
  capability_id,
  profile_version,
  lifecycle_status,
  specification,
  published_at
)
values
  (
    'profile_openai_gpt_image_2_20260728',
    'offering_openai_gpt_image_2_20260728',
    'image.generate.v1',
    '2026-07-28',
    'published',
    '{"kind":"image-generation","inputModes":["text-to-image"],"aspectRatios":["1:1","3:2","2:3"],"outputCounts":[1,2,3,4],"parameters":{"quality":{"type":"enum","values":["low","medium","high"],"default":"medium"}}}'::jsonb,
    '2026-07-28T00:00:00Z'
  ),
  (
    'profile_openai_gpt_image_15_20260728',
    'offering_openai_gpt_image_15_20260728',
    'image.generate.v1',
    '2026-07-28',
    'published',
    '{"kind":"image-generation","inputModes":["text-to-image"],"aspectRatios":["1:1","3:2","2:3"],"outputCounts":[1,2,3,4],"parameters":{"quality":{"type":"enum","values":["low","medium","high"],"default":"medium"}}}'::jsonb,
    '2026-07-28T00:00:00Z'
  )
on conflict (id) do nothing;

insert into price_book_entry (
  id,
  model_offering_id,
  price_book_version,
  lifecycle_status,
  billing_unit,
  unit_credit_micros,
  currency_reference,
  estimation_rule,
  effective_from
)
values
  (
    'price_openai_gpt_image_2_alpha_20260728',
    'offering_openai_gpt_image_2_20260728',
    'alpha-2026-07-28',
    'published',
    'image-output',
    1000000,
    'USD',
    '{"kind":"output-count","pricingBasis":"alpha-flat-image-output"}'::jsonb,
    '2026-07-28T00:00:00Z'
  ),
  (
    'price_openai_gpt_image_15_alpha_20260728',
    'offering_openai_gpt_image_15_20260728',
    'alpha-2026-07-28',
    'published',
    'image-output',
    1000000,
    'USD',
    '{"kind":"output-count","pricingBasis":"alpha-flat-image-output"}'::jsonb,
    '2026-07-28T00:00:00Z'
  )
on conflict (id) do nothing;
