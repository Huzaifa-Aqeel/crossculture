-- Research memory keeps the Shopify product ID of a partner product that
-- formed a Supported pair, so later research for a similar starting product
-- re-checks it first (live) instead of rediscovering it. An identifier only:
-- no title, description, price or other Catalog content. Existing rows keep
-- an empty value.
alter table private.pair_research_outcomes
  add column partner_product_id text check (partner_product_id ~ '^gid://shopify/Product/[0-9]+$');
create index pair_research_outcomes_product_idx on private.pair_research_outcomes (partner_outcome_id)
  where partner_product_id is not null;
