-- Optional, owner-private demographic research for an explicitly selected pair.
-- This only widens the Qloo operation check; existing rows are preserved.
alter table private.qloo_responses
  drop constraint qloo_responses_operation_check;
alter table private.qloo_responses
  add constraint qloo_responses_operation_check
  check (operation in ('qloo_describe','qloo_find_tags','qloo_recommend','qloo_rank',
    'qloo_entity_tags','qloo_audience_demographics'));
