-- Short-lived brand lookup and starting-brand confirmation state, previously
-- held in API process memory. Rows are private to the API (service role) and
-- are purged by the API after their window: lookups after one hour, seed
-- confirmations after thirty minutes. No existing data is changed.
create table private.brand_lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('commerce_seed', 'commerce_partner', 'commerce_site')),
  query text not null check (char_length(query) <= 90),
  result_json jsonb,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index brand_lookups_user_recent_idx on private.brand_lookups (user_id, created_at desc);
create index brand_lookups_created_idx on private.brand_lookups (created_at);

create table private.seed_confirmations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entity_id uuid not null references catalog.entities(id) on delete cascade,
  confirmed_at timestamptz not null default now()
);

revoke all on private.brand_lookups, private.seed_confirmations from public, anon, authenticated;
grant select, insert, update, delete on private.brand_lookups, private.seed_confirmations to service_role;
