-- One server-only ledger records every attempted official YouTube request and
-- holds a short-lived response projection for request-level reuse.
create table private.youtube_api_requests (
  id bigint generated always as identity primary key,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  resource text not null check (resource in ('search','channels','playlistItems','videos')),
  quota_bucket text not null check (quota_bucket in ('search','shared')),
  status text not null default 'reserved' check (status in ('reserved','succeeded','failed')),
  response_json jsonb,
  reserved_at timestamptz not null default now(),
  fresh_until timestamptz,
  retain_until timestamptz,
  check ((status = 'succeeded' and response_json is not null and fresh_until is not null
    and retain_until is not null and fresh_until <= retain_until
    and retain_until <= reserved_at + interval '29 days') or
    (status <> 'succeeded' and response_json is null and fresh_until is null and retain_until is null))
);
create index youtube_api_quota_idx on private.youtube_api_requests(quota_bucket, reserved_at);
create index youtube_api_cache_idx on private.youtube_api_requests(request_hash, reserved_at desc)
  where status = 'succeeded';
revoke all on private.youtube_api_requests from public, anon, authenticated;
grant select, insert, update, delete on private.youtube_api_requests to service_role;
grant usage, select on sequence private.youtube_api_requests_id_seq to service_role;
