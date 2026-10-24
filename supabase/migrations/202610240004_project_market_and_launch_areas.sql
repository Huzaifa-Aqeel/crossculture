-- A project remembers the starting brand's country, which sets the selling
-- market and currency defaults. Existing projects keep the previous US default.
alter table public.projects
  add column if not exists market text not null default 'US'
  check (market ~ '^[A-Z]{2}$');

-- Owner-private "where to launch" research caches Qloo where-popular results.
-- This only widens the operation check; existing rows are preserved.
alter table private.qloo_responses
  drop constraint qloo_responses_operation_check;
alter table private.qloo_responses
  add constraint qloo_responses_operation_check
  check (operation in ('qloo_describe','qloo_find_tags','qloo_recommend','qloo_rank',
    'qloo_entity_tags','qloo_audience_demographics','qloo_where_popular'));
