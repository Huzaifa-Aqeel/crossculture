-- Qloo response caches belong to one authenticated user. Remove any old shared
-- responses through the existing dependency-aware purge before enforcing this.
do $$
declare item record;
begin
  for item in select id from private.qloo_responses
    where reuse_scope <> 'private' or owner_user_id is null
  loop
    perform private.purge_qloo_response(item.id, 'rights_change');
  end loop;
end $$;

alter table private.qloo_responses
  add constraint qloo_responses_private_owner_only
  check (reuse_scope = 'private' and owner_user_id is not null);

-- A shared cultural profile cannot carry a private user's Qloo response.
create or replace function private.check_shared_intelligence_sources() returns trigger
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
  if cardinality(new.qloo_response_ids) > 0 or exists (
    select 1 from jsonb_array_elements(new.claims_json) claim,
      jsonb_array_elements(coalesce(claim->'source_refs', '[]'::jsonb)) ref
    where ref->>'kind' = 'qloo_response'
  ) then
    raise exception 'Private Qloo responses cannot be used in shared intelligence' using errcode = '23514';
  end if;
  return new;
end; $$;

drop trigger shared_intelligence_sources_check on catalog.cultural_intelligence;
create trigger shared_intelligence_sources_check before insert or update of apify_snapshot_ids,qloo_response_ids,claims_json
  on catalog.cultural_intelligence for each row execute function private.check_shared_intelligence_sources();
