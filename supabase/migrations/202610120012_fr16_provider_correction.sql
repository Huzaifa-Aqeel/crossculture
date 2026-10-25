-- FR v1.6: retire Apify/Instagram collection while preserving independent
-- research, the YouTube quota ledger, and private user source observations.
-- Refuse to discard an Apify-backed research record if one appears elsewhere.
do $$ begin
  if exists (select 1 from private.apify_cache_requests) or
     exists (select 1 from private.apify_cache_snapshots) or
     exists (select 1 from private.apify_budget_periods) or
     exists (select 1 from private.apify_refresh_authorizations) or
     exists (select 1 from catalog.source_items where apify_snapshot_id is not null) or
     exists (select 1 from catalog.cultural_intelligence where cardinality(apify_snapshot_ids) > 0) or
     exists (select 1 from public.assessment_snapshots where cardinality(apify_snapshot_ids) > 0) or
     exists (select 1 from catalog.social_accounts where platform = 'instagram') or
     exists (select 1 from catalog.source_items where platform = 'instagram') or
     exists (select 1 from catalog.entity_identifiers where provider = 'instagram') then
    raise exception 'Archive or migrate populated discontinued-provider records before applying FR v1.6';
  end if;
end $$;

-- A restricted payload cache is distinct from the durable request/quota ledger.
create table private.provider_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('youtube','web','youtube_transcript')),
  resource_type text not null,
  resource_key text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  scope text not null check (scope in ('shared','user_private')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  payload_json jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  fetched_at timestamptz not null,
  fresh_until timestamptz not null,
  retain_until timestamptz not null,
  last_status text not null default 'succeeded' check (last_status in ('succeeded','not_found')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'shared' and owner_user_id is null) or
         (scope = 'user_private' and owner_user_id is not null)),
  check (fresh_until >= fetched_at and retain_until > fetched_at and fresh_until <= retain_until),
  check (provider <> 'youtube' or retain_until <= fetched_at + interval '29 days')
);
create unique index provider_cache_shared_key_uq on private.provider_cache
  (provider,resource_type,resource_key,request_hash) where scope = 'shared';
create unique index provider_cache_private_key_uq on private.provider_cache
  (owner_user_id,provider,resource_type,resource_key,request_hash) where scope = 'user_private';
create index provider_cache_retention_idx on private.provider_cache(retain_until);
alter table private.provider_cache enable row level security;
revoke all on private.provider_cache from public, anon, authenticated;
grant select,insert,update,delete on private.provider_cache to service_role;

-- Preserve valid previous YouTube projections before removing the duplicate
-- response payload column from the quota ledger.
insert into private.provider_cache(provider,resource_type,resource_key,request_hash,scope,
  payload_json,payload_hash,fetched_at,fresh_until,retain_until)
select 'youtube',resource,request_hash,request_hash,'shared',response_json,
  encode(sha256(convert_to(response_json::text,'UTF8')),'hex'),reserved_at,fresh_until,retain_until
from private.youtube_api_requests
where status = 'succeeded' and response_json is not null and retain_until > now()
on conflict (provider,resource_type,resource_key,request_hash) where scope = 'shared'
do update set payload_json = excluded.payload_json, payload_hash = excluded.payload_hash,
  fetched_at = excluded.fetched_at, fresh_until = excluded.fresh_until,
  retain_until = excluded.retain_until, updated_at = now();
alter table private.youtube_api_requests drop constraint youtube_api_requests_check;
alter table private.youtube_api_requests drop column response_json;
alter table private.youtube_api_requests add constraint youtube_api_requests_lifecycle_check check (
  (status = 'succeeded' and fresh_until is not null and retain_until is not null
   and fresh_until <= retain_until and retain_until <= reserved_at + interval '29 days') or
  (status <> 'succeeded' and fresh_until is null and retain_until is null));

drop trigger shared_intelligence_sources_check on catalog.cultural_intelligence;
drop trigger catalog_apify_source_check on catalog.source_items;
drop trigger apify_snapshot_rights_check on private.apify_cache_snapshots;
drop function private.check_catalog_apify_source();
drop function private.check_shared_intelligence_sources();
drop function private.check_apify_snapshot_rights();
drop function private.purge_due_apify_snapshots(integer);
drop function private.purge_apify_snapshot(uuid,text);

-- Private Qloo material must never be published in shared intelligence.
create function private.check_shared_intelligence_sources() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.qloo_response_ids) > 0 or exists (
    select 1 from jsonb_array_elements(new.claims_json) claim,
      jsonb_array_elements(coalesce(claim->'source_refs','[]'::jsonb)) ref
    where ref->>'kind' = 'qloo_response'
  ) then
    raise exception 'Private Qloo responses cannot be used in shared intelligence' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger shared_intelligence_sources_check before insert or update of qloo_response_ids,claims_json
  on catalog.cultural_intelligence for each row execute function private.check_shared_intelligence_sources();

alter table catalog.source_items drop constraint youtube_source_retention_check;
alter table catalog.source_items drop column apify_snapshot_id;
alter table catalog.source_items add constraint youtube_source_retention_check check (
  platform <> 'youtube' or
  (expires_at is not null and expires_at > collected_at and
   expires_at <= collected_at + interval '30 days' and
   rights_json->>'storage' = 'permitted' and
   rights_json->>'cross_user_reuse' = 'permitted' and
   provider_operation in ('channels.list','playlistItems.list','videos.list','search.list') and
   request_hash ~ '^[a-f0-9]{64}$'));
create unique index catalog_source_platform_url_uq on catalog.source_items(platform,source_url);
alter table catalog.cultural_intelligence drop column apify_snapshot_ids;
alter table public.assessment_snapshots drop column apify_snapshot_ids;
alter table catalog.social_accounts drop column apify_restricted_at, drop column apify_restriction_reason;
alter table catalog.social_accounts drop constraint social_accounts_platform_check;
alter table catalog.social_accounts add constraint social_accounts_youtube_only check (platform = 'youtube');
alter table catalog.entity_identifiers drop constraint entity_identifiers_provider_check;
alter table catalog.entity_identifiers add constraint entity_identifiers_provider_check
  check (provider in ('qloo','wikidata','youtube'));
alter table catalog.source_items add constraint catalog_source_no_instagram_ingestion
  check (platform <> 'instagram');

alter table private.apify_cache_requests drop constraint apify_claim_authorization_fk;
drop table private.apify_refresh_authorizations;
drop table private.apify_cache_snapshots;
drop table private.apify_cache_requests;
drop table private.apify_budget_periods;
drop table private.apify_purge_log;

-- The source purge used to depend on a discontinued-provider column. Preserve
-- user-authored proposal text while marking affected source-derived work stale.
create or replace function private.purge_youtube_source(p_source_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare item catalog.source_items%rowtype; impacted uuid[];
begin
  if p_reason not in ('retention_limit','source_restriction','deletion_request','rights_change') then
    raise exception 'Unsupported YouTube purge reason' using errcode = '22023';
  end if;
  select * into item from catalog.source_items where id = p_source_id and platform = 'youtube' for update;
  if not found then return false; end if;
  if p_reason = 'retention_limit' and item.expires_at > now() then
    raise exception 'YouTube source retention has not expired' using errcode = '22023';
  end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into impacted from public.assessment_snapshots
    where source_refs_json @> jsonb_build_array(jsonb_build_object('kind','catalog_item','id',p_source_id));
  update catalog.cultural_intelligence ci set
    claims_json = coalesce((select jsonb_agg(claim) from jsonb_array_elements(ci.claims_json) claim
      where not exists (select 1 from jsonb_array_elements(coalesce(claim->'source_refs','[]'::jsonb)) ref
        where ref->>'kind' = 'catalog_item' and ref->>'id' = p_source_id::text)), '[]'::jsonb),
    summary_json = '{}'::jsonb, status = 'stale'
    where exists (select 1 from jsonb_array_elements(ci.claims_json) claim,
      jsonb_array_elements(coalesce(claim->'source_refs','[]'::jsonb)) ref
      where ref->>'kind' = 'catalog_item' and ref->>'id' = p_source_id::text);
  update public.assessment_snapshots set validity_status = 'redacted',
    evidence_json = '{}'::jsonb, score_json = '{}'::jsonb, source_refs_json = '[]'::jsonb
    where id = any(impacted);
  update public.concepts set status = 'invalidated' where base_assessment_id = any(impacted);
  update public.briefs set validity_status = 'redacted' where assessment_id = any(impacted);
  delete from catalog.source_items where id = p_source_id;
  return true;
end; $$;
create or replace function private.purge_due_youtube_sources(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; purged integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'Invalid purge limit' using errcode = '22023'; end if;
  for item in select id from catalog.source_items where platform = 'youtube' and expires_at <= now()
    order by expires_at for update skip locked limit p_limit loop
    if private.purge_youtube_source(item.id,'retention_limit') then purged := purged + 1; end if;
  end loop;
  return purged;
end; $$;
