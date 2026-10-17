-- The API sweep is not sufficient if no API worker is running. The database
-- schedules the same existing purge functions well before the product limits.
create extension if not exists pg_cron with schema extensions;

create or replace function private.purge_due_all_youtube_data()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; total integer := 0;
begin
  loop
    select private.purge_due_creator_observations(1000) into n;
    total := total + n;
    exit when n < 1000;
  end loop;
  loop
    select private.purge_due_personal_youtube_sources(1000) into n;
    total := total + n;
    exit when n < 1000;
  end loop;
  loop
    select private.purge_due_youtube_sources(1000) into n;
    total := total + n;
    exit when n < 1000;
  end loop;
  delete from private.provider_cache where provider='youtube' and retain_until<=now();
  get diagnostics n = row_count;
  total := total + n;
  delete from private.youtube_api_requests
    where (retain_until is not null and retain_until<=now())
       or (status<>'succeeded' and reserved_at<=now()-interval '29 days');
  get diagnostics n = row_count;
  total := total + n;
  return total;
end; $$;
revoke all on function private.purge_due_all_youtube_data() from public,anon,authenticated;
grant execute on function private.purge_due_all_youtube_data() to service_role;

select cron.schedule('crossculture-youtube-retention', '*/15 * * * *',
  'select private.purge_due_all_youtube_data();');
