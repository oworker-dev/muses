update price_book_entry
set lifecycle_status = 'retired', updated_at = now()
where id in (
  'price_openai_gpt_image_2_alpha_20260728',
  'price_openai_gpt_image_15_alpha_20260728'
)
  and lifecycle_status = 'published';

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
    'price_openai_gpt_image_2_alpha_20260728_1',
    'offering_openai_gpt_image_2_20260728',
    'alpha-2026-07-28.1',
    'published',
    'image-output',
    1000000,
    'USD',
    '{"kind":"output-count","pricingBasis":"alpha-flat-image-output"}'::jsonb,
    '2026-07-28T00:00:00+08:00'
  ),
  (
    'price_openai_gpt_image_15_alpha_20260728_1',
    'offering_openai_gpt_image_15_20260728',
    'alpha-2026-07-28.1',
    'published',
    'image-output',
    1000000,
    'USD',
    '{"kind":"output-count","pricingBasis":"alpha-flat-image-output"}'::jsonb,
    '2026-07-28T00:00:00+08:00'
  )
on conflict (id) do nothing;
