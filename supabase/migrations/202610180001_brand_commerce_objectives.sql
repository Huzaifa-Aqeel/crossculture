-- Widen accepted identifiers only. Existing rows and scoring versions are untouched.
begin;

alter table public.projects drop constraint projects_objective_check;
alter table public.projects add constraint projects_objective_check
  check (objective in ('awareness','new_audience','repositioning','co_created_product',
    'content_collaboration','sponsorship','product_bundle','cross_sell'));

alter table public.analysis_runs drop constraint analysis_runs_objective_check;
alter table public.analysis_runs add constraint analysis_runs_objective_check
  check (objective in ('awareness','new_audience','repositioning','co_created_product',
    'content_collaboration','sponsorship','product_bundle','cross_sell'));

commit;
