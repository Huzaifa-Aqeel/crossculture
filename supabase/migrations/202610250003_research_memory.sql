-- Shared research memory: the app's own decisions about partner stores from
-- earlier runs, used only to order and skip later research. Server-only rows
-- carry no user, no starting brand and no Catalog content (titles,
-- descriptions, collections, prices, availability or images). Categories are
-- public Shopify Standard Product Taxonomy IDs. Rows older than 180 days are
-- purged by the API. No existing data is changed.
create table private.partner_research_outcomes (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null default now(),
  objective text not null check (objective in ('product_bundle', 'cross_sell')),
  market text not null check (market ~ '^[A-Z]{2}$'),
  partner_qloo_id text not null check (char_length(partner_qloo_id) <= 64),
  partner_shop_id text check (partner_shop_id ~ '^gid://shopify/Shop/[0-9]+$'),
  hero_category text check (hero_category ~ '^[a-z]{2}(-[0-9]+){0,8}$'),
  outcome text not null check (outcome in ('identity_unverified', 'no_product_value', 'researched', 'incomplete')),
  identity_reason text check (char_length(identity_reason) <= 60),
  screen_key text check (screen_key ~ '^[0-9a-f]{64}$'),
  screen_adds_value boolean,
  assessed_count integer not null default 0 check (assessed_count >= 0),
  recommendable_count integer not null default 0 check (recommendable_count >= 0),
  supported_count integer not null default 0 check (supported_count >= 0),
  catalog_calls integer not null default 0 check (catalog_calls >= 0),
  memory_version text not null check (char_length(memory_version) <= 40)
);
create index partner_research_outcomes_partner_idx
  on private.partner_research_outcomes (partner_qloo_id, objective, observed_at desc);
create index partner_research_outcomes_screen_idx
  on private.partner_research_outcomes (screen_key, observed_at desc) where screen_key is not null;
create index partner_research_outcomes_observed_idx on private.partner_research_outcomes (observed_at);

create table private.pair_research_outcomes (
  id uuid primary key default gen_random_uuid(),
  partner_outcome_id uuid not null references private.partner_research_outcomes(id) on delete cascade,
  opportunity_key text not null check (opportunity_key ~ '^[0-9a-f]{64}$'),
  partner_category text check (partner_category ~ '^[a-z]{2}(-[0-9]+){0,8}$'),
  status text not null check (status in ('supported', 'needs_verification', 'unsupported')),
  mechanism_state text check (char_length(mechanism_state) <= 40),
  reason_codes text[] not null default '{}' check (cardinality(reason_codes) <= 12),
  model text check (char_length(model) <= 120)
);
create index pair_research_outcomes_partner_idx on private.pair_research_outcomes (partner_outcome_id);
create index pair_research_outcomes_key_idx on private.pair_research_outcomes (opportunity_key);

revoke all on private.partner_research_outcomes, private.pair_research_outcomes from public, anon, authenticated;
grant select, insert, delete on private.partner_research_outcomes, private.pair_research_outcomes to service_role;
