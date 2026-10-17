-- Global Apify account cache. No browser role may read, write, or delete it.
-- Freshness and permission to retain are separate clocks. Staleness never purges a row.

alter table catalog.social_accounts
  add column apify_restricted_at timestamptz,
  add column apify_restriction_reason text,
  add constraint social_accounts_canonical_ref_uq unique (id, platform, external_account_id);

create table private.apify_cache_requests (
  request_key text primary key check (request_key ~ '^[a-f0-9]{64}$'),
  account_id uuid not null,
  platform text not null check (platform in ('instagram', 'youtube')),
  external_account_id text not null check (length(trim(external_account_id)) > 0),
  actor_id text not null check (actor_id in ('apify/instagram-scraper', 'streamers/youtube-scraper')),
  operation text not null check (operation in ('profile', 'posts', 'channel_videos')),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  reuse_scope text not null check (reuse_scope in ('global', 'private')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  claim_token uuid,
  claim_expires_at timestamptz,
  claim_authorization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, platform, external_account_id)
    references catalog.social_accounts(id, platform, external_account_id),
  check ((actor_id = 'apify/instagram-scraper' and platform = 'instagram' and operation in ('profile', 'posts'))
      or (actor_id = 'streamers/youtube-scraper' and platform = 'youtube' and operation = 'channel_videos')),
  check ((reuse_scope = 'global' and owner_user_id is null)
      or (reuse_scope = 'private' and owner_user_id is not null)),
  check ((claim_token is null and claim_expires_at is null and claim_authorization_id is null)
      or (claim_token is not null and claim_expires_at is not null and claim_authorization_id is not null))
);
create unique index apify_requests_global_dedupe_uq
  on private.apify_cache_requests(actor_id, operation, account_id, input_hash) where reuse_scope = 'global';
create unique index apify_requests_private_dedupe_uq
  on private.apify_cache_requests(actor_id, operation, account_id, input_hash, owner_user_id) where reuse_scope = 'private';

create table private.apify_budget_periods (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  limit_usd numeric(12,6) not null check (limit_usd >= 0),
  reserved_usd numeric(12,6) not null default 0 check (reserved_usd >= 0),
  spent_usd numeric(12,6) not null default 0 check (spent_usd >= 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (period_start, period_end),
  check (period_end > period_start),
  check (reserved_usd + spent_usd <= limit_usd)
);

create table private.apify_refresh_authorizations (
  id uuid primary key default gen_random_uuid(),
  request_key text not null references private.apify_cache_requests(request_key),
  request_reason text not null check (request_reason in ('explicit_refresh', 'necessary_research')),
  approval_reference text not null check (length(trim(approval_reference)) > 0),
  approved_input_hash text not null check (approved_input_hash ~ '^[a-f0-9]{64}$'),
  max_results integer not null check (max_results between 1 and 10),
  max_cost_usd numeric(12,6) not null check (max_cost_usd > 0),
  budget_period_id uuid not null references private.apify_budget_periods(id),
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  reserved_at timestamptz,
  completed_at timestamptz,
  actual_cost_usd numeric(12,6) check (actual_cost_usd >= 0),
  check (expires_at > approved_at),
  check (actual_cost_usd is null or actual_cost_usd <= max_cost_usd)
);
alter table private.apify_cache_requests
  add constraint apify_claim_authorization_fk foreign key (claim_authorization_id)
    references private.apify_refresh_authorizations(id);
create unique index apify_refresh_approval_ref_uq on private.apify_refresh_authorizations(approval_reference);

create table private.apify_cache_snapshots (
  id uuid primary key default gen_random_uuid(),
  request_key text not null references private.apify_cache_requests(request_key),
  version integer not null check (version > 0),
  normalized_payload_json jsonb not null check (jsonb_typeof(normalized_payload_json) in ('object', 'array')),
  rights_json jsonb not null check (jsonb_typeof(rights_json) = 'object'),
  reuse_allowed boolean not null default false,
  sample_data boolean not null default false,
  collected_at timestamptz not null,
  fresh_until timestamptz not null,
  retain_until timestamptz,
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'restricted', 'deletion_requested')),
  source_run_id uuid references private.provider_runs(id),
  created_at timestamptz not null default now(),
  unique (request_key, version),
  check (fresh_until >= collected_at),
  check (retain_until is null or retain_until > collected_at),
  check (retain_until is not null or rights_json->>'retention_basis' = 'indefinite_permitted'),
  check (not reuse_allowed or rights_json->>'cross_user_reuse' = 'permitted')
);
create index apify_snapshots_lookup_idx on private.apify_cache_snapshots(request_key, collected_at desc);
create index apify_snapshots_retention_idx on private.apify_cache_snapshots(retain_until)
  where retain_until is not null;

create function private.check_apify_snapshot_rights() returns trigger
language plpgsql security definer set search_path = '' as $$
declare account_restricted_at timestamptz;
declare scope text;
begin
  select r.reuse_scope, a.apify_restricted_at into scope, account_restricted_at
    from private.apify_cache_requests r join catalog.social_accounts a on a.id = r.account_id
    where r.request_key = new.request_key;
  if account_restricted_at is not null then
    raise exception 'Apify account is restricted' using errcode = '23514';
  end if;
  if scope = 'global' and not new.reuse_allowed then
    raise exception 'Global Apify snapshot requires explicit reuse permission' using errcode = '23514';
  end if;
  if scope = 'private' and new.reuse_allowed then
    raise exception 'Private Apify snapshot cannot be marked reusable' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger apify_snapshot_rights_check before insert or update of reuse_allowed, request_key
  on private.apify_cache_snapshots for each row execute function private.check_apify_snapshot_rights();

-- Shared evidence may point only to snapshots explicitly approved for reuse.
alter table catalog.source_items
  add column apify_snapshot_id uuid references private.apify_cache_snapshots(id) on delete cascade,
  add column fresh_until timestamptz,
  add column sample_data boolean not null default false;
create index catalog_source_apify_snapshot_idx on catalog.source_items(apify_snapshot_id)
  where apify_snapshot_id is not null;
drop index catalog.catalog_source_dedupe_uq;
create unique index catalog_source_non_apify_uq on catalog.source_items(platform, source_url)
  where apify_snapshot_id is null;
create unique index catalog_source_apify_uq on catalog.source_items(apify_snapshot_id, platform, source_url)
  where apify_snapshot_id is not null;

alter table public.source_items
  add column apify_snapshot_id uuid references private.apify_cache_snapshots(id) on delete cascade,
  add column fresh_until timestamptz,
  add column sample_data boolean not null default false;
create index source_items_apify_snapshot_idx on public.source_items(apify_snapshot_id)
  where apify_snapshot_id is not null;
drop index public.source_items_external_uq;
drop index public.source_items_url_uq;
create unique index source_items_non_apify_external_uq on public.source_items(user_id, platform, external_item_id)
  where apify_snapshot_id is null and external_item_id is not null;
create unique index source_items_non_apify_url_uq on public.source_items(user_id, platform, source_url)
  where apify_snapshot_id is null and external_item_id is null;
create unique index source_items_apify_external_uq on public.source_items(user_id, apify_snapshot_id, platform, external_item_id)
  where apify_snapshot_id is not null and external_item_id is not null;
create unique index source_items_apify_url_uq on public.source_items(user_id, apify_snapshot_id, platform, source_url)
  where apify_snapshot_id is not null and external_item_id is null;

alter table public.briefs
  add column validity_status text not null default 'valid'
    check (validity_status in ('valid', 'unsupported', 'redacted'));

create table catalog.cultural_signals (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references catalog.entities(id),
  normalized_key text not null,
  label text not null,
  kind text not null,
  extraction_version text not null,
  created_at timestamptz not null default now(),
  unique (entity_id, normalized_key, extraction_version)
);

create table catalog.signal_evidence (
  signal_id uuid not null references catalog.cultural_signals(id) on delete cascade,
  source_item_id uuid not null references catalog.source_items(id) on delete cascade,
  mention_kind text not null,
  evidence_excerpt text,
  primary key (signal_id, source_item_id)
);

create table catalog.cultural_profiles (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references catalog.entities(id),
  profile_version integer not null check (profile_version > 0),
  content_fingerprint text not null,
  summary_json jsonb not null default '{}'::jsonb check (jsonb_typeof(summary_json) = 'object'),
  generated_at timestamptz not null default now(),
  fresh_until timestamptz,
  status text not null default 'valid' check (status in ('valid', 'stale', 'redacted')),
  unique (entity_id, profile_version)
);

create table catalog.profile_signals (
  profile_id uuid not null references catalog.cultural_profiles(id) on delete cascade,
  signal_id uuid not null references catalog.cultural_signals(id) on delete cascade,
  primary key (profile_id, signal_id)
);

create table private.apify_purge_log (
  id uuid primary key default gen_random_uuid(),
  request_key text not null,
  snapshot_id uuid not null,
  reason text not null check (reason in ('retention_limit', 'source_restriction', 'deletion_request', 'rights_change')),
  purged_at timestamptz not null default now(),
  affected_catalog_items integer not null,
  affected_private_items integer not null
);

create function private.check_catalog_apify_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare snapshot private.apify_cache_snapshots%rowtype;
declare scope text;
begin
  if new.apify_snapshot_id is null then return new; end if;
  select * into snapshot from private.apify_cache_snapshots where id = new.apify_snapshot_id;
  select reuse_scope into scope from private.apify_cache_requests where request_key = snapshot.request_key;
  if snapshot.id is null or scope is distinct from 'global' or not snapshot.reuse_allowed
      or snapshot.lifecycle_status <> 'active'
      or (snapshot.retain_until is not null and snapshot.retain_until <= now()) then
    raise exception 'Apify source is not eligible for shared catalog use' using errcode = '23514';
  end if;
  new.fresh_until := snapshot.fresh_until;
  new.expires_at := snapshot.retain_until;
  new.sample_data := snapshot.sample_data;
  return new;
end; $$;
create trigger catalog_apify_source_check before insert or update of apify_snapshot_id
  on catalog.source_items for each row execute function private.check_catalog_apify_source();

-- This is the only planned removal path for shared cache snapshots. It is app-only,
-- and it removes or redacts dependent data before dropping the source payload.
create function private.purge_apify_snapshot(p_snapshot_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  snapshot private.apify_cache_snapshots%rowtype;
  affected_catalog_ids uuid[];
  affected_private_ids uuid[];
  affected_public_signals uuid[];
  affected_catalog_signals uuid[];
  affected_snapshot_ids uuid[];
  affected_public_entities uuid[];
  affected_catalog_profiles uuid[];
  catalog_count integer;
  private_count integer;
begin
  if p_reason not in ('retention_limit', 'source_restriction', 'deletion_request', 'rights_change') then
    raise exception 'Unsupported Apify purge reason' using errcode = '22023';
  end if;
  select * into snapshot from private.apify_cache_snapshots where id = p_snapshot_id for update;
  if not found then return false; end if;
  if p_reason = 'retention_limit' and (snapshot.retain_until is null or snapshot.retain_until > now()) then
    raise exception 'Apify snapshot retention is still permitted' using errcode = '22023';
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]), count(*) into affected_catalog_ids, catalog_count
    from catalog.source_items where apify_snapshot_id = p_snapshot_id;
  select coalesce(array_agg(id), '{}'::uuid[]), count(*) into affected_private_ids, private_count
    from public.source_items where apify_snapshot_id = p_snapshot_id;
  select coalesce(array_agg(distinct signal_id), '{}'::uuid[]) into affected_public_signals
    from public.signal_evidence
    where source_item_id = any(affected_private_ids) or catalog_source_item_id = any(affected_catalog_ids);
  select coalesce(array_agg(distinct signal_id), '{}'::uuid[]) into affected_catalog_signals
    from catalog.signal_evidence where source_item_id = any(affected_catalog_ids);
  select coalesce(array_agg(distinct me.snapshot_id), '{}'::uuid[]) into affected_snapshot_ids
    from public.match_evidence me join public.match_evidence_sources ms
      on ms.match_evidence_id = me.id
    where ms.source_item_id = any(affected_private_ids) or ms.catalog_source_item_id = any(affected_catalog_ids);
  select coalesce(array_agg(distinct entity_id), '{}'::uuid[]) into affected_public_entities
    from public.source_items where id = any(affected_private_ids);
  select coalesce(array_agg(distinct ps.profile_id), '{}'::uuid[]) into affected_catalog_profiles
    from catalog.profile_signals ps where ps.signal_id = any(affected_catalog_signals);

  update public.evidence_snapshots set validity_status = 'redacted', source_refs_json = '[]'::jsonb,
    normalized_input_json = '{}'::jsonb where id = any(affected_snapshot_ids);
  delete from public.score_snapshots where evidence_snapshot_id = any(affected_snapshot_ids);
  update public.concepts set status = 'invalidated', title = 'Source evidence removed',
    draft_json = '{}'::jsonb, edited_json = null, source_refs_json = '[]'::jsonb
    where snapshot_id = any(affected_snapshot_ids);
  update public.briefs set validity_status = 'redacted', content_markdown = 'Source evidence was removed under its data-use rules.'
    where evidence_snapshot_id = any(affected_snapshot_ids);
  update public.matches set status = 'unsupported'
    where id in (select match_id from public.evidence_snapshots where id = any(affected_snapshot_ids));
  update public.cultural_profiles set status = 'redacted', observed_summary_json = '{}'::jsonb,
    resolved_signal_ids_json = '[]'::jsonb, coverage_json = '{}'::jsonb
    where entity_id = any(affected_public_entities)
       or id in (select cp.id from public.cultural_profiles cp
          join public.cultural_signals cs on cs.entity_id = cp.entity_id and cs.user_id = cp.user_id
          where cs.id = any(affected_public_signals));
  update catalog.cultural_profiles set status = 'redacted', summary_json = '{}'::jsonb
    where id = any(affected_catalog_profiles);

  delete from public.match_evidence where id in (
    select match_evidence_id from public.match_evidence_sources
    where source_item_id = any(affected_private_ids) or catalog_source_item_id = any(affected_catalog_ids));
  delete from public.signal_evidence
    where source_item_id = any(affected_private_ids) or catalog_source_item_id = any(affected_catalog_ids);
  delete from public.cultural_signals cs where id = any(affected_public_signals)
    and not exists (select 1 from public.signal_evidence se where se.signal_id = cs.id);
  delete from public.source_items where id = any(affected_private_ids);
  delete from catalog.source_items where id = any(affected_catalog_ids);
  delete from catalog.cultural_signals cs where id = any(affected_catalog_signals)
    and not exists (select 1 from catalog.signal_evidence se where se.signal_id = cs.id);
  delete from private.apify_cache_snapshots where id = p_snapshot_id;
  insert into private.apify_purge_log(request_key, snapshot_id, reason, affected_catalog_items, affected_private_items)
    values (snapshot.request_key, p_snapshot_id, p_reason, catalog_count, private_count);
  return true;
end; $$;

create function private.purge_due_apify_snapshots(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; purged integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'Invalid purge batch size' using errcode = '22023'; end if;
  for item in select id, lifecycle_status, retain_until from private.apify_cache_snapshots
    where (retain_until is not null and retain_until <= now())
       or lifecycle_status in ('restricted', 'deletion_requested')
    order by collected_at limit p_limit
  loop
    if private.purge_apify_snapshot(item.id,
        case when item.lifecycle_status = 'deletion_requested' then 'deletion_request'
             when item.lifecycle_status = 'restricted' then 'source_restriction'
             else 'retention_limit' end) then
      purged := purged + 1;
    end if;
  end loop;
  return purged;
end; $$;

alter table private.apify_cache_requests enable row level security;
alter table private.apify_budget_periods enable row level security;
alter table private.apify_refresh_authorizations enable row level security;
alter table private.apify_cache_snapshots enable row level security;
alter table private.apify_purge_log enable row level security;
alter table catalog.cultural_signals enable row level security;
alter table catalog.signal_evidence enable row level security;
alter table catalog.cultural_profiles enable row level security;
alter table catalog.profile_signals enable row level security;
revoke all on all tables in schema private, catalog from public, anon, authenticated;
grant all on all tables in schema private, catalog to service_role;
revoke all on function private.check_catalog_apify_source() from public, anon, authenticated;
revoke all on function private.check_apify_snapshot_rights() from public, anon, authenticated;
revoke all on function private.purge_apify_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function private.purge_due_apify_snapshots(integer) from public, anon, authenticated;
grant execute on function private.purge_apify_snapshot(uuid, text) to service_role;
grant execute on function private.purge_due_apify_snapshots(integer) to service_role;
