-- A signed-in project contains only the user's choices and notes. Provider
-- output enters durable research tables only after its storage rights are known.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seed_entity_id uuid not null references catalog.entities(id),
  name text not null check (length(trim(name)) between 1 and 120),
  objective text not null check (objective in ('awareness','new_audience','repositioning',
    'co_created_product','content_collaboration','sponsorship')),
  notes text not null default '' check (length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id)
);
create index projects_user_date_idx on public.projects(user_id,updated_at desc);
alter table public.analysis_runs add column project_id uuid;
alter table public.analysis_runs add constraint analysis_run_project_owner_fk
  foreign key (project_id,user_id) references public.projects(id,user_id);
alter table public.projects enable row level security;
revoke all on public.projects from anon,authenticated;
grant select on public.projects to authenticated;
create policy projects_select_own on public.projects for select to authenticated
  using ((select auth.uid()) = user_id);
