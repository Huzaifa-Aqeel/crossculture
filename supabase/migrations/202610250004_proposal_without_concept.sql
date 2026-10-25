-- Proposals are written straight from a verified opportunity; the separate
-- concept step is removed from the app. A proposal no longer needs a concept.
-- Existing proposals keep their concept reference; no data is changed.
alter table public.briefs alter column concept_id drop not null;
