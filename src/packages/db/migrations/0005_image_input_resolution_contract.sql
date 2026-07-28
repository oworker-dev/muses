create table if not exists muses_reference_image (
  id text primary key,
  workspace_id text not null references muses_workspace (id) on delete cascade,
  object_key text not null unique,
  file_name text not null,
  declared_mime_type text not null,
  mime_type text,
  byte_size bigint,
  width integer,
  height integer,
  status text not null default 'uploading',
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check (status in ('uploading', 'ready', 'rejected')),
  check (declared_mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  check (mime_type is null or mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  check (byte_size is null or byte_size > 0),
  check (width is null or width > 0),
  check (height is null or height > 0),
  check (
    status <> 'ready'
    or (
      mime_type is not null
      and byte_size is not null
      and width is not null
      and height is not null
      and confirmed_at is not null
    )
  )
);

create index if not exists muses_reference_image_workspace_created_idx
  on muses_reference_image (workspace_id, created_at desc);

update capability_profile
set lifecycle_status = 'retired', updated_at = now()
where id in (
  'profile_openai_gpt_image_2_20260728',
  'profile_openai_gpt_image_15_20260728'
)
  and lifecycle_status = 'published';

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
    'profile_openai_gpt_image_2_20260728_1',
    'offering_openai_gpt_image_2_20260728',
    'image.generate.v1',
    '2026-07-28.1',
    'published',
    '{"kind":"image-generation","inputModes":["text-to-image","image-to-image"],"referenceImages":{"maxCount":16,"mimeTypes":["image/png","image/jpeg","image/webp"],"maxBytes":52428800},"aspectRatios":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"],"resolutionPresets":[{"id":"1k","label":"1K","longEdge":1024},{"id":"2k","label":"2K","longEdge":2048},{"id":"4k","label":"4K","longEdge":3840}],"customSize":{"enabled":true},"sizeConstraints":{"strategy":"continuous-grid","dimensionMultiple":16,"maxEdge":3840,"minPixels":655360,"maxPixels":8294400,"maxAspectRatio":3,"legalization":"nearest"},"outputCounts":[1,2,3,4],"parameters":{"quality":{"type":"enum","values":["low","medium","high"],"default":"medium"}}}'::jsonb,
    '2026-07-28T00:00:00+08:00'
  ),
  (
    'profile_openai_gpt_image_15_20260728_1',
    'offering_openai_gpt_image_15_20260728',
    'image.generate.v1',
    '2026-07-28.1',
    'published',
    '{"kind":"image-generation","inputModes":["text-to-image","image-to-image"],"referenceImages":{"maxCount":16,"mimeTypes":["image/png","image/jpeg","image/webp"],"maxBytes":52428800},"aspectRatios":["1:1","3:2","2:3"],"resolutionPresets":[{"id":"1k","label":"1K","longEdge":1536}],"customSize":{"enabled":false},"sizeConstraints":{"strategy":"discrete","sizes":[{"presetId":"1k","aspectRatio":"1:1","width":1024,"height":1024},{"presetId":"1k","aspectRatio":"3:2","width":1536,"height":1024},{"presetId":"1k","aspectRatio":"2:3","width":1024,"height":1536}]},"outputCounts":[1,2,3,4],"parameters":{"quality":{"type":"enum","values":["low","medium","high"],"default":"medium"}}}'::jsonb,
    '2026-07-28T00:00:00+08:00'
  )
on conflict (id) do nothing;
