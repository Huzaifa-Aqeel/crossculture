// CrossCulture Scoring Engine v4 — sole scoring implementation.
// Authority: CrossCulture_Scoring_Engine_v4.md. One Collaboration Opportunity Score
// explained by Cultural Connection (C), Content/Business Relevance (R) and Goal Fit (G)
// ratings, a two-stage harmonic mean, separate eligibility/confidence, no concept
// dependency and no numeric novelty bonus. All rules below are deterministic; no model
// supplies numeric ratings.

export const SCORING_VERSION = "4.0.1" as const;

export type PairType = "brand_brand" | "brand_youtube";
export type Objective = "awareness" | "new_audience" | "repositioning" |
  "co_created_product" | "content_collaboration" | "sponsorship";
export type Rating = 0 | 0.25 | 0.5 | 0.75 | 1 | null;

export type AssessedSignal = {
  rating: Rating;
  evidenceIds: string[];
  reasonCode: string;
  notes?: string;
};

export type ScoringInput = {
  snapshotId: string;
  snapshotHash: string;
  scorerVersion: typeof SCORING_VERSION;
  pairType: PairType;
  objective: Objective;
  brandId: string;
  partnerId: string;
  sourceIds: string[];
  culturalConnection: AssessedSignal;
  contentRelevance: AssessedSignal;
  goalFit: AssessedSignal;
  qlooLineageVerified: boolean;
  identityVerified: boolean;
  hardExclusion: boolean;
  hardExclusionEvidenceIds: string[];
  reviewFlags: string[];
  confidence: "high" | "medium" | "low";
};

export type ScoringOutput = {
  opportunityScore: number | null;
  displayScore: number | null;
  culturalRelevance: number | null;
  status: "eligible" | "conditional" | "insufficient_evidence" | "excluded";
  confidence: "high" | "medium" | "low";
  ratings: { C: Rating; R: Rating; G: Rating };
  reasonCodes: string[];
  evidenceIds: string[];
  scorerVersion: typeof SCORING_VERSION;
  inputHash: string;
};

const RATINGS = new Set<number>([0, 0.25, 0.5, 0.75, 1]);
const OBJECTIVES: readonly Objective[] = ["awareness", "new_audience", "repositioning",
  "co_created_product", "content_collaboration", "sponsorship"];

function harmonic(a: number, b: number): number {
  return a + b > 0 ? (2 * a * b) / (a + b) : 0;
}

function isSignal(value: unknown): value is AssessedSignal {
  const signal = value as AssessedSignal;
  return Boolean(signal) && typeof signal === "object" &&
    (signal.rating === null || RATINGS.has(signal.rating as number)) &&
    Array.isArray(signal.evidenceIds) && signal.evidenceIds.every((id) => typeof id === "string") &&
    typeof signal.reasonCode === "string" && signal.reasonCode.length > 0 &&
    (signal.notes === undefined || typeof signal.notes === "string");
}

export function scoreAssessment(input: ScoringInput): ScoringOutput {
  if (!input || typeof input !== "object" ||
      typeof input.snapshotId !== "string" || !input.snapshotId ||
      typeof input.snapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(input.snapshotHash) ||
      input.scorerVersion !== SCORING_VERSION ||
      !["brand_brand", "brand_youtube"].includes(input.pairType) ||
      !OBJECTIVES.includes(input.objective) ||
      typeof input.brandId !== "string" || !input.brandId ||
      typeof input.partnerId !== "string" || !input.partnerId || input.brandId === input.partnerId ||
      !Array.isArray(input.sourceIds) || !input.sourceIds.every((id) => typeof id === "string") ||
      !isSignal(input.culturalConnection) || !isSignal(input.contentRelevance) || !isSignal(input.goalFit) ||
      typeof input.qlooLineageVerified !== "boolean" || typeof input.identityVerified !== "boolean" ||
      typeof input.hardExclusion !== "boolean" ||
      !Array.isArray(input.hardExclusionEvidenceIds) || !Array.isArray(input.reviewFlags) ||
      !["high", "medium", "low"].includes(input.confidence)) {
    throw new Error("Invalid v4 scoring input.");
  }
  const sourceIds = new Set(input.sourceIds);
  if (!input.hardExclusionEvidenceIds.every((id) => typeof id === "string" && sourceIds.has(id))) {
    throw new Error("Hard-exclusion evidence must reference frozen snapshot sources.");
  }
  for (const signal of [input.culturalConnection, input.contentRelevance, input.goalFit]) {
    if (!signal.evidenceIds.every((id) => sourceIds.has(id))) {
      throw new Error("Signal evidence must reference frozen snapshot sources.");
    }
  }

  const base = {
    opportunityScore: null, displayScore: null, culturalRelevance: null,
    confidence: input.confidence,
    ratings: { C: input.culturalConnection.rating, R: input.contentRelevance.rating, G: input.goalFit.rating },
    evidenceIds: [] as string[], scorerVersion: SCORING_VERSION, inputHash: input.snapshotHash,
  };
  const collect = (...signals: AssessedSignal[]) =>
    [...new Set(signals.flatMap((signal) => signal.evidenceIds))];

  if (input.hardExclusion) {
    return { ...base, status: "excluded",
      reasonCodes: ["hard_exclusion", input.culturalConnection.reasonCode,
        input.contentRelevance.reasonCode, input.goalFit.reasonCode],
      evidenceIds: [...input.hardExclusionEvidenceIds] };
  }
  if (!input.identityVerified) {
    return { ...base, status: "insufficient_evidence", reasonCodes: ["identity_unverified"], evidenceIds: [] };
  }
  if (!input.qlooLineageVerified) {
    return { ...base, status: "insufficient_evidence", reasonCodes: ["qloo_lineage_unverified"], evidenceIds: [] };
  }
  // Admissibility gate: a weak diagnostic C anchor never produces a scored recommendation.
  if (input.culturalConnection.rating === 0.25) {
    return { ...base, status: "insufficient_evidence",
      reasonCodes: ["cultural_connection_diagnostic_only"], evidenceIds: collect(input.culturalConnection) };
  }
  const missing: string[] = [];
  if (input.culturalConnection.rating === null) missing.push(input.culturalConnection.reasonCode);
  if (input.contentRelevance.rating === null) missing.push(input.contentRelevance.reasonCode);
  if (input.goalFit.rating === null) missing.push(input.goalFit.reasonCode);
  if (missing.length > 0) {
    return { ...base, status: "insufficient_evidence", reasonCodes: missing,
      evidenceIds: collect(input.culturalConnection, input.contentRelevance, input.goalFit) };
  }

  const C = input.culturalConnection.rating as Exclude<Rating, null>;
  const R = input.contentRelevance.rating as Exclude<Rating, null>;
  const G = input.goalFit.rating as Exclude<Rating, null>;
  const culture = harmonic(C, R);
  const raw = 100 * harmonic(culture, G);
  const opportunityScore = Math.round(raw * 1e6) / 1e6;
  return {
    opportunityScore,
    displayScore: Math.min(100, Math.max(0, Math.round(opportunityScore / 5) * 5)),
    culturalRelevance: Math.round(culture * 1e6) / 1e6,
    status: input.reviewFlags.length > 0 ? "conditional" : "eligible",
    confidence: input.confidence,
    ratings: { C, R, G },
    reasonCodes: [input.culturalConnection.reasonCode, input.contentRelevance.reasonCode, input.goalFit.reasonCode],
    evidenceIds: collect(input.culturalConnection, input.contentRelevance, input.goalFit),
    scorerVersion: SCORING_VERSION,
    inputHash: input.snapshotHash,
  };
}

// ---- Worker-side classification rules (v4 §§4–8) -------------------------------
// Deterministic evidence -> AssessedSignal. These run in the worker over the frozen
// contractVersion 2 evidence object; they never call a model and never invent numbers.

type Bridge = { id: string; name: string; qlooTagId: string; family: string | null;
  specificity: "broad" | "named"; qlooSourceIds: string[]; partnerSourceIds: string[];
  explainabilityBacked: boolean };
type Activity = { id: string; summary: string;
  centrality: "central" | "substantive" | "incidental" | "contradictory" | "unknown";
  firstParty: boolean; bridgeIds: string[]; sourceIds: string[];
  projectKey?: string | null; projectVerified?: boolean };
type Capability = { id: string; name: string;
  status: "direct" | "transferable" | "unsupported" | "contradicted"; sourceIds: string[] };
type Constraint = { id: string; text: string; kind: "user" | "verified";
  blocking: boolean; sourceIds?: string[] };
export type FrozenEvidence = { contractVersion: number; sample: boolean;
  sources: { id: string; kind: string; freshness?: string | null; observedAt?: string | null;
    sourceUrl?: string | null; contentHash?: string | null }[];
  claims: unknown[]; unknowns: string[];
  bridges?: Bridge[]; partnerActivity?: Activity[]; capabilities?: Capability[];
  creatorSample?: { sourceIds: string[]; videoIds: string[]; collectedAt: string; complete: boolean };
  constraints?: Constraint[] };

export type ClassifiedSignals = {
  culturalConnection: AssessedSignal;
  contentRelevance: AssessedSignal;
  goalFit: AssessedSignal;
  reviewFlags: string[];
  confidence: "high" | "medium" | "low";
  mechanism: string;
};

export function classifyExclusions(evidence: FrozenEvidence) {
  const sources = new Set(evidence.sources.map((source) => source.id));
  const constraints = evidence.constraints ?? [];
  const blocking = constraints.filter((item) => item.blocking &&
    (item.kind === "user" || Boolean(item.sourceIds?.length && item.sourceIds.every((id) => sources.has(id)))));
  return { hardExclusion: blocking.length > 0,
    hardExclusionEvidenceIds: [...new Set(blocking.flatMap((item) => item.sourceIds ?? []))],
    reviewFlags: constraints.some((item) => !item.blocking) ? ["potential_conflict"] : [] };
}

function admissibleBridges(evidence: FrozenEvidence): Bridge[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return (evidence.bridges ?? []).filter((bridge) => {
    if (new Set(bridge.qlooSourceIds).size < 2) return false;
    const id = bridge.qlooTagId.trim().toLowerCase();
    const name = bridge.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (ids.has(id) || names.has(name)) return false;
    ids.add(id); names.add(name);
    return true;
  });
}

// v4 §5: C needs a Qloo-supported pair bridge; broad tag bridge .50, specific named
// entity bridge .75, named + distinct-family corroboration or explainability-backed
// direct bridge with separate partner verification 1.00. No admissible bridge -> null.
export function classifyCulturalConnection(evidence: FrozenEvidence): AssessedSignal {
  const bridges = admissibleBridges(evidence);
  const evidenceIds = bridges.flatMap((bridge) => [...bridge.qlooSourceIds, ...bridge.partnerSourceIds]);
  if (bridges.length === 0) {
    return { rating: null, evidenceIds: [], reasonCode: "no_qloo_supported_pair_bridge",
      notes: "No cultural connection is supported on both sides yet." };
  }
  const named = bridges.filter((bridge) => bridge.specificity === "named");
  const namedFamilies = new Set(named.map((bridge) => bridge.family).filter((family) => family !== null));
  if (named.length >= 2 && namedFamilies.size >= 2) {
    return { rating: 1, evidenceIds, reasonCode: "corroborated_named_bridges",
      notes: `Distinct supported connections: ${named.slice(0, 3).map((bridge) => bridge.name).join(", ")}.` };
  }
  if (named.length >= 1 && named[0].explainabilityBacked && named[0].partnerSourceIds.length >= 1) {
    return { rating: 1, evidenceIds, reasonCode: "named_bridge_explainability_corroborated",
      notes: `Supported connection to ${named[0].name}, corroborated by partner sources.` };
  }
  if (named.length >= 1) {
    return { rating: 0.75, evidenceIds, reasonCode: "specific_named_bridge",
      notes: `Supported connection to ${named.map((bridge) => bridge.name).slice(0, 3).join(", ")}.` };
  }
  return { rating: 0.5, evidenceIds, reasonCode: "broad_tag_bridge",
    notes: `Broad shared cultural territory: ${bridges.map((bridge) => bridge.name).slice(0, 3).join(", ")}.` };
}

// v4 §6.2 (brand): R measures whether the bridged territory is material to the
// partner's observed work. Counts use first-party centrality plus independent
// corroboration; syndicated copies are deduplicated upstream by source records.
export function classifyContentRelevance(evidence: FrozenEvidence, pairType: PairType): { signal: AssessedSignal; reviewFlags: string[] } {
  if (pairType === "brand_youtube") {
    const sample = evidence.creatorSample;
    if (!sample?.sourceIds.length || sample.sourceIds.length !== sample.videoIds.length) {
      return { signal: { rating: null, evidenceIds: [], reasonCode: "creator_sample_unavailable",
        notes: "A representative creator sample is unavailable." }, reviewFlags: [] };
    }
    const admitted = new Set(admissibleBridges(evidence).map((bridge) => bridge.id));
    const sampleSources = new Set(sample.sourceIds);
    // One source item represents one predeclared video. Selected discovery hits
    // and transcripts outside this frame cannot inflate the frequency count.
    const perVideo = new Map<string, Activity>();
    for (const item of evidence.partnerActivity ?? []) {
      if (!item.bridgeIds.some((id) => admitted.has(id))) continue;
      for (const id of item.sourceIds) {
        if (!sampleSources.has(id)) continue;
        const previous = perVideo.get(id);
        const order = { contradictory: 5, central: 4, substantive: 3, incidental: 2, unknown: 1 };
        if (!previous || order[item.centrality] > order[previous.centrality]) perVideo.set(id, item);
      }
    }
    const relevant = [...perVideo.entries()];
    const evidenceIds = relevant.map(([id]) => id);
    const contradicted = relevant.some(([, item]) => item.centrality === "contradictory");
    const reviewFlags = [
      ...(contradicted ? ["material_contradiction"] : []),
      ...(!sample.complete ? ["creator_sample_incomplete"] : []),
    ];
    const central = relevant.filter(([, item]) => item.centrality === "central");
    const substantive = relevant.filter(([, item]) => ["central", "substantive"].includes(item.centrality));
    if (central.length >= 4 && !contradicted &&
        new Set(central.map(([id]) => evidence.sources.find((source) => source.id === id)?.observedAt).filter(Boolean)).size >= 2) {
      return { signal: { rating: 1, evidenceIds, reasonCode: "sustained_creator_topic",
        notes: "At least four sampled videos centrally cover the supported culture on multiple dates." }, reviewFlags };
    }
    if (central.length >= 2 || substantive.length >= 3) {
      return { signal: { rating: 0.75, evidenceIds, reasonCode: "recurring_creator_topic",
        notes: "Several independent sampled videos cover the supported culture." }, reviewFlags };
    }
    if (central.length >= 1 || substantive.length >= 2) {
      return { signal: { rating: 0.5, evidenceIds, reasonCode: "demonstrated_creator_topic",
        notes: "Sampled videos substantively cover the supported culture." }, reviewFlags };
    }
    if (relevant.length) return { signal: { rating: 0.25, evidenceIds,
      reasonCode: "incidental_creator_reference", notes: "Only an isolated or weak reference was observed." }, reviewFlags };
    return { signal: { rating: null, evidenceIds: [], reasonCode: "creator_cultural_content_unverified",
      notes: "No sampled video is reliably linked to a supported cultural connection." }, reviewFlags };
  }
  const bridgeIds = new Set(admissibleBridges(evidence).map((bridge) => bridge.id));
  const linked = (evidence.partnerActivity ?? [])
    .filter((item) => item.bridgeIds.some((id) => bridgeIds.has(id)));
  const reviewFlags: string[] = [];
  if (linked.some((item) => item.centrality === "contradictory")) reviewFlags.push("material_contradiction");
  const evidenceIds = [...new Set(linked.flatMap((item) => item.sourceIds))];
  if (linked.length === 0) {
    return { signal: { rating: null, evidenceIds: [], reasonCode: "no_partner_activity_evidence",
      notes: "No credible source yet shows the partner operating in this territory." }, reviewFlags };
  }
  const sourceById = new Map(evidence.sources.map((source) => [source.id, source]));
  const documentKey = (id: string) => {
    const source = sourceById.get(id);
    if (source?.contentHash) return `hash:${source.contentHash}`;
    if (source?.sourceUrl) {
      try { const url = new URL(source.sourceUrl); url.hash = "";
        for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
        return `url:${url.toString().replace(/\/$/, "")}`;
      } catch { /* A validated frozen source may be a fixture without a URL. */ }
    }
    return `id:${id}`;
  };
  const weight = { central: 4, substantive: 3, incidental: 2, contradictory: 1, unknown: 0 };
  const byDocument = new Map<string, Activity>();
  for (const item of linked) {
    const key = `${item.firstParty}:${documentKey(item.sourceIds[0])}`;
    const previous = byDocument.get(key);
    if (!previous || weight[item.centrality] > weight[previous.centrality]) byDocument.set(key, item);
  }
  const uniqueActivity = new Map<string, Activity>();
  for (const item of byDocument.values()) {
    const project = item.projectKey?.trim().toLowerCase() || documentKey(item.sourceIds[0]);
    const key = `${item.firstParty}:${project}`;
    const previous = uniqueActivity.get(key);
    if (!previous || weight[item.centrality] > weight[previous.centrality]) uniqueActivity.set(key, item);
  }
  const groups = [...uniqueActivity.values()];
  const centralFirstParty = groups.filter((item) => item.firstParty && item.centrality === "central");
  const substantiveFirstParty = groups.filter((item) => item.firstParty && item.centrality === "substantive");
  const independent = groups.filter((item) => !item.firstParty &&
    (item.centrality === "central" || item.centrality === "substantive"));
  if (centralFirstParty.filter((item) => item.projectVerified === true).length >= 2) {
    return { signal: { rating: 1, evidenceIds, reasonCode: "sustained_corroborated_activity",
      notes: independent.length ? "Distinct official projects with independent corroboration." :
        "Multiple distinct official projects establish sustained activity." }, reviewFlags };
  }
  if (centralFirstParty.length >= 1 || substantiveFirstParty.length >= 2) {
    return { signal: { rating: 0.75, evidenceIds, reasonCode: "official_substantial_activity",
      notes: "Official material shows this territory is a substantial part of the partner's activity." }, reviewFlags };
  }
  if (centralFirstParty.length + substantiveFirstParty.length === 1) {
    return { signal: { rating: 0.5, evidenceIds, reasonCode: "single_reliable_source",
      notes: "One reliable source shows relevant partner activity; scope is still limited." }, reviewFlags };
  }
  return { signal: { rating: 0.25, evidenceIds, reasonCode: "incidental_or_unconfirmed_activity",
    notes: "Only incidental or unconfirmed partner activity is visible." }, reviewFlags };
}

// v4 §7: fixed objective -> mechanism family and required capability allowlist.
const MECHANISMS: Record<Objective, Record<PairType, string>> = {
  awareness: { brand_brand: "A joint campaign or placement distributed through the partner's existing channels.",
    brand_youtube: "A feature or placement inside the creator's regular publishing." },
  new_audience: { brand_brand: "A co-presented activation that introduces the brand inside the partner's distinct cultural territory.",
    brand_youtube: "An introduction of the brand through the creator's distinct cultural territory and format." },
  repositioning: { brand_brand: "A co-branded story that communicates the desired association through the partner's cultural work.",
    brand_youtube: "A creator-led story that communicates the desired association." },
  co_created_product: { brand_brand: "A limited co-created product or capsule both sides can realistically make and deliver.",
    brand_youtube: "A limited co-created item or edition with the creator's input." },
  content_collaboration: { brand_brand: "A jointly produced content piece or series using the partner's demonstrated formats.",
    brand_youtube: "A joint video or series using the creator's demonstrated format." },
  sponsorship: { brand_brand: "A brand integration inside the partner's owned activation or channel.",
    brand_youtube: "A disclosed integration inside the creator's authentic content." },
};
const REQUIRED_CAPABILITIES: Record<Objective, string[]> = {
  awareness: ["distribution_channel"],
  new_audience: ["distinct_territory_presence", "activation_channel"],
  repositioning: ["cultural_storytelling"],
  co_created_product: ["making_or_delivery_capability"],
  content_collaboration: ["content_creation_capability"],
  sponsorship: ["integration_or_channel_capability"],
};

// The worker reads this versioned allowlist to collect capability evidence.
export function requiredCapabilities(objective: Objective): string[] {
  return [...(REQUIRED_CAPABILITIES[objective] ?? [])];
}

export function classifyGoalFit(evidence: FrozenEvidence, objective: Objective, pairType: PairType): AssessedSignal {
  const mechanism = MECHANISMS[objective][pairType];
  const required = REQUIRED_CAPABILITIES[objective];
  const byKey = new Map((evidence.capabilities ?? []).map((capability) => [capability.id.replace(/^cap:/, ""), capability]));
  const found = required.map((key) => byKey.get(key)).filter((capability): capability is Capability => Boolean(capability));
  const evidenceIds = [...new Set(found.flatMap((capability) => capability.sourceIds))];
  if (found.some((capability) => capability.status === "contradicted")) {
    return { rating: 0, evidenceIds, reasonCode: "documented_capability_mismatch",
      notes: "A documented capability contradicts the proposed route." };
  }
  if (found.length === 0 || found.length < required.length ||
      found.some((capability) => capability.sourceIds.length === 0)) {
    return { rating: null, evidenceIds: [], reasonCode: "capability_evidence_absent",
      notes: "Whether the partner can support this goal is still unknown." };
  }
  if (found.some((capability) => capability.status === "unsupported")) {
    return { rating: 0.25, evidenceIds, reasonCode: "specific_route_unsupported_capability",
      notes: "A specific route is proposed but the needed capability is not yet demonstrated." };
  }
  const direct = found.filter((capability) => capability.status === "direct");
  if (direct.length === required.length && direct.every((capability) => new Set(capability.sourceIds).size >= 2)) {
    return { rating: 1, evidenceIds, reasonCode: "direct_repeated_capability",
      notes: "The proposed route matches directly and repeatedly demonstrated partner capability." };
  }
  if (direct.length === required.length) {
    return { rating: 0.75, evidenceIds, reasonCode: "direct_capability",
      notes: "The proposed route matches directly demonstrated partner activity." };
  }
  if (found.some((capability) => capability.status === "transferable")) {
    return { rating: 0.5, evidenceIds, reasonCode: "transferable_capability",
      notes: "The partner has transferable experience; the exact format is not directly demonstrated." };
  }
  return { rating: null, evidenceIds, reasonCode: "capability_evidence_ambiguous",
    notes: "Capability evidence is ambiguous and needs review." };
}

// v4 §8: confidence is a separate evidence-coverage label, not a probability.
export function adjudicateConfidence(evidence: FrozenEvidence, signals: { C: Rating; R: Rating; G: Rating },
  reviewFlags: string[]): "high" | "medium" | "low" {
  if (signals.C === null || signals.R === null || signals.G === null) return "low";
  if (reviewFlags.length > 0) return "low";
  const kinds = new Set((evidence.sources ?? []).map((source) => source.kind));
  const stale = (evidence.sources ?? []).some((source) => source.freshness === "stale");
  const bridges = admissibleBridges(evidence);
  if (stale) return "medium";
  if (kinds.size >= 2 && bridges.some((bridge) => bridge.specificity === "named") &&
      (evidence.partnerActivity ?? []).length >= 2) return "high";
  return "medium";
}

export function classifySignals(evidence: FrozenEvidence, objective: Objective, pairType: PairType): ClassifiedSignals {
  if (evidence.contractVersion !== 2) {
    const unrated: AssessedSignal = { rating: null, evidenceIds: [], reasonCode: "evidence_contract_too_old",
      notes: "This evidence predates the v4 evidence contract." };
    return { culturalConnection: unrated, contentRelevance: unrated, goalFit: unrated,
      reviewFlags: [], confidence: "low", mechanism: MECHANISMS[objective][pairType] };
  }
  const culturalConnection = classifyCulturalConnection(evidence);
  const relevance = classifyContentRelevance(evidence, pairType);
  const goalFit = classifyGoalFit(evidence, objective, pairType);
  const reviewFlags = [...relevance.reviewFlags, ...classifyExclusions(evidence).reviewFlags];
  const confidence = adjudicateConfidence(evidence,
    { C: culturalConnection.rating, R: relevance.signal.rating, G: goalFit.rating }, reviewFlags);
  return { culturalConnection, contentRelevance: relevance.signal, goalFit, reviewFlags, confidence,
    mechanism: MECHANISMS[objective][pairType] };
}
