-- Creator discovery summaries can contain search-hit and channel metadata.
-- Redact them alongside the existing source/snapshot cleanup, including runs
-- with no assessed match. No user-authored proposal text is changed.
create or replace function private.purge_due_all_youtube_data()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; total integer := 0;
begin
  update public.analysis_runs r
    set result_json=jsonb_build_object('sample',false,
      'message','Saved YouTube research evidence expired. Review or rerun this analysis.'),
      updated_at=now()
    where r.match_type='brand_youtube_creator'
      and r.constraints_json->>'researchMode'='live_youtube'
      and (r.result_json ? 'candidates' or r.result_json ? 'research' or r.result_json ? 'directions')
      and (r.created_at <= now()-interval '29 days'
        or exists (select 1 from public.source_items s where s.analysis_run_id=r.id
          and (s.retain_until<=now() or s.transcript_expires_at<=now()))
        or exists (select 1 from public.matches m
          join public.assessment_snapshots a on a.match_id=m.id
          where m.analysis_run_id=r.id and a.validity_status='redacted'));
  get diagnostics n = row_count;
  total := total + n;
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
