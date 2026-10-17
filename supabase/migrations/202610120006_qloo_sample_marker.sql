-- Synthetic cache fixtures must never qualify as evidence for a real run.
alter table private.qloo_responses add column sample_data boolean not null default false;
