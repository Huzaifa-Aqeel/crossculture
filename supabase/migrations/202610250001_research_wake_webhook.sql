-- An insert is a wake signal only. Postgres remains the source of truth for
-- claiming work, delayed retries, and expired leases.
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create or replace function private.wake_research_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wake_url text;
  wake_secret text;
begin
  if new.status <> 'queued' or new.constraints_json->>'researchMode' <> 'live_commerce' then
    return new;
  end if;

  select decrypted_secret into wake_url from vault.decrypted_secrets
    where name = 'crossculture_research_wake_url';
  select decrypted_secret into wake_secret from vault.decrypted_secrets
    where name = 'crossculture_research_wake_secret';

  -- The migration can be applied before the API has a public HTTPS address.
  if nullif(wake_url, '') is null or nullif(wake_secret, '') is null then
    return new;
  end if;

  perform net.http_post(
    url := wake_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-research-wake-secret', wake_secret),
    body := jsonb_build_object('runId', new.id),
    timeout_milliseconds := 2000
  );
  return new;
exception when others then
  -- A delivery problem must not prevent a user's run from being queued.
  -- The API's recovery scan will claim it.
  return new;
end;
$$;

revoke all on function private.wake_research_worker() from public, anon, authenticated;

create trigger analysis_runs_wake_worker
after insert on public.analysis_runs
for each row execute function private.wake_research_worker();
