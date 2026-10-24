-- Optional target country for new creator research. Existing runs retain their
-- original US-oriented discovery behavior when this field is null.
alter table public.youtube_research_runs
  add column target_country_code text
  check (target_country_code is null or target_country_code ~ '^[A-Z]{2}$');
