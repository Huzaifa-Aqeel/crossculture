// Bounded, read-only feasibility probe. No Catalog response or image is saved.
import { qlooCall, closeQloo } from "../src/qloo.mjs";
import { verifyCommerceBusiness } from "../src/commerce-native.mjs";
import { researchCommercePair } from "../src/commerce-research.mjs";
import { catalogClient, PROFILE_EXAMPLE } from "../src/shopify-catalog.mjs";

const seedId = "28823801-25D0-4A3E-AA90-3F028E2DBB3A";
const partnerId = "F5BDFE2E-B464-48FB-9025-52C3CFFF4F3C";
try {
  const recommendation = await qlooCall("qloo_recommend", {
    target_type: "brand", signals: [seedId], limit: 12, explain: true,
  });
  const recommended = recommendation.status === "ok" || recommendation.status === "partial"
    ? recommendation.results?.some((item) => item.entity_id?.toLowerCase() === partnerId.toLowerCase()) : false;
  if (!recommended) {
    console.log(JSON.stringify({ qlooStatus: recommendation.status, candidateReturned: false }));
    process.exitCode = 2;
  } else {
    const [seed, partner] = await Promise.all([
      verifyCommerceBusiness({ qlooId: seedId, name: "BAGGU", website: "https://baggu.com" }),
      verifyCommerceBusiness({ qlooId: partnerId, name: "Cold Picnic", website: "https://coldpicnic.com" }),
    ]);
    if (!seed || !partner) {
      console.log(JSON.stringify({ candidateReturned: true, seedIdentity: Boolean(seed),
        partnerIdentity: Boolean(partner) }));
      process.exitCode = 2;
    } else {
      const objectives = ["product_bundle", "cross_sell"].filter((item) =>
        !process.env.COMMERCE_PROBE_OBJECTIVE || process.env.COMMERCE_PROBE_OBJECTIVE === item);
      for (const objective of objectives) {
        const result = await researchCommercePair({ seed, partner, objective,
          discoveryBasis: "qloo_native_brand", cultureEvidence: { seedQlooId: seedId,
            partnerQlooId: partnerId, unconstrained: true, envelope: recommendation },
          market: "US" }, { createCatalog: () => catalogClient({ profileUrl: PROFILE_EXAMPLE }),
            ...(process.env.COMMERCE_PROBE_QUERY ? { productQueries: [process.env.COMMERCE_PROBE_QUERY] } : {}) });
        console.log(JSON.stringify({ objective, candidateReturned: true, seedIdentity: true,
          partnerIdentity: true, coverage: result.coverage,
          coverageIssues: result.coverageIssues,
          diagnostics: Object.fromEntries(Object.entries(result.opportunities).map(([status, groups]) =>
            [status, [...new Set(groups.flatMap((group) =>
              [group.best, ...group.otherOpportunities].flatMap((item) => [
                ...item.assessment.reasonCodes, ...item.assessment.reviewFlags,
                `mechanism:${item.assessment.productMechanism.kind}`])))] ])),
          outcomes: Object.fromEntries(Object.entries(result.opportunities)
            .map(([status, groups]) => [status, groups.reduce((count, group) =>
              count + 1 + group.otherOpportunities.length, 0)])), callsUsed: result.callsUsed }));
        if (!result.opportunities.supported.length) process.exitCode = 2;
      }
    }
  }
} catch (error) {
  console.log(JSON.stringify({ probeError: error?.code ?? error?.message ?? "unknown" }));
  process.exitCode = 2;
} finally { await closeQloo().catch(() => {}); }
