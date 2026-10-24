-- A commerce match is a selected product combination. Creator matches retain
-- their existing one-partner-per-run identity through the null-key index.
alter table public.matches add column opportunity_key text;
alter table public.matches add constraint matches_opportunity_key_format
  check (opportunity_key is null or opportunity_key ~ '^[a-f0-9]{64}$');

alter table public.matches drop constraint matches_analysis_run_id_partner_entity_id_key;
create unique index matches_pair_without_opportunity_idx
  on public.matches(analysis_run_id,partner_entity_id)
  where opportunity_key is null;
create unique index matches_commerce_opportunity_idx
  on public.matches(analysis_run_id,partner_entity_id,opportunity_key)
  where opportunity_key is not null;
