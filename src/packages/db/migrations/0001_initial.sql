create table if not exists billing_subscription (
  id text primary key,
  account_id text not null,
  plan text not null,
  status text not null,
  monthly_amount_cents integer not null default 0,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  stripe_checkout_session_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_subscription_stripe_subscription_id_idx
  on billing_subscription (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists billing_subscription_account_updated_idx
  on billing_subscription (account_id, updated_at desc);

create table if not exists billing_webhook_event (
  id text primary key,
  provider text not null,
  event_id text not null,
  event_type text not null,
  status text not null default 'processing',
  payload jsonb not null default '{}'::jsonb,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create table if not exists payment_record (
  id text primary key,
  account_id text not null,
  provider text not null,
  provider_payment_id text,
  provider_event_id text,
  customer_email text,
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  status text not null,
  description text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_record_provider_payment_idx
  on payment_record (provider, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists payment_record_provider_event_idx
  on payment_record (provider, provider_event_id)
  where provider_event_id is not null;

create index if not exists payment_record_account_paid_idx
  on payment_record (account_id, paid_at desc nulls last, created_at desc);

create table if not exists analytics_event (
  id text primary key,
  event_name text not null,
  path text not null,
  feature text,
  referrer text,
  device text,
  country text,
  user_id_hash text,
  session_id_hash text,
  created_at timestamptz not null default now()
);

create index if not exists analytics_event_created_idx
  on analytics_event (created_at desc);

create index if not exists analytics_event_name_path_idx
  on analytics_event (event_name, path);

create index if not exists analytics_event_user_created_idx
  on analytics_event (user_id_hash, created_at desc)
  where user_id_hash is not null;

create table if not exists analytics_daily_rollup (
  bucket_date date not null,
  event_name text not null,
  path text not null,
  feature text not null default 'none',
  device text not null default 'unknown',
  country text not null default 'unknown',
  authenticated boolean not null default false,
  event_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket_date, event_name, path, feature, device, country, authenticated)
);

create index if not exists analytics_daily_rollup_bucket_idx
  on analytics_daily_rollup (bucket_date desc);

create table if not exists analytics_hourly_rollup (
  bucket_start timestamptz not null,
  event_name text not null,
  path text not null,
  feature text not null default 'none',
  device text not null default 'unknown',
  country text not null default 'unknown',
  authenticated boolean not null default false,
  event_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket_start, event_name, path, feature, device, country, authenticated)
);

create index if not exists analytics_hourly_rollup_bucket_idx
  on analytics_hourly_rollup (bucket_start desc);

create table if not exists analytics_daily_visitor (
  bucket_date date not null,
  session_id_hash text not null,
  user_id_hash text,
  authenticated boolean not null default false,
  country text not null default 'unknown',
  device text not null default 'unknown',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (bucket_date, session_id_hash)
);

create index if not exists analytics_daily_visitor_bucket_idx
  on analytics_daily_visitor (bucket_date desc);

create index if not exists analytics_daily_visitor_user_idx
  on analytics_daily_visitor (user_id_hash, bucket_date desc)
  where user_id_hash is not null;

create table if not exists analytics_visitor_activity (
  session_id_hash text primary key,
  user_id_hash text,
  authenticated boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_country text not null default 'unknown',
  last_device text not null default 'unknown',
  updated_at timestamptz not null default now()
);

create index if not exists analytics_visitor_activity_seen_idx
  on analytics_visitor_activity (last_seen_at desc);

create table if not exists account_activity_summary (
  user_id text primary key,
  user_id_hash text not null,
  last_seen_at timestamptz not null default now(),
  last_country text not null default 'unknown',
  last_device text not null default 'unknown',
  last_path text not null default '/',
  last_event_name text not null default 'page_view',
  updated_at timestamptz not null default now()
);

create index if not exists account_activity_summary_seen_idx
  on account_activity_summary (last_seen_at desc);

create table if not exists audit_log (
  id text primary key,
  actor_user_id text,
  actor_email text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx
  on audit_log (created_at desc);

create index if not exists audit_log_actor_idx
  on audit_log (actor_user_id, created_at desc);

create table if not exists workflow_run_resume_receipt (
  workspace_id text not null,
  run_id text not null,
  suspension_id text not null,
  idempotency_key text not null,
  selected_asset_id text not null,
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, run_id, idempotency_key),
  unique (workspace_id, run_id, suspension_id),
  check (status in ('processing', 'completed'))
);

create index if not exists workflow_run_resume_receipt_created_idx
  on workflow_run_resume_receipt (created_at desc);

create table if not exists workflow_run_cancel_receipt (
  workspace_id text not null,
  run_id text not null,
  idempotency_key text not null,
  reason text,
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, run_id, idempotency_key),
  unique (workspace_id, run_id),
  check (status in ('processing', 'completed'))
);

create index if not exists workflow_run_cancel_receipt_created_idx
  on workflow_run_cancel_receipt (created_at desc);

create table if not exists workflow_run_retry_receipt (
  workspace_id text not null,
  source_run_id text not null,
  idempotency_key text not null,
  target_run_id text,
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, source_run_id, idempotency_key),
  unique (target_run_id),
  check (status in ('processing', 'completed')),
  check (
    (status = 'processing' and target_run_id is null and completed_at is null)
    or
    (status = 'completed' and target_run_id is not null and completed_at is not null)
  )
);

create index if not exists workflow_run_retry_receipt_created_idx
  on workflow_run_retry_receipt (created_at desc);

insert into billing_subscription (
  id,
  account_id,
  plan,
  status,
  monthly_amount_cents,
  current_period_end
)
values (
  'demo-subscription',
  'demo-account',
  'pro',
  'active',
  2900,
  now() + interval '30 days'
)
on conflict (id) do update
set account_id = excluded.account_id,
    plan = excluded.plan,
    status = excluded.status,
    monthly_amount_cents = excluded.monthly_amount_cents,
    current_period_end = excluded.current_period_end,
    updated_at = now();
