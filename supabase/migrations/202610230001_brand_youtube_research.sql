-- New Qloo-led creator research. Separate from retired v4 creator tables.
create table public.youtube_research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_name text not null check (length(brand_name) between 2 and 120),
  brand_qloo_id text not null check (brand_qloo_id ~* '^[0-9a-f-]{36}$'),
  campaign_mode text not null default 'ongoing' check (campaign_mode in ('ongoing','one_off')),
  status text not null default 'queued' check (status in ('queued','running','completed','partial','failed')),
  stage text not null default 'queued',
  result_json jsonb not null default '{}'::jsonb check (jsonb_typeof(result_json) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  retain_until timestamptz not null default (now() + interval '15 days'),
  unique (id,user_id)
);
create index youtube_research_owner_idx on public.youtube_research_runs(user_id,created_at desc);
create index youtube_research_queue_idx on public.youtube_research_runs(status,updated_at);
create index youtube_research_retention_idx on public.youtube_research_runs(retain_until);
alter table public.youtube_research_runs enable row level security;
create policy youtube_research_owner_read on public.youtube_research_runs for select to authenticated
  using (auth.uid() = user_id and retain_until > now());
revoke all on public.youtube_research_runs from anon;
grant select on public.youtube_research_runs to authenticated;
grant all on public.youtube_research_runs to service_role;

-- Reserve API calls atomically across backend processes. No provider payload is stored.
create table private.youtube_research_requests (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket in ('search','shared')),
  reserved_at timestamptz not null default now()
);
create index youtube_research_quota_idx on private.youtube_research_requests(bucket,reserved_at);
revoke all on private.youtube_research_requests from public,anon,authenticated;
grant select,insert,delete on private.youtube_research_requests to service_role;

-- Public provider metadata is reusable across brands and users for 15 days.
-- Raw transcripts are never written here; only bounded channel/video metadata.
create table private.youtube_channel_cache (
  channel_id text primary key check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  inventory_json jsonb not null check (jsonb_typeof(inventory_json) = 'object'),
  observed_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '15 days')
);
create index youtube_channel_cache_retention_idx on private.youtube_channel_cache(retain_until);
revoke all on private.youtube_channel_cache from public,anon,authenticated;
grant select,insert,update,delete on private.youtube_channel_cache to service_role;

create table private.youtube_channel_profile_cache (
  channel_id text primary key check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  profile_json jsonb not null check (jsonb_typeof(profile_json) = 'object'),
  observed_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '15 days')
);
create index youtube_channel_profile_retention_idx on private.youtube_channel_profile_cache(retain_until);
revoke all on private.youtube_channel_profile_cache from public,anon,authenticated;
grant select,insert,update,delete on private.youtube_channel_profile_cache to service_role;

-- Search hits outside the bounded upload inventory still get exact ownership
-- checks. Reuse those checked video details for later brands for 15 days.
create table private.youtube_video_cache (
  video_id text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  video_json jsonb not null check (jsonb_typeof(video_json) = 'object'),
  observed_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '15 days')
);
create index youtube_video_cache_retention_idx on private.youtube_video_cache(retain_until);
revoke all on private.youtube_video_cache from public,anon,authenticated;
grant select,insert,update,delete on private.youtube_video_cache to service_role;

create table private.youtube_transcript_observations (
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  scope_key text not null check (scope_key ~ '^[a-f0-9]{64}$'),
  channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  status text not null check (status in ('available','no_captions','blocked','transient_error')),
  observations_json jsonb not null default '[]'::jsonb check (jsonb_typeof(observations_json) = 'array'),
  observed_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '15 days'),
  primary key (video_id,scope_key)
);
create index youtube_transcript_observations_retention_idx on private.youtube_transcript_observations(retain_until);
revoke all on private.youtube_transcript_observations from public,anon,authenticated;
grant select,insert,update,delete on private.youtube_transcript_observations to service_role;

-- Developer-only reviewed candidate decisions. Customer endpoints expose only
-- shortlisted channels, while evaluation still needs the rejected sample.
create table private.youtube_research_audit (
  run_id uuid primary key references public.youtube_research_runs(id) on delete cascade,
  audit_json jsonb not null check (jsonb_typeof(audit_json) = 'object'),
  retain_until timestamptz not null default (now() + interval '15 days')
);
create index youtube_research_audit_retention_idx on private.youtube_research_audit(retain_until);
revoke all on private.youtube_research_audit from public,anon,authenticated;
grant select,insert,update,delete on private.youtube_research_audit to service_role;
