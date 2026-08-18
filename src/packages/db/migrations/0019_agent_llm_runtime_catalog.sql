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
    'offering_openai_gpt_56_sol_20260817',
    'provider_openai',
    'openai/gpt-5.6-sol@2026-08-17',
    'gpt-5.6-sol',
    'GPT-5.6 Sol',
    'llm',
    '2026-08-17',
    'published',
    true,
    30
  ),
  (
    'offering_openai_gpt_56_terra_20260817',
    'provider_openai',
    'openai/gpt-5.6-terra@2026-08-17',
    'gpt-5.6-terra',
    'GPT-5.6 Terra',
    'llm',
    '2026-08-17',
    'published',
    true,
    40
  )
on conflict do nothing;

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
    'profile_openai_gpt_56_sol_20260817',
    'offering_openai_gpt_56_sol_20260817',
    'llm.responses.v1',
    '2026-08-17',
    'published',
    '{"kind":"language-model","contextWindowTokens":128000,"maxOutputTokens":4096,"reasoningLevels":["low","medium","high","xhigh"],"defaultReasoning":"high"}'::jsonb,
    '2026-08-17T00:00:00Z'
  ),
  (
    'profile_openai_gpt_56_terra_20260817',
    'offering_openai_gpt_56_terra_20260817',
    'llm.responses.v1',
    '2026-08-17',
    'published',
    '{"kind":"language-model","contextWindowTokens":128000,"maxOutputTokens":4096,"reasoningLevels":["low","medium","high","xhigh"],"defaultReasoning":"high"}'::jsonb,
    '2026-08-17T00:00:00Z'
  )
on conflict do nothing;
