import { rankCreatorChannels } from "./youtube-research.mjs";

const labels = new Set(["relevant", "not_relevant", "conditional"]);

export function buildCreatorReviewPacket(runId, audit) {
  if (!audit || !Array.isArray(audit.reviewed)) throw new Error("Creator audit is unavailable.");
  const shortlisted = rankCreatorChannels(audit.reviewed.filter((item) =>
    item.status === "shortlisted"), audit.campaignMode);
  const other = audit.reviewed.filter((item) => item.status !== "shortlisted");
  return { version: 1, runId, brandName: audit.brandName,
    campaignMode: audit.campaignMode, observedAt: audit.observedAt,
    culturalSignals: audit.culturalSignals,
    coverage: { reviewed: audit.reviewed.length,
      unreviewedCandidates: audit.unreviewedCandidateCount,
      searchIssues: audit.searchIssueCount,
      candidateIssues: audit.candidateIssueCount },
    cases: [...shortlisted, ...other].map((item, index) => ({
      caseId: `${runId}:${item.channelId}`, rank: item.status === "shortlisted" ? index + 1 : null,
      channelId: item.channelId, channelName: item.name, channelUrl: item.url,
      applicationStatus: item.status, confidence: item.confidence,
      culturalConnections: item.connections, sourceVideos: item.sourceVideos,
      researchCoverage: item.coverage,
      reviewerA: null, reviewerB: null, adjudicatedLabel: null,
    })) };
}

export function creatorReviewMetrics(packet) {
  const cases = packet?.cases ?? [];
  const invalid = cases.filter((item) => item.adjudicatedLabel !== null &&
    !labels.has(item.adjudicatedLabel));
  if (invalid.length) throw new Error("Unknown creator review label.");
  const reviewed = cases.filter((item) => labels.has(item.adjudicatedLabel));
  const binary = reviewed.filter((item) => item.adjudicatedLabel !== "conditional");
  const predicted = (item) => item.applicationStatus === "shortlisted";
  const truePositive = binary.filter((item) => predicted(item) &&
    item.adjudicatedLabel === "relevant").length;
  const falsePositive = binary.filter((item) => predicted(item) &&
    item.adjudicatedLabel === "not_relevant").length;
  const falseNegative = binary.filter((item) => !predicted(item) &&
    item.adjudicatedLabel === "relevant").length;
  const ranked = cases.filter((item) => item.rank !== null)
    .sort((a, b) => a.rank - b.rank).slice(0, 10);
  const precisionAt10 = ranked.length === 10 && ranked.every((item) =>
    ["relevant", "not_relevant"].includes(item.adjudicatedLabel))
    ? ranked.filter((item) => item.adjudicatedLabel === "relevant").length / 10 : null;
  return { totalCases: cases.length, adjudicated: reviewed.length,
    conditional: reviewed.length - binary.length,
    truePositive, falsePositive, falseNegative,
    assessedPrecision: truePositive + falsePositive
      ? truePositive / (truePositive + falsePositive) : null,
    reviewedCandidateRecall: truePositive + falseNegative
      ? truePositive / (truePositive + falseNegative) : null,
    precisionAt10,
    limitations: ["Recall covers only reviewed candidates, not unseen channels.",
      "A null Precision@10 means ten ranked channels have not all been adjudicated."] };
}

// Offline comparison only. The caller supplies the same assessment function for
// every channel; production discovery and its provider budget remain untouched.
export async function buildCreatorDiscoveryComparison({ qlooQueries, keywordQueries,
  assessCandidate, category, campaignMode }) {
  const calls = (queries) => queries.reduce((sum, query) => sum + (query.pages ?? 1), 0);
  if (!Array.isArray(qlooQueries) || !Array.isArray(keywordQueries) ||
      calls(qlooQueries) !== calls(keywordQueries) || typeof assessCandidate !== "function")
    throw new Error("Discovery arms require equal search-call budgets and one assessor.");
  const ids = (queries) => [...new Set(queries.flatMap((query) => query.channelIds ?? []))];
  const qlooIds = ids(qlooQueries); const keywordIds = ids(keywordQueries);
  const union = [...new Set([...qlooIds, ...keywordIds])];
  const cases = [];
  for (const channelId of union) {
    const assessment = await assessCandidate(channelId);
    cases.push({ channelId, discoveredBy: [
      ...(qlooIds.includes(channelId) ? ["qloo"] : []),
      ...(keywordIds.includes(channelId) ? ["keyword"] : [])],
      assessment, reviewerA: null, reviewerB: null, adjudicatedLabel: null });
  }
  return { version: 1, category, campaignMode,
    searchCallsPerArm: calls(qlooQueries),
    qlooQueries, keywordQueries, cases };
}

export function creatorDiscoveryComparisonMetrics(packet, k = 10) {
  if (!Number.isSafeInteger(k) || k < 1) throw new Error("Invalid precision cutoff.");
  const cases = packet?.cases ?? [];
  const idsFor = (arm) => [...new Set((packet?.[`${arm}Queries`] ?? [])
    .flatMap((query) => query.channelIds ?? []))];
  const qloo = idsFor("qloo"); const keyword = idsFor("keyword");
  const byId = new Map(cases.map((item) => [item.channelId, item]));
  const arm = (ids) => {
    const top = ids.slice(0, k).map((id) => byId.get(id));
    return { discovered: ids.length,
      adjudicated: ids.filter((id) => labels.has(byId.get(id)?.adjudicatedLabel)).length,
      precisionAtK: top.length === k && top.every((item) =>
        ["relevant", "not_relevant"].includes(item?.adjudicatedLabel))
        ? top.filter((item) => item.adjudicatedLabel === "relevant").length / k : null };
  };
  return { qloo: arm(qloo), keyword: arm(keyword),
    sharedCandidates: qloo.filter((id) => keyword.includes(id)).length,
    qlooOnly: qloo.filter((id) => !keyword.includes(id)).length,
    keywordOnly: keyword.filter((id) => !qloo.includes(id)).length,
    adjudicatedRelevantNovelty: {
      qlooOnly: qloo.filter((id) => !keyword.includes(id) &&
        byId.get(id)?.adjudicatedLabel === "relevant").length,
      keywordOnly: keyword.filter((id) => !qloo.includes(id) &&
        byId.get(id)?.adjudicatedLabel === "relevant").length },
    assessedCandidates: cases.filter((item) => item.assessment != null).length,
    measuredAssessmentCost: {
      youtubeCalls: cases.reduce((sum, item) => sum +
        (item.assessment?.cost?.youtubeCalls ?? 0), 0),
      llmCalls: cases.reduce((sum, item) => sum +
        (item.assessment?.cost?.llmCalls ?? 0), 0) },
    searchCallsPerArm: packet?.searchCallsPerArm ?? null,
    limitation: "Labels cover only adjudicated candidates; unseen-channel recall is unknown." };
}
