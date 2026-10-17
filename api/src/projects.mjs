import pg from "pg";
import { projectObjectives } from "./new-run-objectives.mjs";

let pool;
function database() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  }
  return pool;
}

const projectId = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const projection = `p.id,p.name,p.objective,p.notes,p.created_at as "createdAt",p.updated_at as "updatedAt",
  e.id as "seedEntityId",e.canonical_name as "seedName"`;

export async function listProjects(userId) {
  const result = await database().query(`select ${projection} from public.projects p
    join catalog.entities e on e.id = p.seed_entity_id where p.user_id = $1
    order by p.updated_at desc limit 100`, [userId]);
  return result.rows;
}

export async function getProject(userId, id) {
  if (!projectId(id)) return null;
  const result = await database().query(`select ${projection} from public.projects p
    join catalog.entities e on e.id = p.seed_entity_id where p.user_id = $1 and p.id = $2`, [userId, id]);
  return result.rows[0] ?? null;
}

export async function createProject(userId, input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 120 || !projectObjectives.has(input.objective) || !projectId(input.seedEntityId)) {
    throw new Error("Enter a project name, starting brand, and goal.");
  }
  const db = database();
  const created = await db.query(`insert into public.projects(user_id,seed_entity_id,name,objective)
    select $1,e.id,$2,$3 from catalog.entities e
    join catalog.entity_identifiers i on i.entity_id=e.id
    where e.id=$4 and e.kind='brand' and i.provider='qloo' and i.status='confirmed'
    returning id`, [userId, name, input.objective, input.seedEntityId]);
  if (!created.rows[0]) throw new Error("Confirm a starting brand before creating a project.");
  return getProject(userId, created.rows[0].id);
}

export async function updateProject(userId, id, input) {
  if (!projectId(id)) return null;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (name.length < 1 || name.length > 120 || notes.length > 10000) {
    throw new Error("Check the project name, goal, and notes.");
  }
  const current = await getProject(userId, id);
  if (!current) return null;
  if (!projectObjectives.has(input.objective) && input.objective !== current.objective) {
    throw new Error("Choose a goal available for new research.");
  }
  const changed = await database().query(`update public.projects set name=$3,objective=$4,notes=$5,updated_at=now()
    where user_id=$1 and id=$2 returning id`, [userId, id, name, input.objective, notes]);
  return changed.rows[0] ? getProject(userId, id) : null;
}
