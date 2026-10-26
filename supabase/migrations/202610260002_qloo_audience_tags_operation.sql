-- A brand's lifestyle and audience tags (type-filtered tag insights) join the
-- private per-user Qloo cache. This only widens the operation check; existing
-- rows are preserved.
alter table private.qloo_responses
  drop constraint qloo_responses_operation_check;
alter table private.qloo_responses
  add constraint qloo_responses_operation_check
  check (operation in ('qloo_describe','qloo_find_tags','qloo_recommend','qloo_rank',
    'qloo_entity_tags','qloo_audience_demographics','qloo_where_popular','qloo_audience_tags'));
