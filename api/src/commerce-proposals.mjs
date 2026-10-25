import pg from "pg";
import { refreshCommerceOffers, currentCommerceAssessment } from "./commerce-offer-refresh.mjs";
import { commerceProposal } from "./proposal-template.mjs";
import { sharedLaunchAreas } from "./commerce-launch.mjs";

let pool;
const db = () => pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

// Writes a proposal straight from a verified opportunity, or returns the one
// already written. The selected offers are re-checked first.
export async function commerceProposalAction(userId, matchId, _input = {},
  { refresh = refreshCommerceOffers, launchAreas = sharedLaunchAreas } = {}) {
  const found = await db().query(`select m.id,r.objective,r.match_type,
    r.constraints_json->'commerceRequirements' as requirements,
    seed.canonical_name as "seedName",partner.canonical_name as "partnerName",
    seed_id.external_id as "seedQlooId",partner_id.external_id as "partnerQlooId",
    coalesce(r.constraints_json->>'market','US') as market,
    coalesce(seed.official_website,seed.canonical_url) as "seedWebsite",
    coalesce(partner.official_website,partner.canonical_url) as "partnerWebsite",
    a.id as "assessmentId",a.score_json as assessment,a.evidence_json as evidence,
    a.validity_status as "evidenceStatus"
    from public.matches m join public.analysis_runs r on r.id=m.analysis_run_id
    join catalog.entities seed on seed.id=m.brand_entity_id
    join catalog.entities partner on partner.id=m.partner_entity_id
    left join catalog.entity_identifiers seed_id on seed_id.entity_id=seed.id
      and seed_id.provider='qloo' and seed_id.status='confirmed'
    left join catalog.entity_identifiers partner_id on partner_id.entity_id=partner.id
      and partner_id.provider='qloo' and partner_id.status='confirmed'
    join lateral (select * from public.assessment_snapshots
      where match_id=m.id and user_id=$2 order by version desc limit 1) a on true
    where m.id=$1 and m.user_id=$2 and r.match_type='brand_brand'
      and r.objective in ('product_bundle','cross_sell')`, [matchId, userId]);
  const row = found.rows[0];
  if (!row || row.assessment?.policyVersion !== "brand-commerce-v1.1" ||
      row.evidenceStatus !== "valid") {
    throw Object.assign(new Error("Commerce opportunity not found."), { statusCode: 404 });
  }
  const names = { seedName: row.seedName, partnerName: row.partnerName, objective: row.objective };
  const existingBrief = await db().query(`select id,content_markdown as markdown,revision
    from public.briefs where match_id=$1 and user_id=$2 order by updated_at desc limit 1`,
  [matchId, userId]);
  if (existingBrief.rows[0]) return { ...existingBrief.rows[0], ...names, reused: true };
  const currentOffers = await refresh(row.evidence?.commerce?.references,
    { market: row.evidence?.commerce?.market ?? "US", requirements: row.requirements ?? {},
      officialSites: { seed: row.seedWebsite, partner: row.partnerWebsite } });
  const currentAssessment = currentCommerceAssessment(row.assessment, currentOffers,
    row.requirements ?? {});
  if (currentOffers.seed?.status !== "current" || currentOffers.partner?.status !== "current" ||
      currentAssessment?.status !== "supported" ||
      currentAssessment?.currentOfferReview !== "current") {
    throw Object.assign(new Error("Selected product offers need a fresh review before a proposal."),
      { statusCode: 409 });
  }
  const launch = await launchAreas(userId, row.seedQlooId, row.partnerQlooId, row.market)
    .catch(() => null);
  const markdown = commerceProposal({ seedName: row.seedName, partnerName: row.partnerName,
    objective: row.objective, assessment: row.assessment, offers: currentOffers,
    launchAreas: launch?.areas ?? [], sourceUrls: [
      ...(row.evidence?.commerce?.identitySourceRefs ?? []),
      ...(row.evidence?.commerce?.culturalSourceRefs ?? []),
      ...(row.evidence?.commerce?.externalSourceRefs ?? [])] });
  const saved = await db().query(`insert into public.briefs
    (user_id,match_id,assessment_id,content_markdown)
    values ($1,$2,$3,$4) returning id,content_markdown as markdown,revision`,
  [userId, matchId, row.assessmentId, markdown]);
  return { ...saved.rows[0], ...names, reused: false };
}
