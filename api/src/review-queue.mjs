import pg from "pg";
import { refreshCommerceOffers } from "./commerce-offer-refresh.mjs";
import { productPairKeyFor } from "./research-memory.mjs";

// Adaptive learning loops 2 and 3: what a user's opportunity feedback changes
// in their later research, and the developer review queue that turns real
// cases into human labels. Labels are only ever the reviewer's; the model's
// own verdicts never become labels.
let pool;
const database = () => pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

export const FEEDBACK_REASONS = ["products_dont_fit", "not_right_for_brand", "already_working",
  "partner_not_credible", "other"];
// These reasons are about the partner, not one product pair: the partner is
// not researched again in the same project.
const PARTNER_REASONS = new Set(["not_right_for_brand", "already_working", "partner_not_credible"]);
const SAMPLE_DAYS = 90;
const SAMPLES_PER_RUN = 2;

// From each opportunity's latest effective feedback (undone feedback already
// removed): the product pairs the user passed on (any brand, any colour or
// size), partners passed on for a partner reason, and partners the user
// liked (good fit or a proposal), both for the same starting brand: a later
// search for that brand starts a new project, so a project is too narrow.
export function feedbackEffects(latest, seedEntityId) {
  const rejectedPairKeys = new Set();
  const excludedPartnerQlooIds = new Set();
  const preferredPartnerQlooIds = new Set();
  // Exact product pairs the user rated Good fit, so later research for the
  // same starting product re-checks them first instead of rediscovering them.
  const likedPairs = new Map();
  for (const event of latest ?? []) {
    const sameBrand = Boolean(seedEntityId) && event?.seedEntityId === seedEntityId && event.partnerQlooId;
    if (event?.action === "reject") {
      if (event.references?.seed?.productId && event.references?.partner?.productId) {
        rejectedPairKeys.add(productPairKeyFor(event.objective, event.references));
      }
      if (sameBrand && PARTNER_REASONS.has(event.reasonCode)) excludedPartnerQlooIds.add(event.partnerQlooId);
    } else if (event?.action === "save" && sameBrand) {
      preferredPartnerQlooIds.add(event.partnerQlooId);
      const seedProductId = event.references?.seed?.productId;
      const partnerProductId = event.references?.partner?.productId;
      if (/^gid:\/\/shopify\/Product\/[0-9]+$/.test(seedProductId ?? "") &&
          /^gid:\/\/shopify\/Product\/[0-9]+$/.test(partnerProductId ?? "")) {
        likedPairs.set(`${seedProductId}|${partnerProductId}`, { partnerQlooId: event.partnerQlooId,
          seedProductId, partnerProductId });
      }
    }
  }
  for (const id of excludedPartnerQlooIds) preferredPartnerQlooIds.delete(id);
  return { rejectedPairKeys: [...rejectedPairKeys].slice(0, 1000),
    excludedPartnerQlooIds: [...excludedPartnerQlooIds].slice(0, 100),
    preferredPartnerQlooIds: [...preferredPartnerQlooIds].slice(0, 20),
    likedPairs: [...likedPairs.values()].filter((pair) => !excludedPartnerQlooIds.has(pair.partnerQlooId))
      .slice(0, 50) };
}

// A few judged pairs the research did not recommend, so the reviewer also sees
// what users never see. Shown opportunities are already reviewable.
export function reviewSamplesFromRun({ runId, objective, market, candidates, shownKeys = [] },
  random = Math.random) {
  const shown = new Set(shownKeys);
  const pool = (candidates ?? []).flatMap((candidate) => candidate?.memory?.pairs ?? [])
    .filter((pair) => pair.judge && pair.status !== "supported" && pair.references &&
      /^[0-9a-f]{64}$/.test(pair.opportunityKey ?? "") && !shown.has(pair.opportunityKey));
  const picked = [];
  while (pool.length && picked.length < SAMPLES_PER_RUN) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked.map((pair) => ({ runId, objective, market, opportunityKey: pair.opportunityKey,
    references: identifiersOnly(pair.references), status: pair.status,
    mechanismState: pair.mechanismState ?? null, reasonCodes: pair.reasonCodes ?? [], judge: pair.judge }));
}

const identifiersOnly = (references) => Object.fromEntries(["seed", "partner"].map((side) => {
  const ref = references?.[side] ?? {};
  return [side, { productId: ref.productId ?? null, variantId: ref.variantId ?? null,
    sellerId: ref.sellerId ?? null, storefrontDomain: ref.storefrontDomain ?? null }];
}));

export async function recordReviewSamples(rows) {
  if (!process.env.DATABASE_URL || !rows?.length) return 0;
  const connection = await database().connect();
  try {
    await connection.query("begin");
    for (const row of rows) {
      await connection.query(`insert into private.review_samples
        (analysis_run_id,objective,market,opportunity_key,references_json,status,mechanism_state,reason_codes,judge)
        values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::text[],$9) on conflict do nothing`,
      [row.runId, row.objective, row.market, row.opportunityKey, JSON.stringify(row.references),
        row.status, row.mechanismState, row.reasonCodes.slice(0, 12), row.judge]);
    }
    await connection.query(`delete from private.review_samples
      where created_at<now()-make_interval(days=>$1)`, [SAMPLE_DAYS]);
    await connection.query("commit");
    return rows.length;
  } catch (error) { await connection.query("rollback"); throw error; }
  finally { connection.release(); }
}

// Developer access is an admin role on the account: Supabase app_metadata,
// which only the server or the Supabase dashboard can set, never the user.
export function isAdmin(user) {
  return user?.app_metadata?.role === "admin";
}

// Order of interest when one pair appears in several sources.
const SOURCE_ORDER = ["user_flag", "verdict_flip", "rejected_sample", "supported_sample"];

// One queue item per unlabelled pair and objective, highest-interest source first.
export function mergeQueue(rows, limit = 12) {
  const byPair = new Map();
  for (const row of [...rows].sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))) {
    const key = `${row.opportunityKey}|${row.objective}`;
    if (!byPair.has(key)) byPair.set(key, row);
  }
  return [...byPair.values()].slice(0, limit);
}

const MATCH_FIELDS = `m.id as "matchId",null::uuid as "sampleId",m.opportunity_key as "opportunityKey",
  r.objective,coalesce(r.constraints_json->>'market','US') as market,
  a.score_json->>'status' as "appStatus",a.evidence_json->'commerce'->'references' as references,
  a.score_json->'productMechanism'->>'customerReason' as "appReason",
  a.score_json->'productMechanism'->>'boundedRationale' as "appRationale",
  a.score_json->'reasonCodes' as "reasonCodes",
  seed.canonical_name as "seedName",partner.canonical_name as "partnerName"`;
const MATCH_JOINS = `public.matches m join public.analysis_runs r on r.id=m.analysis_run_id
  join catalog.entities seed on seed.id=m.brand_entity_id
  join catalog.entities partner on partner.id=m.partner_entity_id
  join lateral (select * from public.assessment_snapshots where match_id=m.id
    order by version desc limit 1) a on true`;
const UNLABELLED = (key, objective) => `not exists (select 1 from private.review_labels l
  where l.opportunity_key=${key} and l.objective=${objective})`;

export async function reviewQueue({ refresh = refreshCommerceOffers, limit = 12 } = {}) {
  const db = database();
  const [flags, flips, rejected, supported] = await Promise.all([
    db.query(`select distinct on (m.opportunity_key,r.objective) 'user_flag' as source,${MATCH_FIELDS},
        f.reason as "userNote",f.created_at as "at"
      from ${MATCH_JOINS} join public.feedback f on f.match_id=m.id
      where f.reason_code='products_dont_fit' and f.undone_at is null and m.opportunity_key is not null
        and ${UNLABELLED("m.opportunity_key", "r.objective")}
      order by m.opportunity_key,r.objective,f.created_at desc limit 50`),
    // A pair judged differently by different runs (any status change).
    db.query(`select distinct on (m.opportunity_key,r.objective) 'verdict_flip' as source,${MATCH_FIELDS},
        null as "userNote",m.created_at as "at"
      from ${MATCH_JOINS}
      where m.opportunity_key in (select p.opportunity_key from private.pair_research_outcomes p
        group by p.opportunity_key having count(distinct p.status)>1)
        and ${UNLABELLED("m.opportunity_key", "r.objective")}
      order by m.opportunity_key,r.objective,m.created_at desc limit 50`),
    db.query(`select 'rejected_sample' as source,null::uuid as "matchId",s.id as "sampleId",
        s.opportunity_key as "opportunityKey",s.objective,s.market,s.status as "appStatus",
        s.references_json as references,null as "appReason",null as "appRationale",
        to_jsonb(s.reason_codes) as "reasonCodes",seed.canonical_name as "seedName",null as "partnerName",
        null as "userNote",s.created_at as "at"
      from private.review_samples s join public.analysis_runs r on r.id=s.analysis_run_id
      join catalog.entities seed on seed.id=r.seed_entity_id
      where ${UNLABELLED("s.opportunity_key", "s.objective")}
      order by s.created_at desc limit 50`),
    db.query(`select 'supported_sample' as source,${MATCH_FIELDS},null as "userNote",m.created_at as "at"
      from ${MATCH_JOINS}
      where a.score_json->>'status'='supported' and m.opportunity_key is not null
        and ${UNLABELLED("m.opportunity_key", "r.objective")}
      order by m.created_at desc limit 50`)]);
  const items = mergeQueue([...flags.rows, ...flips.rows, ...rejected.rows, ...supported.rows], limit);
  // Product names and links are looked up live; nothing from the Catalog is stored.
  const output = [];
  for (let index = 0; index < items.length; index += 4) {
    output.push(...await Promise.all(items.slice(index, index + 4).map(async (item) => ({ ...item,
      offers: await refresh(item.references, { market: item.market }).catch(() => null) }))));
  }
  return output;
}

// Records (or replaces) the reviewer's call. The pair's identifiers and the
// app's verdict come from the stored match or sample, never from the request.
export async function recordReviewLabel(reviewerId, input) {
  const label = input?.label;
  const note = typeof input?.note === "string" ? input.note.trim().slice(0, 500) : "";
  if (!["good", "bad"].includes(label) || !SOURCE_ORDER.includes(input?.source)) {
    throw Object.assign(new Error("Choose good or bad for this pair."), { statusCode: 400 });
  }
  const uuid = /^[0-9a-f-]{36}$/;
  const db = database();
  const found = input.sampleId && uuid.test(input.sampleId)
    ? await db.query(`select s.opportunity_key as key,s.objective,s.status,s.references_json as refs,
        null::uuid as "matchId",s.id as "sampleId" from private.review_samples s where s.id=$1`, [input.sampleId])
    : input.matchId && uuid.test(input.matchId)
      ? await db.query(`select m.opportunity_key as key,r.objective,a.score_json->>'status' as status,
          a.evidence_json->'commerce'->'references' as refs,m.id as "matchId",null::uuid as "sampleId"
          from public.matches m join public.analysis_runs r on r.id=m.analysis_run_id
          join lateral (select * from public.assessment_snapshots where match_id=m.id
            order by version desc limit 1) a on true where m.id=$1`, [input.matchId])
      : { rows: [] };
  const pair = found.rows[0];
  if (!pair?.key || !pair.refs) throw Object.assign(new Error("Pair not found."), { statusCode: 404 });
  await db.query(`insert into private.review_labels
    (opportunity_key,objective,source,label,note,app_status,references_json,match_id,review_sample_id,reviewer_id)
    values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
    on conflict (opportunity_key,objective) do update set source=excluded.source,label=excluded.label,
      note=excluded.note,app_status=excluded.app_status,references_json=excluded.references_json,
      match_id=excluded.match_id,review_sample_id=excluded.review_sample_id,
      reviewer_id=excluded.reviewer_id,updated_at=now()`,
  [pair.key, pair.objective, input.source, label, note || null,
    ["supported", "needs_verification", "unsupported"].includes(pair.status) ? pair.status : null,
    JSON.stringify(identifiersOnly(pair.refs)), pair.matchId, pair.sampleId, reviewerId]);
  return { opportunityKey: pair.key, objective: pair.objective, label };
}
