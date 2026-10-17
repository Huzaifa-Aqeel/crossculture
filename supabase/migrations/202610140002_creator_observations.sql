-- Structured creator findings live on the existing private video source record.
-- No raw caption text or transcript segment is stored.
alter table public.source_items
  add column metadata_observations_json jsonb not null default '{}'::jsonb,
  add column transcript_observations_json jsonb not null default '[]'::jsonb,
  add column transcript_observed_at timestamptz,
  add column transcript_expires_at timestamptz;
alter table public.source_items add constraint creator_transcript_observation_retention check (
  (transcript_observed_at is null and transcript_expires_at is null and transcript_observations_json = '[]'::jsonb)
  or (transcript_observed_at is not null and transcript_expires_at is not null and
      transcript_expires_at > transcript_observed_at and
      transcript_expires_at <= transcript_observed_at + interval '15 days' and
      jsonb_typeof(transcript_observations_json) = 'array')
);
create index creator_transcript_observation_deadline_idx on public.source_items(transcript_expires_at)
  where transcript_expires_at is not null;

-- Expired transcript observations cannot remain inside copied assessment evidence.
create or replace function private.purge_due_creator_observations(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; impacted uuid[]; removed integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'Invalid purge limit' using errcode = '22023'; end if;
  for item in select id from public.source_items where transcript_expires_at <= now()
    order by transcript_expires_at for update skip locked limit p_limit loop
    select coalesce(array_agg(id),'{}'::uuid[]) into impacted
      from public.assessment_snapshots
      where source_refs_json @> jsonb_build_array(jsonb_build_object('kind','personal_item','id',item.id));
    update public.assessment_snapshots set validity_status='redacted', evidence_json='{}'::jsonb,
      score_json='{}'::jsonb, source_refs_json='[]'::jsonb where id = any(impacted);
    update public.concepts set status='invalidated', title='Source-dependent concept removed',
      format=null, draft_json='{}'::jsonb, edited_json=null
      where base_assessment_id = any(impacted);
    update public.briefs set validity_status='redacted',
      content_markdown=case when revision > 1 then content_markdown
        else 'Source evidence expired under its data-use rules.' end
      where assessment_id = any(impacted);
    update public.source_items set transcript_observations_json='[]'::jsonb,
      transcript_observed_at=null, transcript_expires_at=null where id=item.id;
    removed := removed + 1;
  end loop;
  return removed;
end; $$;
revoke all on function private.purge_due_creator_observations(integer) from public,anon,authenticated;
grant execute on function private.purge_due_creator_observations(integer) to service_role;

