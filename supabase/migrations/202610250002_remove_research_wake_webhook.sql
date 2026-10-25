-- The API Lambda invokes the worker Lambda after committing the queued run.
-- Scheduled recovery handles missed invokes and delayed retries.
drop trigger if exists analysis_runs_wake_worker on public.analysis_runs;
drop function if exists private.wake_research_worker();
