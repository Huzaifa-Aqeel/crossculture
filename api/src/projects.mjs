import pg from "pg";
import { projectObjectives } from "./new-run-objectives.mjs";
import { MARKETS } from "./geo-places.mjs";

let pool;
function database() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  }
  return pool;
}

const projectId = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const projection = `p.id,p.name,p.objective,p.notes,p.market,p.created_at as "createdAt",p.updated_at as "updatedAt",
  e.id as "seedEntityId",e.canonical_name as "seedName",
  exists (select 1 from catalog.entity_identifiers i where i.entity_id=e.id
    and i.provider='qloo' and i.status='confirmed') as "seedNative"`;

// Each project shows where it stands: a draft has no research yet; otherwise
// its latest research run's state and how many partners it recommended.
export async function listProjects(userId) {
  const result = await database().query(`select ${projection},
      r.status as "latestRunStatus",
      coalesce((select count(distinct d->>'partnerName')::integer
        from jsonb_array_elements(coalesce(r.result_json->'decisions','[]'::jsonb)) d
        where d->>'status'='supported'), 0) as "recommendedPartners"
    from public.projects p
    join catalog.entities e on e.id = p.seed_entity_id
    left join lateral (select status,result_json from public.analysis_runs
      where project_id=p.id and user_id=p.user_id order by created_at desc limit 1) r on true
    where p.user_id = $1 and p.objective in ('product_bundle','cross_sell')
    order by p.updated_at desc limit 100`, [userId]);
  return result.rows;
}


export async function getProject(userId, id) {
  if (!projectId(id)) return null;
  const result = await database().query(`select ${projection} from public.projects p
    join catalog.entities e on e.id = p.seed_entity_id where p.user_id = $1 and p.id = $2
      and p.objective in ('product_bundle','cross_sell')`, [userId, id]);
  return result.rows[0] ?? null;
}

// A brand this user already confirmed for a project in this country (matched by
// name) starts new research directly; the run still checks its store.
export async function knownStartingBrand(userId, name, market) {
  const result = await database().query(`select e.id,e.canonical_name as name,
      coalesce(e.official_website,e.canonical_url) as website
    from public.projects p join catalog.entities e on e.id=p.seed_entity_id
    where p.user_id=$1 and p.market=$2 and lower(e.canonical_name)=lower($3)
      and exists (select 1 from catalog.entity_identifiers i where i.entity_id=e.id
        and i.provider='qloo' and i.status='confirmed')
    order by p.updated_at desc limit 1`, [userId, market, String(name ?? "").trim()]);
  return result.rows[0] ?? null;
}

export async function ownsStartingBrand(userId, entityId) {
  if (!projectId(entityId)) return false;
  const result = await database().query(`select 1 from public.projects
    where user_id=$1 and seed_entity_id=$2 limit 1`, [userId, entityId]);
  return result.rows.length > 0;
}

export async function createProject(userId, input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 120 || !projectObjectives.has(input.objective) || !projectId(input.seedEntityId)) {
    throw Object.assign(new Error("Enter a project name, starting brand, and goal."), { statusCode: 400 });
  }
  const market = String(input.market ?? "US").toUpperCase();
  if (!Object.hasOwn(MARKETS, market)) {
    throw Object.assign(new Error("Choose a supported country."), { statusCode: 400 });
  }
  const db = database();
  // A draft (no research yet) for the same brand, country and goal is reused;
  // once research has run, new research starts a new project.
  const existing = await db.query(`update public.projects set updated_at=now()
    where id=(select p.id from public.projects p where p.user_id=$1 and p.seed_entity_id=$2
      and p.market=$3 and p.objective=$4
      and not exists (select 1 from public.analysis_runs r where r.project_id=p.id)
      order by p.updated_at desc limit 1)
    returning id`, [userId, input.seedEntityId, market, input.objective]);
  if (existing.rows[0]) return { ...await getProject(userId, existing.rows[0].id), reused: true };
  const contextEligible = process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED === "1" &&
    ["product_bundle", "cross_sell"].includes(input.objective);
  const created = await db.query(`insert into public.projects(user_id,seed_entity_id,name,objective,market)
    select $1,e.id,$2,$3,$6 from catalog.entities e
    where e.id=$4 and e.kind='brand' and
      (exists (select 1 from catalog.entity_identifiers i where i.entity_id=e.id
        and i.provider='qloo' and i.status='confirmed') or
       ($5::boolean and e.identity_status='verified' and e.official_website like 'https://%'))
    returning id`, [userId, name, input.objective, input.seedEntityId, contextEligible, market]);
  if (!created.rows[0]) throw Object.assign(new Error("Confirm a starting brand before creating a project."), { statusCode: 400 });
  return getProject(userId, created.rows[0].id);
}

export async function updateProject(userId, id, input) {
  if (!projectId(id)) return null;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (name.length < 1 || name.length > 120 || notes.length > 10000) {
    throw Object.assign(new Error("Check the project name, goal, and notes."), { statusCode: 400 });
  }
  const current = await getProject(userId, id);
  if (!current) return null;
  if (!projectObjectives.has(input.objective)) {
    throw Object.assign(new Error("Choose a goal available for new research."), { statusCode: 400 });
  }
  // A draft's goal can change freely; after research has run it stays fixed.
  if (input.objective !== current.objective) {
    const researched = await database().query("select 1 from public.analysis_runs where project_id=$1 limit 1", [id]);
    if (researched.rows.length) throw Object.assign(new Error("The goal can't change after research has run."), { statusCode: 409 });
  }
  const changed = await database().query(`update public.projects set name=$3,objective=$4,notes=$5,updated_at=now()
    where user_id=$1 and id=$2 returning id`, [userId, id, name, input.objective, notes]);
  return changed.rows[0] ? getProject(userId, id) : null;
}
