#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
postgres_bin=/usr/lib/postgresql/18/bin
cluster_dir="$(mktemp -d /tmp/crossculture-migration.XXXXXX)"

cleanup() {
  rm -rf "$cluster_dir"
}
trap cleanup EXIT

"$postgres_bin/initdb" -D "$cluster_dir" -A trust --no-instructions >/dev/null
run_sql() {
  local output
  python3 "$repo_dir/scripts/sql-single-user.py" "$1" > "$cluster_dir/commands.sql"
  output="$("$postgres_bin/postgres" --single -D "$cluster_dir" postgres < "$cluster_dir/commands.sql" 2>&1)"
  if [[ "$output" == *'ERROR:'* || "$output" == *'FATAL:'* ]]; then
    printf '%s\n' "$output" >&2
    return 1
  fi
}

cat > "$cluster_dir/bootstrap.sql" <<'SQL'
create role anon;
create role authenticated;
create role service_role;
create schema auth;
grant usage on schema auth to authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to authenticated;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
SQL
run_sql "$cluster_dir/bootstrap.sql"

run_sql "$repo_dir/supabase/migrations/202610120001_foundation.sql"
run_sql "$repo_dir/supabase/migrations/202610120002_evidence.sql"
run_sql "$repo_dir/supabase/migrations/202610120003_apify_global_cache.sql"
run_sql "$repo_dir/supabase/migrations/202610120004_compact_product_schema.sql"
run_sql "$repo_dir/supabase/migrations/202610120005_personal_projects.sql"
run_sql "$repo_dir/supabase/migrations/202610120006_qloo_sample_marker.sql"
run_sql "$repo_dir/supabase/migrations/202610120007_qloo_sample_fail_closed.sql"
run_sql "$repo_dir/supabase/migrations/202610120008_youtube_source_retention.sql"
run_sql "$repo_dir/supabase/migrations/202610120009_youtube_request_ledger.sql"
run_sql "$repo_dir/supabase/migrations/202610120010_personal_youtube_evidence.sql"
run_sql "$repo_dir/supabase/migrations/202610120011_qloo_private_cache_only.sql"
run_sql "$repo_dir/supabase/migrations/202610120012_fr16_provider_correction.sql"

cat > "$cluster_dir/constraints.sql" <<'SQL'
insert into catalog.entities(id, kind, canonical_name) values
  ('20000000-0000-4000-8000-000000000001', 'brand', 'Test brand'),
  ('20000000-0000-4000-8000-000000000002', 'youtube_creator', 'Test creator');
insert into public.analysis_runs(id, user_id, kind, match_type, seed_entity_id, objective, idempotency_key)
values ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
        'discovery', 'brand_youtube_creator', '20000000-0000-4000-8000-000000000001', 'awareness', 'fixture-a');
do $$ begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'analysis_runs') <> 1 then
    raise exception 'Expected one own-row read policy';
  end if;
  if (select count(*) from pg_tables where schemaname in ('public','catalog','private','demo')) <> 16 then
    raise exception 'Expected 16 app tables';
  end if;
end $$;
SQL
run_sql "$cluster_dir/constraints.sql"

cat > "$cluster_dir/cross-user.sql" <<'SQL'
insert into public.matches(user_id, analysis_run_id, brand_entity_id, partner_entity_id) values
  ('00000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');
SQL
if cross_user_output="$(run_sql "$cluster_dir/cross-user.sql" 2>&1)"; then
  echo 'Cross-user foreign key unexpectedly accepted' >&2
  exit 1
fi
if [[ "$cross_user_output" != *'Match must belong to its analysis pair'* && "$cross_user_output" != *'violates foreign key constraint'* ]]; then
  printf '%s\n' "$cross_user_output" >&2
  exit 1
fi

cat > "$cluster_dir/invalid-pair.sql" <<'SQL'
insert into public.analysis_runs(user_id, kind, match_type, seed_entity_id, specified_partner_id, objective, idempotency_key)
values ('00000000-0000-4000-8000-000000000001', 'direct_pair', 'brand_brand',
        '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'awareness', 'fixture-invalid');
SQL
if invalid_pair_output="$(run_sql "$cluster_dir/invalid-pair.sql" 2>&1)"; then
  echo 'Mismatched direct-pair entity kind unexpectedly accepted' >&2
  exit 1
fi
if [[ "$invalid_pair_output" != *'Specified partner type does not match analysis mode'* ]]; then
  printf '%s\n' "$invalid_pair_output" >&2
  exit 1
fi

echo 'FR v1.6 16-table schema applied; own-row policy, cross-user FK and pair-kind checks passed.'
