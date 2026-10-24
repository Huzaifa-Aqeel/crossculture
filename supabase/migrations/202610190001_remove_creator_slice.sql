-- The final application supports Brand x Brand commerce only. Shared project,
-- assessment and proposal tables remain; all creator rows and dedicated stores go.
begin;

do $$
declare job_id bigint;
begin
  for job_id in select jobid from cron.job where jobname = 'crossculture-youtube-retention' loop
    perform cron.unschedule(job_id);
  end loop;
end; $$;

delete from public.analysis_runs
  where match_type <> 'brand_brand' or objective not in ('product_bundle','cross_sell');
delete from public.projects where objective not in ('product_bundle','cross_sell');
delete from catalog.source_items where platform = 'youtube';
delete from catalog.source_items where entity_id in
  (select id from catalog.entities where kind = 'youtube_creator');
delete from private.provider_cache where provider <> 'web';

drop table if exists public.source_items;
drop table if exists private.youtube_api_requests;
drop table if exists catalog.social_accounts;

delete from catalog.cultural_intelligence where entity_id in
  (select id from catalog.entities where kind = 'youtube_creator');
delete from catalog.entities where kind = 'youtube_creator';
delete from catalog.entity_identifiers where provider <> 'qloo';

drop function if exists private.purge_due_all_youtube_data() cascade;
drop function if exists private.purge_due_creator_observations(integer) cascade;
drop function if exists private.purge_due_personal_youtube_sources(integer) cascade;
drop function if exists private.purge_due_youtube_sources(integer) cascade;
drop function if exists private.purge_youtube_source(uuid,text) cascade;

alter table catalog.entities drop column if exists youtube_name_until;
alter table catalog.entities drop column if exists parent_organization_qid;
alter table catalog.entities drop constraint entities_kind_check;
alter table catalog.entities add constraint entities_kind_check check (kind = 'brand');
alter table catalog.entity_identifiers drop constraint entity_identifiers_provider_check;
alter table catalog.entity_identifiers add constraint entity_identifiers_provider_check check (provider = 'qloo');

alter table public.projects drop constraint projects_objective_check;
alter table public.projects add constraint projects_objective_check
  check (objective in ('product_bundle','cross_sell'));
alter table public.analysis_runs drop constraint analysis_runs_objective_check;
alter table public.analysis_runs add constraint analysis_runs_objective_check
  check (objective in ('product_bundle','cross_sell'));
alter table public.analysis_runs drop constraint analysis_runs_match_type_check;
alter table public.analysis_runs add constraint analysis_runs_match_type_check
  check (match_type = 'brand_brand');
alter table public.analysis_runs drop constraint analysis_runs_check;
alter table public.analysis_runs add constraint analysis_runs_check check (
  (kind = 'direct_pair' and specified_partner_id is not null) or
  (kind = 'discovery' and specified_partner_id is null));

alter table private.provider_cache drop constraint provider_cache_provider_check;
alter table private.provider_cache add constraint provider_cache_provider_check check (provider = 'web');
alter table private.provider_cache drop constraint provider_cache_check2;

create or replace function private.check_compact_analysis_entities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare seed_kind text; partner_kind text;
begin
  select kind into seed_kind from catalog.entities where id = new.seed_entity_id;
  if seed_kind is distinct from 'brand' then
    raise exception 'Analysis seed must be a brand' using errcode = '23514';
  end if;
  if new.specified_partner_id is not null then
    select kind into partner_kind from catalog.entities where id = new.specified_partner_id;
    if partner_kind is distinct from 'brand' then
      raise exception 'Specified partner must be a brand' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

create or replace function private.check_compact_match_entities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent public.analysis_runs%rowtype; partner_kind text;
begin
  select * into parent from public.analysis_runs where id = new.analysis_run_id and user_id = new.user_id;
  if not found or new.brand_entity_id is distinct from parent.seed_entity_id
    or (parent.kind = 'direct_pair' and new.partner_entity_id is distinct from parent.specified_partner_id) then
    raise exception 'Match must belong to its analysis pair' using errcode = '23514';
  end if;
  select kind into partner_kind from catalog.entities where id = new.partner_entity_id;
  if partner_kind is distinct from 'brand' then
    raise exception 'Match partner must be a brand' using errcode = '23514';
  end if;
  return new;
end; $$;

commit;
