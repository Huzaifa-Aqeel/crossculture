-- The verified qloo_entity_tags operation joins the private per-user Qloo cache.
-- Response shape verified against the live MCP harness 2026-10-13 (Patagonia, US).
alter table private.qloo_responses
  drop constraint qloo_responses_operation_check;
alter table private.qloo_responses
  add constraint qloo_responses_operation_check
  check (operation in ('qloo_describe','qloo_find_tags','qloo_recommend','qloo_rank','qloo_entity_tags'));
