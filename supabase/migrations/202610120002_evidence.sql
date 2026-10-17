-- CrossCulture v1.4 source lineage, Qloo provenance and versioned assessment.

create table private.provider_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  analysis_run_id uuid,
  provider text not null,
  operation text not null,
  actor_id text,
  remote_run_id text,
  dataset_id text,
  entity_id uuid references catalog.entities(id),
  status text not null,
  attempt integer not null default 1 check (attempt > 0),
  input_hash text not null,
  result_count integer check (result_count >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  cost_estimate numeric(12,6) check (cost_estimate >= 0),
  unique (id, user_id),
  foreign key (analysis_run_id, user_id) references public.analysis_runs(id, user_id),
  check ((analysis_run_id is null and user_id is null) or (analysis_run_id is not null and user_id is not null))
);
create unique index provider_runs_remote_uq on private.provider_runs(provider, remote_run_id) where remote_run_id is not null;
create index provider_runs_hash_idx on private.provider_runs(provider, input_hash, started_at desc);

create table catalog.source_items (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references catalog.entities(id),
  platform text not null,
  source_type text not null,
  external_item_id text,
  source_url text not null,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  expires_at timestamptz,
  excerpt text,
  rights_json jsonb not null check (jsonb_typeof(rights_json) = 'object')
);
create unique index catalog_source_dedupe_uq on catalog.source_items(platform, source_url);
create index catalog_source_expiry_idx on catalog.source_items(expires_at);

create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references catalog.entities(id),
  platform text not null check (platform in ('instagram', 'youtube', 'web', 'wikidata', 'brand_site')),
  source_type text not null,
  external_item_id text,
  source_url text not null,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  expires_at timestamptz,
  excerpt text,
  hashtags_json jsonb,
  metrics_json jsonb,
  rights_json jsonb not null check (jsonb_typeof(rights_json) = 'object'),
  provider_run_id uuid,
  unique (id, user_id),
  foreign key (provider_run_id, user_id) references private.provider_runs(id, user_id)
);
create unique index source_items_external_uq on public.source_items(user_id, platform, external_item_id) where external_item_id is not null;
create unique index source_items_url_uq on public.source_items(user_id, platform, source_url) where external_item_id is null;
create index source_items_entity_date_idx on public.source_items(user_id, entity_id, platform, published_at desc);
create index source_items_expiry_idx on public.source_items(expires_at);

create table public.cultural_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references catalog.entities(id),
  kind text not null,
  normalized_key text not null,
  label text not null,
  salience numeric(4,3) check (salience between 0 and 1),
  extraction_confidence numeric(4,3) check (extraction_confidence between 0 and 1),
  context text,
  extraction_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (id, user_id),
  unique (user_id, entity_id, normalized_key, extraction_version)
);

create table public.signal_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id uuid not null,
  source_item_id uuid,
  catalog_source_item_id uuid references catalog.source_items(id),
  evidence_excerpt text,
  mention_kind text not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (signal_id, user_id) references public.cultural_signals(id, user_id) on delete cascade,
  foreign key (source_item_id, user_id) references public.source_items(id, user_id),
  check (num_nonnulls(source_item_id, catalog_source_item_id) = 1)
);
create unique index signal_evidence_private_uq on public.signal_evidence(signal_id, source_item_id) where source_item_id is not null;
create unique index signal_evidence_catalog_uq on public.signal_evidence(signal_id, catalog_source_item_id) where catalog_source_item_id is not null;

create table public.signal_qloo_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id uuid not null,
  qloo_entity_id text not null,
  qloo_type text,
  resolution_confidence numeric(4,3) check (resolution_confidence between 0 and 1),
  status text not null check (status in ('candidate', 'confirmed', 'rejected')),
  checked_at timestamptz not null default now(),
  unique (id, user_id),
  unique (signal_id, qloo_entity_id),
  foreign key (signal_id, user_id) references public.cultural_signals(id, user_id) on delete cascade
);

create table public.cultural_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references catalog.entities(id),
  profile_version integer not null check (profile_version > 0),
  content_fingerprint text not null,
  observed_summary_json jsonb not null default '{}'::jsonb,
  resolved_signal_ids_json jsonb not null default '[]'::jsonb,
  coverage_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'valid' check (status in ('valid', 'stale', 'redacted')),
  unique (id, user_id),
  unique (user_id, entity_id, profile_version)
);

create table private.qloo_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  analysis_run_id uuid,
  input_hash text not null,
  query_context_json jsonb not null default '{}'::jsonb,
  provider_status text not null,
  response_reference text,
  explainability_status text,
  queried_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (id, user_id),
  foreign key (analysis_run_id, user_id) references public.analysis_runs(id, user_id) on delete cascade,
  check ((analysis_run_id is null and user_id is null) or (analysis_run_id is not null and user_id is not null))
);
create index qloo_queries_hash_idx on private.qloo_queries(input_hash, queried_at desc);

create table private.qloo_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query_id uuid not null,
  candidate_qloo_id text not null,
  candidate_entity_id uuid references catalog.entities(id),
  qloo_type text,
  affinity_value numeric,
  explanation_json jsonb,
  result_context_json jsonb,
  unique (id, user_id),
  unique (query_id, candidate_qloo_id),
  foreign key (query_id, user_id) references private.qloo_queries(id, user_id) on delete cascade
);

create table public.match_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  snapshot_id uuid not null,
  claim_kind text not null,
  claim text not null,
  assessment_state text not null,
  qloo_query_id uuid,
  evidence_kind text not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (match_id, user_id) references public.matches(id, user_id) on delete cascade,
  foreign key (snapshot_id, user_id, match_id) references public.evidence_snapshots(id, user_id, match_id),
  foreign key (qloo_query_id, user_id) references private.qloo_queries(id, user_id)
);

create table public.match_evidence_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_evidence_id uuid not null,
  source_item_id uuid,
  catalog_source_item_id uuid references catalog.source_items(id),
  qloo_result_id uuid,
  foreign key (match_evidence_id, user_id) references public.match_evidence(id, user_id) on delete cascade,
  foreign key (source_item_id, user_id) references public.source_items(id, user_id),
  foreign key (qloo_result_id, user_id) references private.qloo_results(id, user_id),
  check (num_nonnulls(source_item_id, catalog_source_item_id, qloo_result_id) = 1)
);

create table public.score_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  evidence_snapshot_id uuid not null,
  concept_id uuid,
  algorithm_version text not null,
  objective text not null,
  mode text not null,
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  eligibility text not null,
  confidence text,
  computed_at timestamptz not null default now(),
  foreign key (match_id, user_id) references public.matches(id, user_id) on delete cascade,
  foreign key (evidence_snapshot_id, user_id, match_id) references public.evidence_snapshots(id, user_id, match_id),
  foreign key (concept_id, user_id, match_id, evidence_snapshot_id) references public.concepts(id, user_id, match_id, snapshot_id)
);
create unique index score_snapshots_no_concept_uq on public.score_snapshots(match_id, evidence_snapshot_id, algorithm_version, objective, mode) where concept_id is null;
create unique index score_snapshots_concept_uq on public.score_snapshots(match_id, evidence_snapshot_id, concept_id, algorithm_version, objective, mode) where concept_id is not null;
create index score_snapshots_match_date_idx on public.score_snapshots(match_id, computed_at desc);

create table private.provider_call_logs (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid references public.analysis_runs(id) on delete cascade,
  provider text not null,
  operation text not null,
  status text not null,
  latency_ms integer check (latency_ms >= 0),
  result_count integer check (result_count >= 0),
  cost_estimate numeric(12,6) check (cost_estimate >= 0),
  error_code text,
  created_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
  foreach table_name in array array['source_items', 'cultural_signals', 'signal_evidence', 'signal_qloo_links', 'cultural_profiles', 'match_evidence', 'match_evidence_sources', 'score_snapshots'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
  end loop;
end; $$;

alter table catalog.source_items enable row level security;
alter table private.provider_runs enable row level security;
alter table private.qloo_queries enable row level security;
alter table private.qloo_results enable row level security;
alter table private.provider_call_logs enable row level security;
revoke all on all tables in schema catalog, private from public, anon, authenticated;
grant all on all tables in schema catalog, private to service_role;
