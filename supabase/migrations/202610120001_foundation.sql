-- CrossCulture v1.4 foundation. Apply with the Supabase migration runner.
-- Catalog, operational records and anonymous demo data are never exposed to browser roles.
create extension if not exists pgcrypto;
create schema if not exists catalog;
create schema if not exists private;
create schema if not exists demo;

revoke all on schema catalog, private, demo from public, anon, authenticated;
grant usage on schema catalog, private, demo to service_role;

create table catalog.entities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('brand', 'youtube_creator')),
  canonical_name text not null check (length(trim(canonical_name)) > 0),
  canonical_url text,
  description text,
  country text,
  category text,
  identity_status text not null default 'unverified' check (identity_status in ('unverified', 'verified', 'conflicted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index entities_canonical_url_uq on catalog.entities (canonical_url) where canonical_url is not null;

create table catalog.entity_identifiers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references catalog.entities(id) on delete cascade,
  provider text not null check (provider in ('qloo', 'wikidata', 'youtube', 'instagram')),
  external_id text not null check (length(trim(external_id)) > 0),
  external_url text,
  confidence numeric(4,3) check (confidence between 0 and 1),
  verified_at timestamptz,
  status text not null default 'candidate' check (status in ('candidate', 'confirmed', 'rejected'))
);
create unique index entity_identifiers_confirmed_uq on catalog.entity_identifiers(provider, external_id) where status = 'confirmed';
create index entity_identifiers_entity_idx on catalog.entity_identifiers(entity_id);

create table catalog.brand_facts (
  entity_id uuid primary key references catalog.entities(id) on delete cascade,
  wikidata_qid text,
  official_website text,
  industry text,
  parent_organization_qid text,
  parent_organization_name text,
  country text,
  facts_json jsonb not null default '{}'::jsonb check (jsonb_typeof(facts_json) = 'object'),
  verified_at timestamptz
);

create table catalog.social_accounts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references catalog.entities(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'youtube')),
  external_account_id text,
  handle text,
  profile_url text not null,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'rejected')),
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index social_accounts_external_uq on catalog.social_accounts(platform, external_account_id) where external_account_id is not null;
create index social_accounts_entity_idx on catalog.social_accounts(entity_id);

-- Every customer-owned row carries user_id directly. Composite keys prevent cross-user links.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  seed_entity_id uuid references catalog.entities(id),
  default_objective text check (default_objective in ('awareness', 'new_audience', 'repositioning', 'co_created_product', 'content_collaboration', 'sponsorship')),
  defaults_json jsonb not null default '{}'::jsonb check (jsonb_typeof(defaults_json) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index projects_user_created_idx on public.projects(user_id, created_at desc);

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  kind text not null check (kind in ('discovery', 'direct_pair')),
  match_type text not null check (match_type in ('brand_brand', 'brand_youtube_creator')),
  seed_entity_id uuid not null references catalog.entities(id),
  specified_partner_id uuid references catalog.entities(id),
  objective text not null check (objective in ('awareness', 'new_audience', 'repositioning', 'co_created_product', 'content_collaboration', 'sponsorship')),
  format_preference text,
  constraints_json jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints_json) = 'object'),
  discovery_mode text,
  status text not null default 'queued' check (status in ('queued', 'resolving', 'collecting', 'extracting', 'discovering', 'enriching', 'assessing', 'generating', 'completed', 'partial', 'failed', 'cancelled')),
  stage text not null default 'queued',
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id),
  check ((kind = 'direct_pair') = (specified_partner_id is not null)),
  check (seed_entity_id is distinct from specified_partner_id)
);
create index analysis_runs_user_created_idx on public.analysis_runs(user_id, created_at desc);
create index analysis_runs_status_idx on public.analysis_runs(status, updated_at);

create table public.run_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_run_id uuid not null,
  version integer not null check (version > 0),
  feedback_snapshot_json jsonb not null default '[]'::jsonb,
  constraints_snapshot_json jsonb not null default '{}'::jsonb,
  selected_sources_json jsonb not null default '[]'::jsonb,
  evidence_questions_json jsonb not null default '[]'::jsonb,
  rationale_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (analysis_run_id, version),
  foreign key (analysis_run_id, user_id) references public.analysis_runs(id, user_id) on delete cascade
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_run_id uuid not null,
  initiator_entity_id uuid not null references catalog.entities(id),
  partner_entity_id uuid not null references catalog.entities(id),
  match_type text not null check (match_type in ('brand_brand', 'brand_youtube_creator')),
  eligibility text not null default 'undetermined',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, analysis_run_id),
  unique (analysis_run_id, partner_entity_id),
  foreign key (analysis_run_id, user_id) references public.analysis_runs(id, user_id) on delete cascade,
  check (initiator_entity_id <> partner_entity_id)
);
create index matches_user_idx on public.matches(user_id, created_at desc);

create table public.evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  snapshot_version integer not null check (snapshot_version > 0),
  input_hash text not null,
  source_refs_json jsonb not null default '[]'::jsonb,
  qloo_query_ids_json jsonb not null default '[]'::jsonb,
  normalized_input_json jsonb not null default '{}'::jsonb,
  validity_status text not null default 'valid' check (validity_status in ('valid', 'stale', 'redacted')),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, match_id),
  unique (match_id, snapshot_version),
  foreign key (match_id, user_id) references public.matches(id, user_id) on delete cascade
);

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  snapshot_id uuid not null,
  concept_version integer not null check (concept_version > 0),
  format text,
  title text not null,
  draft_json jsonb not null check (jsonb_typeof(draft_json) = 'object'),
  edited_json jsonb check (edited_json is null or jsonb_typeof(edited_json) = 'object'),
  source_refs_json jsonb not null default '[]'::jsonb,
  generation_version text not null,
  status text not null default 'draft' check (status in ('draft', 'edited', 'invalidated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, match_id, snapshot_id),
  unique (match_id, concept_version),
  foreign key (match_id, user_id) references public.matches(id, user_id) on delete cascade,
  foreign key (snapshot_id, user_id, match_id) references public.evidence_snapshots(id, user_id, match_id)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_run_id uuid not null,
  match_id uuid not null,
  action text not null check (action in ('save', 'reject', 'too_obvious', 'poor_cultural_fit', 'not_feasible', 'already_contacted', 'not_relevant', 'correction')),
  reason text,
  correction text,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (analysis_run_id, user_id) references public.analysis_runs(id, user_id) on delete cascade,
  foreign key (match_id, user_id, analysis_run_id) references public.matches(id, user_id, analysis_run_id) on delete cascade
);
create index feedback_user_created_idx on public.feedback(user_id, created_at desc);

create table public.preference_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  value_json jsonb not null,
  source_feedback_id uuid,
  origin text not null check (origin in ('explicit', 'inferred')),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (source_feedback_id, user_id) references public.feedback(id, user_id)
);

create table public.shortlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id)
);
create table public.shortlist_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  shortlist_id uuid not null,
  match_id uuid not null,
  saved_at timestamptz not null default now(),
  note text,
  primary key (shortlist_id, match_id),
  foreign key (shortlist_id, user_id) references public.shortlists(id, user_id) on delete cascade,
  foreign key (match_id, user_id) references public.matches(id, user_id) on delete cascade
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  match_id uuid not null,
  concept_id uuid not null,
  evidence_snapshot_id uuid not null,
  content_markdown text not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id),
  foreign key (match_id, user_id) references public.matches(id, user_id),
  foreign key (concept_id, user_id, match_id, evidence_snapshot_id) references public.concepts(id, user_id, match_id, snapshot_id)
);

-- Verify entity kinds and direct-pair identity at the database boundary, including
-- service-role writes that bypass row policies.
create function private.check_analysis_entities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare seed_kind text;
declare partner_kind text;
declare expected_partner_kind text;
begin
  select kind into seed_kind from catalog.entities where id = new.seed_entity_id;
  if seed_kind is distinct from 'brand' then
    raise exception 'Analysis seed must be a brand' using errcode = '23514';
  end if;
  if new.specified_partner_id is not null then
    select kind into partner_kind from catalog.entities where id = new.specified_partner_id;
    expected_partner_kind := case new.match_type when 'brand_brand' then 'brand' else 'youtube_creator' end;
    if partner_kind is distinct from expected_partner_kind then
      raise exception 'Specified partner type does not match analysis mode' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

revoke all on function private.check_analysis_entities() from public, anon, authenticated;

create trigger analysis_entities_check before insert or update of seed_entity_id, specified_partner_id, match_type
on public.analysis_runs for each row execute function private.check_analysis_entities();

create function private.check_match_entities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_run public.analysis_runs%rowtype;
declare partner_kind text;
declare expected_partner_kind text;
begin
  select * into parent_run from public.analysis_runs where id = new.analysis_run_id and user_id = new.user_id;
  if not found or new.initiator_entity_id is distinct from parent_run.seed_entity_id
      or new.match_type is distinct from parent_run.match_type
      or (parent_run.kind = 'direct_pair' and new.partner_entity_id is distinct from parent_run.specified_partner_id) then
    raise exception 'Match must belong to its analysis pair' using errcode = '23514';
  end if;
  select kind into partner_kind from catalog.entities where id = new.partner_entity_id;
  expected_partner_kind := case new.match_type when 'brand_brand' then 'brand' else 'youtube_creator' end;
  if partner_kind is distinct from expected_partner_kind then
    raise exception 'Match partner type does not match analysis mode' using errcode = '23514';
  end if;
  return new;
end; $$;

revoke all on function private.check_match_entities() from public, anon, authenticated;

create trigger match_entities_check before insert or update of analysis_run_id, initiator_entity_id, partner_entity_id, match_type
on public.matches for each row execute function private.check_match_entities();

-- Operational data is server-only. Leases make claims safe across worker restarts.
create table private.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_run_id uuid not null,
  job_kind text not null,
  status text not null default 'queued' check (status in ('queued', 'leased', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  worker_id text,
  idempotency_key text not null unique,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (analysis_run_id, user_id) references public.analysis_runs(id, user_id) on delete cascade
);
create index analysis_jobs_claim_idx on private.analysis_jobs(status, available_at, lease_until);

create table private.provider_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  cache_key text not null,
  payload_json jsonb not null,
  license_scope text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider, cache_key, license_scope)
);
create index provider_cache_expiry_idx on private.provider_cache(expires_at);

create table demo.sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index demo_sessions_expiry_idx on demo.sessions(expires_at);
create table demo.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references demo.sessions(id) on delete cascade,
  kind text not null check (kind in ('discovery', 'direct_pair')),
  input_json jsonb not null check (jsonb_typeof(input_json) = 'object'),
  status text not null default 'queued',
  stage text not null default 'queued',
  result_json jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index demo_runs_session_idx on demo.analysis_runs(session_id, created_at desc);
create index demo_runs_expiry_idx on demo.analysis_runs(expires_at);
create table demo.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references demo.analysis_runs(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'leased', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  worker_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index demo_jobs_claim_idx on demo.analysis_jobs(status, available_at, lease_until);

-- Browser sessions may read their own customer data. Mutations go through the
-- authenticated API so clients cannot manufacture evidence, concepts or scores.
-- Jobs and raw provider data have RLS enabled but no browser grants or policies.
do $$
declare table_name text;
begin
  foreach table_name in array array['projects', 'analysis_runs', 'run_plans', 'matches', 'evidence_snapshots', 'concepts', 'feedback', 'preference_memory', 'shortlists', 'shortlist_items', 'briefs'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
  end loop;
end $$;

alter table catalog.entities enable row level security;
alter table catalog.entity_identifiers enable row level security;
alter table catalog.brand_facts enable row level security;
alter table catalog.social_accounts enable row level security;
alter table private.analysis_jobs enable row level security;
alter table private.provider_cache enable row level security;
alter table demo.sessions enable row level security;
alter table demo.analysis_runs enable row level security;
alter table demo.analysis_jobs enable row level security;

revoke all on all tables in schema catalog, private, demo from public, anon, authenticated;
grant all on all tables in schema catalog, private, demo to service_role;
