import pg from "pg";
import { refreshCommerceOffers, currentCommerceAssessment } from "./commerce-offer-refresh.mjs";
import { developCommerceConcepts } from "./commerce-concepts.mjs";
import { proposalTemplate } from "./proposal-template.mjs";
import { datedCommerceAngle } from "./commerce-vetting.mjs";

let pool;
const db = () => pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

export async function commerceProposalAction(userId, matchId, { conceptId = null } = {},
  { develop = developCommerceConcepts, refresh = refreshCommerceOffers } = {}) {
  const found = await db().query(`select m.id,r.objective,r.match_type,
    r.constraints_json->'commerceRequirements' as requirements,
    seed.canonical_name as "seedName",partner.canonical_name as "partnerName",
    coalesce(seed.official_website,seed.canonical_url) as "seedWebsite",
    coalesce(partner.official_website,partner.canonical_url) as "partnerWebsite",
    a.id as "assessmentId",a.score_json as assessment,a.evidence_json as evidence,
    a.validity_status as "evidenceStatus"
    from public.matches m join public.analysis_runs r on r.id=m.analysis_run_id
    join catalog.entities seed on seed.id=m.brand_entity_id
    join catalog.entities partner on partner.id=m.partner_entity_id
    join lateral (select * from public.assessment_snapshots
      where match_id=m.id and user_id=$2 order by version desc limit 1) a on true
    where m.id=$1 and m.user_id=$2 and r.match_type='brand_brand'
      and r.objective in ('product_bundle','cross_sell')`, [matchId, userId]);
  const row = found.rows[0];
  if (!row || row.assessment?.policyVersion !== "brand-commerce-v1.1" ||
      row.evidenceStatus !== "valid") {
    throw Object.assign(new Error("Commerce opportunity not found."), { statusCode: 404 });
  }
  const existingBrief = await db().query(`select id,content_markdown as markdown,revision
    from public.briefs where match_id=$1 and user_id=$2 order by updated_at desc limit 1`,
  [matchId, userId]);
  if (existingBrief.rows[0]) return { ...existingBrief.rows[0], reused: true };
  const existingConcepts = await db().query(`select id,title,format,draft_json as draft
    from public.concepts where match_id=$1 and user_id=$2 order by version`, [matchId, userId]);
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
  if (conceptId) {
    const selected = existingConcepts.rows.find((item) => item.id === conceptId);
    if (!selected) throw Object.assign(new Error("Choose one of these concepts."), { statusCode: 400 });
    const sourceUrls = [
      ...(row.evidence?.commerce?.identitySourceRefs ?? []),
      ...(row.evidence?.commerce?.culturalSourceRefs ?? []),
      ...(row.evidence?.commerce?.externalSourceRefs ?? []),
      ...(selected.draft.datedAngleSourceUrl ? [selected.draft.datedAngleSourceUrl] : []),
    ];
    const markdown = proposalTemplate({ seedName: row.seedName, partnerName: row.partnerName,
      objective: row.objective, sourceUrls }) +
      `\n## Selected product concept\n\n${selected.draft.summary}\n\n` +
      `**Starting brand role:** ${selected.draft.roles.seed}\n\n` +
      `**Partner role:** ${selected.draft.roles.partner}\n\n` +
      `**To verify:** ${selected.draft.validation}\n`;
    const saved = await db().query(`insert into public.briefs
      (user_id,match_id,concept_id,assessment_id,content_markdown)
      values ($1,$2,$3,$4,$5) returning id,content_markdown as markdown,revision`,
    [userId, matchId, selected.id, row.assessmentId, markdown]);
    return { ...saved.rows[0], reused: false };
  }
  if (existingConcepts.rows.length === 3) return { concepts: existingConcepts.rows, reused: true };
  const angle = await datedCommerceAngle(row.partnerName, currentOffers.partner).catch(() => null);
  const concepts = await develop({ seedName: row.seedName, partnerName: row.partnerName,
    objective: row.objective, assessment: row.assessment, currentOffers, datedAngle: angle });
  const saved = [];
  for (const [index, item] of concepts.entries()) {
    const created = await db().query(`insert into public.concepts
      (user_id,match_id,base_assessment_id,version,title,format,draft_json)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb)
      on conflict (match_id,version) do nothing returning id,title,format,draft_json as draft`,
    [userId, matchId, row.assessmentId, index + 1, item.title, item.format,
      JSON.stringify({ ...item, ...(angle && item.evidenceRefs?.includes("dated_angle")
        ? { datedAngleSourceUrl: angle.sourceUrl, datedAnglePublishedAt: angle.publishedAt } : {}) })]);
    if (created.rows[0]) saved.push(created.rows[0]);
  }
  if (saved.length !== 3) {
    const current = await db().query(`select id,title,format,draft_json as draft
      from public.concepts where match_id=$1 and user_id=$2 order by version`, [matchId, userId]);
    return { concepts: current.rows, reused: true };
  }
  return { concepts: saved, reused: false };
}
