-- Official YouTube API metadata may enter the shared catalog only after a
-- source-specific reuse decision. The non-authorized data deadline is capped.
alter table catalog.source_items
  add column provider_operation text,
  add column request_hash text,
  add column source_etag text;

alter table catalog.source_items add constraint youtube_source_retention_check check (
  platform <> 'youtube' or apify_snapshot_id is not null or
  (expires_at is not null and expires_at > collected_at and
   expires_at <= collected_at + interval '30 days' and
   rights_json->>'storage' = 'permitted' and
   rights_json->>'cross_user_reuse' = 'permitted' and
   provider_operation in ('channels.list','playlistItems.list','videos.list','search.list') and
   request_hash ~ '^[a-f0-9]{64}$')
);
create index youtube_source_deadline_idx on catalog.source_items(expires_at)
  where platform = 'youtube' and apify_snapshot_id is null;

create function private.purge_youtube_source(p_source_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare item catalog.source_items%rowtype;
declare impacted uuid[];
begin
  if p_reason not in ('retention_limit','source_restriction','deletion_request','rights_change') then
    raise exception 'Unsupported YouTube purge reason' using errcode = '22023';
  end if;
  select * into item from catalog.source_items where id = p_source_id and platform = 'youtube'
    and apify_snapshot_id is null for update;
  if not found then return false; end if;
  if p_reason = 'retention_limit' and item.expires_at > now() then
    raise exception 'YouTube source retention has not expired' using errcode = '22023';
  end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into impacted
    from public.assessment_snapshots
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
  update public.concepts set status = 'invalidated', draft_json = '{}'::jsonb, edited_json = null
    where base_assessment_id = any(impacted);
  update public.briefs set validity_status = 'redacted',
    content_markdown = 'Source evidence was removed under its data-use rules.'
    where assessment_id = any(impacted);
  delete from catalog.source_items where id = p_source_id;
  return true;
end; $$;

create function private.purge_due_youtube_sources(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; purged integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'Invalid purge limit' using errcode = '22023'; end if;
  for item in select id from catalog.source_items where platform = 'youtube'
    and apify_snapshot_id is null and expires_at <= now()
    order by expires_at for update skip locked limit p_limit loop
    if private.purge_youtube_source(item.id,'retention_limit') then purged := purged + 1; end if;
  end loop;
  return purged;
end; $$;

revoke all on function private.purge_youtube_source(uuid,text) from public, anon, authenticated;
revoke all on function private.purge_due_youtube_sources(integer) from public, anon, authenticated;
grant execute on function private.purge_youtube_source(uuid,text) to service_role;
grant execute on function private.purge_due_youtube_sources(integer) to service_role;
