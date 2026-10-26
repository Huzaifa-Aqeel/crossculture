-- Opportunity feedback reasons and the developer review queue (adaptive
-- learning loops 2 and 3). No existing data is changed.

-- "Not a fit" may carry one structured reason; "Save" (good fit) carries none.
alter table public.feedback add column reason_code text check (reason_code in
  ('products_dont_fit', 'not_right_for_brand', 'already_working', 'partner_not_credible', 'other'));

-- Pairs the research judged and did not recommend, sampled for review. Only
-- Shopify product, variant and shop identifiers are kept; product details are
-- looked up live when reviewed. Rows older than 90 days are purged by the API.
create table private.review_samples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  objective text not null check (objective in ('product_bundle', 'cross_sell')),
  market text not null check (market ~ '^[A-Z]{2}$'),
  opportunity_key text not null check (opportunity_key ~ '^[0-9a-f]{64}$'),
  references_json jsonb not null check (jsonb_typeof(references_json) = 'object'),
  status text not null check (status in ('supported', 'needs_verification', 'unsupported')),
  mechanism_state text check (char_length(mechanism_state) <= 40),
  reason_codes text[] not null default '{}' check (cardinality(reason_codes) <= 12),
  judge text check (char_length(judge) <= 120),
  unique (analysis_run_id, opportunity_key)
);
create index review_samples_created_idx on private.review_samples (created_at desc);

-- The reviewer's good/bad call on one exact pair. The latest call per pair and
-- objective is kept. Only human labels are stored; model verdicts never are.
create table private.review_labels (
  id uuid primary key default gen_random_uuid(),
  opportunity_key text not null check (opportunity_key ~ '^[0-9a-f]{64}$'),
  objective text not null check (objective in ('product_bundle', 'cross_sell')),
  source text not null check (source in ('user_flag', 'verdict_flip', 'supported_sample', 'rejected_sample')),
  label text not null check (label in ('good', 'bad')),
  note text check (char_length(note) <= 500),
  app_status text check (app_status in ('supported', 'needs_verification', 'unsupported')),
  references_json jsonb not null check (jsonb_typeof(references_json) = 'object'),
  match_id uuid references public.matches(id) on delete set null,
  review_sample_id uuid references private.review_samples(id) on delete set null,
  reviewer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_key, objective)
);

alter table private.review_samples enable row level security;
alter table private.review_labels enable row level security;
revoke all on private.review_samples, private.review_labels from public, anon, authenticated;
grant select, insert, update, delete on private.review_samples, private.review_labels to service_role;
