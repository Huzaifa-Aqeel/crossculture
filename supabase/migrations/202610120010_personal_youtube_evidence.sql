-- Personal YouTube observations are private. The global request cache is
-- server-only and is not itself a customer assessment source.
alter table catalog.entities add column youtube_name_until timestamptz;
alter table public.analysis_runs drop constraint analysis_runs_check;
alter table public.analysis_runs add constraint analysis_runs_check check (
  (kind = 'discovery' and specified_partner_id is null) or
  (kind = 'direct_pair' and (specified_partner_id is not null or
    (constraints_json->>'researchMode' = 'live_youtube' and status in ('queued','running','partial','failed'))))
);

create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_run_id uuid not null,
  entity_id uuid not null references catalog.entities(id),
  platform text not null default 'youtube' check (platform = 'youtube'),
  source_type text not null default 'video_metadata' check (source_type = 'video_metadata'),
  external_item_id text not null check (external_item_id ~ '^[A-Za-z0-9_-]{11}$'),
  owner_channel_id text not null check (owner_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  source_url text not null,
  title text not null,
  published_at timestamptz,
  collected_at timestamptz not null,
  fresh_until timestamptz not null,
  retain_until timestamptz not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  rights_json jsonb not null default '{"storage":"permitted","scope":"private"}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id,user_id),
  unique (analysis_run_id,external_item_id),
  foreign key (analysis_run_id,user_id) references public.analysis_runs(id,user_id) on delete cascade,
  check (source_url = 'https://www.youtube.com/watch?v=' || external_item_id),
  check (rights_json->>'storage' = 'permitted' and rights_json->>'scope' = 'private'),
  check (fresh_until > collected_at and fresh_until <= retain_until),
  check (retain_until > collected_at and retain_until <= collected_at + interval '29 days')
);
create index personal_youtube_source_retention_idx on public.source_items(retain_until);
alter table public.source_items enable row level security;
create policy personal_youtube_source_read on public.source_items for select to authenticated
  using (user_id = auth.uid());
grant select on public.source_items to authenticated;
grant all on public.source_items to service_role;

create function private.purge_due_personal_youtube_sources(p_limit integer default 100)
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
      format=null,draft_json='{}'::jsonb,edited_json=null
      where base_assessment_id = any(impacted);
    update public.briefs set validity_status='redacted',
      content_markdown='Source evidence expired under its data-use rules.'
      where assessment_id = any(impacted);
    delete from public.source_items where id=item.id;
    removed := removed + 1;
  end loop;
  update catalog.entities e set canonical_name='YouTube channel ' || right(e.canonical_url,24),
    description=null,country=null,youtube_name_until=null,updated_at=now()
    where e.kind='youtube_creator' and e.youtube_name_until <= now();
  return removed;
end; $$;
revoke all on function private.purge_due_personal_youtube_sources(integer) from public,anon,authenticated;
grant execute on function private.purge_due_personal_youtube_sources(integer) to service_role;
