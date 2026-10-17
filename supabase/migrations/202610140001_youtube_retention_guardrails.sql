-- Keep the general provider cache limited to metadata/web projections. The
-- optional transcript adapter has no persistent cache or observations yet.
delete from private.provider_cache where provider = 'youtube_transcript';
alter table private.provider_cache drop constraint provider_cache_provider_check;
alter table private.provider_cache add constraint provider_cache_provider_check
  check (provider in ('youtube','web'));

-- Leave a full day for the scheduled purge before YouTube source retention
-- could reach the 30-day product maximum.
update catalog.source_items set expires_at = collected_at + interval '29 days'
  where platform = 'youtube' and expires_at > collected_at + interval '29 days';
alter table catalog.source_items drop constraint youtube_source_retention_check;
alter table catalog.source_items add constraint youtube_source_retention_check check (
  platform <> 'youtube' or
  (expires_at is not null and expires_at > collected_at and
   expires_at <= collected_at + interval '29 days' and
   rights_json->>'storage' = 'permitted' and
   rights_json->>'cross_user_reuse' = 'permitted' and
   provider_operation in ('channels.list','playlistItems.list','videos.list','search.list') and
   request_hash ~ '^[a-f0-9]{64}$'));

-- Source evidence expires; user-authored proposal text survives with a review
-- marker. Generated concept material is invalidated without erasing edits.
create or replace function private.purge_due_personal_youtube_sources(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; impacted uuid[]; removed integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'Invalid purge limit' using errcode = '22023'; end if;
  for item in select id from public.source_items where retain_until <= now()
    order by retain_until for update skip locked limit p_limit loop
    select coalesce(array_agg(id),'{}'::uuid[]) into impacted
      from public.assessment_snapshots
      where source_refs_json @> jsonb_build_array(jsonb_build_object('kind','personal_item','id',item.id));
    update public.assessment_snapshots set validity_status='redacted',evidence_json='{}'::jsonb,
      score_json='{}'::jsonb,source_refs_json='[]'::jsonb where id = any(impacted);
    update public.concepts set status='invalidated',title='Source-dependent concept removed',
      format=null,draft_json='{}'::jsonb where base_assessment_id = any(impacted);
    update public.briefs set validity_status='redacted' where assessment_id = any(impacted);
    delete from public.source_items where id=item.id;
    removed := removed + 1;
  end loop;
  update catalog.entities e set canonical_name='YouTube channel ' || right(e.canonical_url,24),
    description=null,country=null,youtube_name_until=null,updated_at=now()
    where e.kind='youtube_creator' and e.youtube_name_until <= now();
  return removed;
end; $$;
