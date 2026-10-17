-- CrossCulture's current product schema: identity, reusable intelligence,
-- bounded provider caches, and the six durable customer records.
-- This development-only consolidation refuses to discard populated tables.

do $$
declare name text; occupied boolean;
begin
  foreach name in array array[
    'projects','analysis_runs','run_plans','matches','evidence_snapshots','concepts',
    'feedback','preference_memory','shortlists','shortlist_items','briefs',
    'source_items','cultural_signals','signal_evidence','signal_qloo_links',
    'cultural_profiles','match_evidence','match_evidence_sources','score_snapshots'
  ] loop
    execute format('select exists(select 1 from public.%I)', name) into occupied;
    if occupied then raise exception 'Refusing to remove populated public.%', name; end if;
  end loop;
  foreach name in array array['analysis_jobs','provider_cache','provider_runs',
    'provider_call_logs','qloo_queries','qloo_results'] loop
    execute format('select exists(select 1 from private.%I)', name) into occupied;
    if occupied then raise exception 'Refusing to remove populated private.%', name; end if;
  end loop;
  foreach name in array array['brand_facts','cultural_signals','signal_evidence',
    'cultural_profiles','profile_signals'] loop
    execute format('select exists(select 1 from catalog.%I)', name) into occupied;
    if occupied then raise exception 'Refusing to remove populated catalog.%', name; end if;
  end loop;
  foreach name in array array['sessions','analysis_runs','analysis_jobs'] loop
    execute format('select exists(select 1 from demo.%I)', name) into occupied;
    if occupied then raise exception 'Refusing to remove populated demo.%', name; end if;
  end loop;
end $$;

drop function private.purge_due_apify_snapshots(integer);
drop function private.purge_apify_snapshot(uuid, text);
drop function private.check_analysis_entities() cascade;
drop function private.check_match_entities() cascade;

do $$
declare name text;
begin
  foreach name in array array[
    'projects','analysis_runs','run_plans','matches','evidence_snapshots','concepts',
    'feedback','preference_memory','shortlists','shortlist_items','briefs',
    'source_items','cultural_signals','signal_evidence','signal_qloo_links',
    'cultural_profiles','match_evidence','match_evidence_sources','score_snapshots'
  ] loop execute format('drop table public.%I cascade', name); end loop;
  foreach name in array array['analysis_jobs','provider_cache','provider_runs',
    'provider_call_logs','qloo_queries','qloo_results'] loop
    execute format('drop table private.%I cascade', name);
  end loop;
  foreach name in array array['brand_facts','cultural_signals','signal_evidence',
    'cultural_profiles','profile_signals'] loop
    execute format('drop table catalog.%I cascade', name);
  end loop;
end $$;
drop schema demo cascade;

alter table catalog.entities
  add column official_website text,
  add column parent_organization_qid text,
  add column facts_json jsonb not null default '{}'::jsonb,
  add column facts_verified_at timestamptz;
alter table private.apify_cache_snapshots drop column source_run_id;

-- A shared cultural profile is entity-centered and versioned. Each claim keeps
-- its own source references so deleting one Apify snapshot need not erase
-- unrelated Wikidata or Qloo claims.
create table catalog.cultural_intelligence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references catalog.entities(id),
  version integer not null check (version > 0),
  claims_json jsonb not null default '[]'::jsonb check (jsonb_typeof(claims_json) = 'array'),
  summary_json jsonb not null default '{}'::jsonb check (jsonb_typeof(summary_json) = 'object'),
  provenance_json jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance_json) = 'object'),
  apify_snapshot_ids uuid[] not null default '{}',
  status text not null default 'valid' check (status in ('valid','stale','redacted')),
  generated_at timestamptz not null default now(),
  unique (entity_id, version)
);
create index cultural_intelligence_apify_idx on catalog.cultural_intelligence
  using gin(apify_snapshot_ids);

-- Qloo output is query/context-specific, never an unconditional entity fact.
-- Private is the default. Global reuse requires an explicit rights decision.
create table private.qloo_responses (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null check (cache_key ~ '^[a-f0-9]{64}$'),
  version integer not null check (version > 0),
  result_hash text not null check (result_hash ~ '^[a-f0-9]{64}$'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  operation text not null,
  context_json jsonb not null check (jsonb_typeof(context_json) = 'object'),
  normalized_result_json jsonb not null check (jsonb_typeof(normalized_result_json) in ('object','array')),
  resolved_entity_ids text[] not null default '{}',
  affinities_json jsonb not null default '[]'::jsonb check (jsonb_typeof(affinities_json) = 'array'),
  relationships_json jsonb not null default '[]'::jsonb check (jsonb_typeof(relationships_json) = 'array'),
  explainability_json jsonb check (explainability_json is null or jsonb_typeof(explainability_json) in ('object','array')),
  rights_json jsonb not null default '{}'::jsonb check (jsonb_typeof(rights_json) = 'object'),
  reuse_scope text not null default 'private' check (reuse_scope in ('private','global')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  provider_status text not null,
  explainability_status text,
  responded_at timestamptz not null,
  collected_at timestamptz not null default now(),
  fresh_until timestamptz,
  retain_until timestamptz,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active','restricted','deletion_requested')),
  unique (cache_key,version),
  unique (cache_key,result_hash),
  check ((reuse_scope = 'private' and owner_user_id is not null)
      or (reuse_scope = 'global' and owner_user_id is null and rights_json->>'cross_user_reuse' = 'permitted')),
  check (rights_json->>'storage' = 'permitted'),
  check (operation in ('qloo_describe','qloo_find_tags','qloo_recommend','qloo_rank')),
  check (retain_until is not null or rights_json->>'retention_basis' = 'indefinite_permitted'),
  check (fresh_until is null or fresh_until >= collected_at),
  check (retain_until is null or retain_until > collected_at)
);
create index qloo_responses_lookup_idx on private.qloo_responses(operation,input_hash,collected_at desc);
create index qloo_responses_retention_idx on private.qloo_responses(retain_until)
  where retain_until is not null;

alter table catalog.cultural_intelligence
  add column qloo_response_ids uuid[] not null default '{}';
create index cultural_intelligence_qloo_idx on catalog.cultural_intelligence
  using gin(qloo_response_ids);

create function private.check_shared_intelligence_sources() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ref_id uuid;
begin
  foreach ref_id in array new.apify_snapshot_ids loop
    if not exists (select 1 from private.apify_cache_snapshots s
      join private.apify_cache_requests r on r.request_key = s.request_key
      where s.id = ref_id and r.reuse_scope = 'global' and s.reuse_allowed
        and s.lifecycle_status = 'active'
        and (s.retain_until is null or s.retain_until > now())) then
      raise exception 'Apify source is not eligible for shared intelligence' using errcode = '23514';
    end if;
  end loop;
  foreach ref_id in array new.qloo_response_ids loop
    if not exists (select 1 from private.qloo_responses q where q.id = ref_id
      and q.reuse_scope = 'global' and q.lifecycle_status = 'active'
      and (q.retain_until is null or q.retain_until > now())) then
      raise exception 'Qloo response is not eligible for shared intelligence' using errcode = '23514';
    end if;
  end loop;
  return new;
end; $$;
create trigger shared_intelligence_sources_check before insert or update of apify_snapshot_ids,qloo_response_ids
  on catalog.cultural_intelligence for each row execute function private.check_shared_intelligence_sources();

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seed_entity_id uuid not null references catalog.entities(id),
  specified_partner_id uuid references catalog.entities(id),
  kind text not null check (kind in ('discovery','direct_pair')),
  match_type text not null check (match_type in ('brand_brand','brand_youtube_creator')),
  objective text not null check (objective in ('awareness','new_audience','repositioning',
    'co_created_product','content_collaboration','sponsorship')),
  constraints_json jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints_json) = 'object'),
  plan_json jsonb not null default '{}'::jsonb check (jsonb_typeof(plan_json) = 'object'),
  feedback_snapshot_json jsonb not null default '{}'::jsonb,
  provider_refs_json jsonb not null default '[]'::jsonb check (jsonb_typeof(provider_refs_json) = 'array'),
  result_json jsonb,
  status text not null default 'queued'
    check (status in ('queued','running','completed','partial','failed','cancelled')),
  stage text not null default 'queued',
  attempt integer not null default 0 check (attempt >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  worker_id text,
  idempotency_key text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id,user_id),
  unique (user_id,idempotency_key),
  check ((kind = 'direct_pair' and specified_partner_id is not null)
      or (kind = 'discovery' and specified_partner_id is null))
);
create index analysis_runs_claim_idx on public.analysis_runs(status,available_at,lease_until);
create index analysis_runs_user_date_idx on public.analysis_runs(user_id,created_at desc);

create function private.check_compact_analysis_entities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare seed_kind text; partner_kind text; expected text;
begin
  select kind into seed_kind from catalog.entities where id = new.seed_entity_id;
  if seed_kind is distinct from 'brand' then
    raise exception 'Analysis seed must be a brand' using errcode = '23514';
  end if;
  if new.specified_partner_id is not null then
    select kind into partner_kind from catalog.entities where id = new.specified_partner_id;
    expected := case when new.match_type = 'brand_brand' then 'brand' else 'youtube_creator' end;
    if partner_kind is distinct from expected then
      raise exception 'Specified partner type does not match analysis mode' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger compact_analysis_entities_check before insert or update of seed_entity_id,specified_partner_id,match_type
  on public.analysis_runs for each row execute function private.check_compact_analysis_entities();

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_run_id uuid not null,
  brand_entity_id uuid not null references catalog.entities(id),
  partner_entity_id uuid not null references catalog.entities(id),
  eligibility text not null default 'unassessed',
  saved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  unique (id,user_id,analysis_run_id),
  unique (analysis_run_id,partner_entity_id),
  foreign key (analysis_run_id,user_id) references public.analysis_runs(id,user_id) on delete cascade,
  check (brand_entity_id <> partner_entity_id)
);

create function private.check_compact_match_entities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent public.analysis_runs%rowtype; partner_kind text; expected text;
begin
  select * into parent from public.analysis_runs where id = new.analysis_run_id and user_id = new.user_id;
  if not found or new.brand_entity_id is distinct from parent.seed_entity_id
    or (parent.kind = 'direct_pair' and new.partner_entity_id is distinct from parent.specified_partner_id) then
    raise exception 'Match must belong to its analysis pair' using errcode = '23514';
  end if;
  select kind into partner_kind from catalog.entities where id = new.partner_entity_id;
  expected := case when parent.match_type = 'brand_brand' then 'brand' else 'youtube_creator' end;
  if partner_kind is distinct from expected then
    raise exception 'Match partner type does not match analysis mode' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger compact_match_entities_check before insert or update of analysis_run_id,brand_entity_id,partner_entity_id
  on public.matches for each row execute function private.check_compact_match_entities();

-- One immutable score/evidence version for a pair, objective and optional concept.
create table public.assessment_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  version integer not null check (version > 0),
  objective text not null,
  concept_id uuid,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  scoring_version text not null,
  evidence_json jsonb not null check (jsonb_typeof(evidence_json) = 'object'),
  score_json jsonb not null check (jsonb_typeof(score_json) = 'object'),
  source_refs_json jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs_json) = 'array'),
  qloo_response_ids uuid[] not null default '{}',
  apify_snapshot_ids uuid[] not null default '{}',
  validity_status text not null default 'valid' check (validity_status in ('valid','stale','redacted')),
  created_at timestamptz not null default now(),
  unique (id,user_id),
  unique (id,user_id,match_id),
  unique (match_id,version),
  foreign key (match_id,user_id) references public.matches(id,user_id) on delete cascade
);
create index assessments_apify_idx on public.assessment_snapshots using gin(apify_snapshot_ids);

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  base_assessment_id uuid not null,
  version integer not null check (version > 0),
  title text not null,
  format text,
  draft_json jsonb not null check (jsonb_typeof(draft_json) = 'object'),
  edited_json jsonb check (edited_json is null or jsonb_typeof(edited_json) = 'object'),
  status text not null default 'draft' check (status in ('draft','edited','invalidated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  unique (id,user_id,match_id),
  unique (match_id,version),
  foreign key (match_id,user_id) references public.matches(id,user_id) on delete cascade,
  foreign key (base_assessment_id,user_id,match_id)
    references public.assessment_snapshots(id,user_id,match_id)
);
alter table public.assessment_snapshots add constraint assessment_concept_same_owner_fk
  foreign key (concept_id,user_id,match_id) references public.concepts(id,user_id,match_id);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_run_id uuid not null,
  match_id uuid,
  action text not null check (action in ('save','reject','too_obvious','poor_cultural_fit',
    'not_feasible','already_contacted','not_relevant','correction','explicit_preference')),
  reason text,
  correction_json jsonb,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (analysis_run_id,user_id) references public.analysis_runs(id,user_id) on delete cascade,
  foreign key (match_id,user_id,analysis_run_id)
    references public.matches(id,user_id,analysis_run_id) on delete cascade
);
create index feedback_user_date_idx on public.feedback(user_id,created_at desc);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  concept_id uuid not null,
  assessment_id uuid not null,
  content_markdown text not null,
  revision integer not null default 1 check (revision > 0),
  validity_status text not null default 'valid' check (validity_status in ('valid','unsupported','redacted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (match_id,user_id) references public.matches(id,user_id) on delete cascade,
  foreign key (concept_id,user_id,match_id) references public.concepts(id,user_id,match_id),
  foreign key (assessment_id,user_id,match_id) references public.assessment_snapshots(id,user_id,match_id)
);

-- Rights-driven removal invalidates dependent versions and strips only claims
-- citing the removed Apify snapshot from shared cultural intelligence.
create function private.purge_apify_snapshot(p_snapshot_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare snapshot private.apify_cache_snapshots%rowtype;
declare impacted uuid[];
declare catalog_count integer;
begin
  if p_reason not in ('retention_limit','source_restriction','deletion_request','rights_change') then
    raise exception 'Unsupported Apify purge reason' using errcode = '22023';
  end if;
  select * into snapshot from private.apify_cache_snapshots where id = p_snapshot_id for update;
  if not found then return false; end if;
  if p_reason = 'retention_limit' and (snapshot.retain_until is null or snapshot.retain_until > now()) then
    raise exception 'Apify snapshot retention is still permitted' using errcode = '22023';
  end if;
  select coalesce(array_agg(id),'{}'::uuid[]),count(*) into impacted,catalog_count
    from catalog.source_items where apify_snapshot_id = p_snapshot_id;
  update catalog.cultural_intelligence ci set
    claims_json = coalesce((select jsonb_agg(claim) from jsonb_array_elements(ci.claims_json) claim
      where not exists (select 1 from jsonb_array_elements(coalesce(claim->'source_refs','[]'::jsonb)) ref
        where ref->>'kind' = 'apify_snapshot' and ref->>'id' = p_snapshot_id::text)), '[]'::jsonb),
    summary_json = '{}'::jsonb, status = 'stale',
    apify_snapshot_ids = array_remove(ci.apify_snapshot_ids,p_snapshot_id)
    where p_snapshot_id = any(ci.apify_snapshot_ids);
  update public.assessment_snapshots set validity_status = 'redacted',
    evidence_json = '{}'::jsonb, score_json = '{}'::jsonb, source_refs_json = '[]'::jsonb
    where p_snapshot_id = any(apify_snapshot_ids);
  update public.concepts set status = 'invalidated', draft_json = '{}'::jsonb, edited_json = null
    where base_assessment_id in (select id from public.assessment_snapshots where p_snapshot_id = any(apify_snapshot_ids));
  update public.briefs set validity_status = 'redacted',
    content_markdown = 'Source evidence was removed under its data-use rules.'
    where assessment_id in (select id from public.assessment_snapshots where p_snapshot_id = any(apify_snapshot_ids));
  delete from catalog.source_items where apify_snapshot_id = p_snapshot_id;
  delete from private.apify_cache_snapshots where id = p_snapshot_id;
  insert into private.apify_purge_log(request_key,snapshot_id,reason,affected_catalog_items,affected_private_items)
    values (snapshot.request_key,p_snapshot_id,p_reason,catalog_count,0);
  return true;
end; $$;

create function private.purge_due_apify_snapshots(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; purged integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'Invalid purge batch size' using errcode = '22023'; end if;
  for item in select id,lifecycle_status from private.apify_cache_snapshots
    where (retain_until is not null and retain_until <= now())
      or lifecycle_status in ('restricted','deletion_requested')
    order by collected_at limit p_limit
  loop
    if private.purge_apify_snapshot(item.id,
      case when item.lifecycle_status = 'deletion_requested' then 'deletion_request'
           when item.lifecycle_status = 'restricted' then 'source_restriction'
           else 'retention_limit' end) then purged := purged + 1; end if;
  end loop;
  return purged;
end; $$;

create function private.purge_qloo_response(p_response_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare response private.qloo_responses%rowtype;
begin
  if p_reason not in ('retention_limit','source_restriction','deletion_request','rights_change') then
    raise exception 'Unsupported Qloo purge reason' using errcode = '22023';
  end if;
  select * into response from private.qloo_responses where id = p_response_id for update;
  if not found then return false; end if;
  if p_reason = 'retention_limit' and (response.retain_until is null or response.retain_until > now()) then
    raise exception 'Qloo response retention is still permitted' using errcode = '22023';
  end if;
  update catalog.cultural_intelligence ci set
    claims_json = coalesce((select jsonb_agg(claim) from jsonb_array_elements(ci.claims_json) claim
      where not exists (select 1 from jsonb_array_elements(coalesce(claim->'source_refs','[]'::jsonb)) ref
        where ref->>'kind' = 'qloo_response' and ref->>'id' = p_response_id::text)), '[]'::jsonb),
    summary_json = '{}'::jsonb, status = 'stale',
    qloo_response_ids = array_remove(ci.qloo_response_ids,p_response_id)
    where p_response_id = any(ci.qloo_response_ids);
  update public.assessment_snapshots set validity_status = 'redacted',
    evidence_json = '{}'::jsonb, score_json = '{}'::jsonb, source_refs_json = '[]'::jsonb
    where p_response_id = any(qloo_response_ids);
  update public.concepts set status = 'invalidated', draft_json = '{}'::jsonb, edited_json = null
    where base_assessment_id in (select id from public.assessment_snapshots where p_response_id = any(qloo_response_ids));
  update public.briefs set validity_status = 'redacted',
    content_markdown = 'Source evidence was removed under its data-use rules.'
    where assessment_id in (select id from public.assessment_snapshots where p_response_id = any(qloo_response_ids));
  delete from private.qloo_responses where id = p_response_id;
  return true;
end; $$;

create function private.purge_due_qloo_responses(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; purged integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'Invalid purge batch size' using errcode = '22023'; end if;
  for item in select id,lifecycle_status from private.qloo_responses
    where (retain_until is not null and retain_until <= now())
      or lifecycle_status in ('restricted','deletion_requested')
    order by collected_at limit p_limit
  loop
    if private.purge_qloo_response(item.id,
      case when item.lifecycle_status = 'deletion_requested' then 'deletion_request'
           when item.lifecycle_status = 'restricted' then 'source_restriction'
           else 'retention_limit' end) then purged := purged + 1; end if;
  end loop;
  return purged;
end; $$;

do $$
declare name text;
begin
  foreach name in array array['analysis_runs','matches','assessment_snapshots','concepts','feedback','briefs'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from anon,authenticated',name);
    execute format('grant select on public.%I to authenticated',name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      name || '_select_own',name);
  end loop;
end $$;
alter table catalog.cultural_intelligence enable row level security;
alter table private.qloo_responses enable row level security;
revoke all on all tables in schema catalog,private from public,anon,authenticated;
grant all on all tables in schema catalog,private to service_role;
revoke all on function private.purge_apify_snapshot(uuid,text) from public,anon,authenticated;
revoke all on function private.purge_due_apify_snapshots(integer) from public,anon,authenticated;
revoke all on function private.purge_qloo_response(uuid,text) from public,anon,authenticated;
revoke all on function private.purge_due_qloo_responses(integer) from public,anon,authenticated;
revoke all on function private.check_shared_intelligence_sources() from public,anon,authenticated;
revoke all on function private.check_compact_analysis_entities() from public,anon,authenticated;
revoke all on function private.check_compact_match_entities() from public,anon,authenticated;
grant execute on function private.purge_apify_snapshot(uuid,text) to service_role;
grant execute on function private.purge_due_apify_snapshots(integer) to service_role;
grant execute on function private.purge_qloo_response(uuid,text) to service_role;
grant execute on function private.purge_due_qloo_responses(integer) to service_role;
