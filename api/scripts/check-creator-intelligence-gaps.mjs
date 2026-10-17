import assert from "node:assert/strict";
import { z } from "zod";
import { creatorCulturalObservations, namedDiscoveryTypes, resolveCreatorBridges, selectCreatorLeads,
  recentNamedTitleCoverage, prioritizeCreatorLeadsBySample,
  creatorSamplePreviewLimit, namedResolutionOrder, creatorPartnerActivity,
  transcriptQuestion } from "../src/creator-research.mjs";
import { chooseCreatorTranscript, extractCreatorMetadata, extractCreatorTranscript, llmJson,
  planCreatorQueries, preserveNamedTitleObservations } from "../src/creator-intelligence.mjs";
import { commercialMetadataForResearch, researchCreatorCommercial } from "../src/creator-commercial.mjs";
import { corroboratedCreatorPage, corroboratedCreatorLinks, verifyCreatorOperator } from "../src/creator-identity.mjs";
import { inspectedPageLinks } from "../src/web-research.mjs";

const karstenChannel = { name: "Karsten Runquist", summary: "toast enthusiast\nkarsten@solaromgmt.com" };
const creatorPage = { url: "https://www.karstenjrunquist.com/contact", inspected: true,
  sourceHash: "a".repeat(64), title: "Contact Karsten Runquist",
  snippet: "Karsten Runquist Contact Me! For sponsorships, email karsten@solaromgmt.com" };
assert.equal(corroboratedCreatorPage(creatorPage, karstenChannel), true);
assert.equal(corroboratedCreatorPage({ ...creatorPage, url: "https://karsten-fan.example/contact" },
  karstenChannel), false, "A name/email copy on an unrelated domain cannot confirm the operator.");
assert.equal(corroboratedCreatorPage({ ...creatorPage, snippet: "Karsten Runquist fan page" },
  karstenChannel), false);
let identitySearches = 0;
const corroborated = await verifyCreatorOperator(karstenChannel, {
  search: async () => { identitySearches += 1; return { results: [],
    leads: [{ url: creatorPage.url, title: creatorPage.title }] }; },
  extract: async () => ({ results: [creatorPage] }),
});
assert.equal(corroborated.kind, "creator");
assert.equal(corroborated.identityEvidence.url, creatorPage.url);
assert.equal(identitySearches, 1);
assert.equal(await verifyCreatorOperator({ name: "Daniel Alves",
  summary: "Football analysis of Daniel Alves" }, {
    search: async () => { throw new Error("A video subject must not trigger identity research."); },
  }), null);
assert.equal(await verifyCreatorOperator(karstenChannel, {
  search: async () => ({ results: [], leads: [] }),
}), null, "Missing corroboration leaves an exact-name channel unresolved.");
assert.equal(await verifyCreatorOperator({ name: "Danni Juhl",
  summary: "Creating a new kind of cinematic universe." }, {
    search: async () => { throw new Error("A matching name is not channel attribution."); },
  }), null, "Without a channel-linked inspected source, Danni's operator identity stays unresolved.");
const danniChannel = { id: "UCkGNihSIqW5eDM4Wukj-t_g", name: "Danni Juhl",
  summary: "Creating a new kind of cinematic universe." };
const portfolio = { url: "https://www.dannijuhl.net/", title: "Danni Juhl", inspected: true,
  sourceHash: "b".repeat(64), snippet: "Danni Juhl director and writer",
  outboundLinks: [{ label: "Follow", url: "https://linktr.ee/dannijuhl" }] };
const tree = { url: "https://linktr.ee/dannijuhl", title: "dannijuhl", inspected: true,
  sourceHash: "c".repeat(64), snippet: "dannijuhl film maker & writer",
  outboundLinks: [
    { label: "Hire me! Film Directing & Editing Portfolio", url: portfolio.url },
    { label: "My YouTube Channel", url: `https://www.youtube.com/channel/${danniChannel.id}` }] };
assert.equal(corroboratedCreatorLinks(portfolio, tree, danniChannel), true);
for (const bad of [
  { ...tree, outboundLinks: tree.outboundLinks.filter((link) => !link.label.includes("Portfolio")) },
  { ...tree, outboundLinks: tree.outboundLinks.map((link) => link.label === "My YouTube Channel"
    ? { ...link, url: "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa" } : link) },
  { ...tree, outboundLinks: tree.outboundLinks.map((link) => link.label === "My YouTube Channel"
    ? { ...link, url: "https://redirect.example/?target=https://www.youtube.com/channel/UCkGNihSIqW5eDM4Wukj-t_g" } : link) },
  { ...tree, outboundLinks: tree.outboundLinks.map((link) => link.label === "My YouTube Channel"
    ? { ...link, label: "Fan review" } : link) },
]) assert.equal(corroboratedCreatorLinks(portfolio, bad, danniChannel), false);
assert.equal(corroboratedCreatorLinks({ ...portfolio, url: "https://dannijuhl-fan.example/" }, tree, danniChannel), false);
let inspectedCalls = 0;
const linkedIdentity = await verifyCreatorOperator(danniChannel, {
  search: async () => ({ results: [], leads: [{ url: portfolio.url, title: portfolio.title }] }),
  inspectLinks: async (url) => { inspectedCalls++;
    return { results: [url === portfolio.url ? portfolio : tree] }; },
});
assert.equal(linkedIdentity.kind, "creator");
assert.equal(linkedIdentity.identityEvidenceChain.length, 2);
assert.equal(inspectedCalls, 2);
const htmlProjection = inspectedPageLinks('<html><title>Danni Juhl</title><body>Danni Juhl director <a href="https://linktr.ee/dannijuhl">Follow</a></body></html>',
  portfolio.url, "Danni Juhl");
assert.equal(htmlProjection.outboundLinks[0].url, tree.url);
assert.equal(inspectedPageLinks('<title>Unrelated</title><a href="https://linktr.ee/dannijuhl">Danni Juhl</a>',
  "http://example.com", "Danni Juhl"), null);

const seed = { tags: [{ id: "tag-hiking", name: "hiking", type: "genre" }] };
const radiohead = { videoId: "abc12345678", phrase: "Radiohead", centrality: "substantive" };
const multiUseFindings = [
  { videoId: "abc12345678", entity: "Arizona Trail", centrality: "central", kind: "cultural_reference" },
  { videoId: "abc12345678", entity: "trail runners", centrality: "central", kind: "product_mention" },
  { videoId: "abc12345678", entity: "filming", centrality: "substantive", kind: "expertise" },
];
assert.deepEqual(creatorCulturalObservations({ culturalSignals: [] }, multiUseFindings)
  .map((item) => item.phrase), ["Arizona Trail"]);
assert.equal(multiUseFindings.length, 3, "Noncultural findings remain available for evidence and capabilities.");
const commercialInput = commercialMetadataForResearch({ collaborationObservations: [] }, [
  ...multiUseFindings,
  { videoId: "abc12345678", entity: "Sponsor Co", kind: "explicit_sponsorship_disclosure",
    sourceUrl: "https://www.youtube.com/watch?v=abc12345678&t=10s", offsetMs: 10000 },
]);
assert.deepEqual(commercialInput.collaborationObservations.map((item) => item.partnerName), ["Sponsor Co"],
  "A generic product mention cannot trigger commercial verification; a named disclosure can.");
assert.deepEqual(selectCreatorLeads([
  { direction: { q: "first" }, leads: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  { direction: { q: "second" }, leads: [{ id: "a" }, { id: "d" }] },
  { direction: { q: "third" }, leads: [{ id: "e" }] },
], 3).map((item) => [item.direction.q, item.lead.id]),
[["first", "a"], ["third", "e"], ["first", "b"]],
"The global lead ceiling rotates through directions and removes duplicate channels.");
const anchoredSelection = selectCreatorLeads([
  { direction: { q: "Half Dome backpacking", signalIds: ["place-id"],
    namedEntityId: "place-id", namedEntityName: "Half Dome", qlooResponseIds: ["response-id"] },
  leads: [
    { id: "glamping", searchSource: { title: "Budget glamping ideas" } },
    { id: "half-dome-guide", searchSource: { title: "HALF DOME | Hiking Guide" } },
    { id: "camp-meals", searchSource: { title: "Camping meals" } },
    { id: "sleeping-bag", searchSource: { title: "Half Dome Sleeping Bag Review" } },
    { id: "half-dome-trip", searchSource: { title: "My First Backpacking Trip (Half Dome in Yosemite)" } },
    { id: "half-dome-hike", searchSource: { title: "Half Dome Hike in Yosemite: My Honest Review" } },
  ] },
  { direction: { q: "folk travel", signalIds: ["folk-id"] },
    leads: [{ id: "cross-category", searchSource: { title: "Folk travel stories" } }] },
], 3);
assert.deepEqual(anchoredSelection.map((item) => item.lead.id),
  ["half-dome-hike", "cross-category", "half-dome-guide"]);
assert.equal(anchoredSelection[0].direction.namedEntityId, "place-id");
assert.deepEqual(namedDiscoveryTypes([{ name: "Narratively Focused", type: "urn:tag:keyword:qloo" },
  { name: "indie rock", type: "urn:tag:keyword:qloo" }]), ["movie", "place"]);
assert.deepEqual(namedDiscoveryTypes([{ name: "Professional Sports", type: "urn:tag:keyword:qloo" }]),
  ["person", "place"]);
assert.deepEqual(namedDiscoveryTypes([{ name: "Sport", type: "urn:tag:genre:other" }]), ["place"],
  "Only Qloo cultural tags determine the extra named entity type.");
const movieSelection = selectCreatorLeads([{ direction: { q: "Eighth Grade film analysis",
  namedEntityId: "movie-id", namedEntityName: "Eighth Grade", namedEntityType: "movie",
  qlooResponseIds: ["movie-response"] }, leads: [
  { id: "unrelated", searchSource: { title: "Best eighth grade school supplies" } },
  { id: "review", searchSource: { title: "Eighth Grade film review and analysis" } },
  { id: "product", searchSource: { title: "Eighth Grade product review sale" } },
] }], 2);
assert.deepEqual(movieSelection.map((item) => item.lead.id), ["review", "unrelated"],
  "A substantive named movie hit is inspected first, without granting a bridge.");
const recentNames = [{ id: "film-id", name: "The Farewell", responseId: "qloo-response" }];
const previews = new Map([
  ["hit-only", { videos: [{ sourceId: "abc12345671", title: "Other movie analysis" }] }],
  ["sampled-film", { videos: [{ sourceId: "abc12345672", title: "The Farewell ending explained" },
    { sourceId: "abc12345673", title: "The Farewell film discussion" }] }],
  ["product", { videos: [{ sourceId: "abc12345674", title: "The Farewell product review discount" }] }],
]);
assert.deepEqual(prioritizeCreatorLeadsBySample(["hit-only", "sampled-film", "product"],
  previews, recentNames), ["sampled-film", "hit-only", "product"],
"A Qloo-named latest-upload title can advance an overlooked lead without changing deep packet count.");
assert.deepEqual(recentNamedTitleCoverage(previews.get("sampled-film"), recentNames),
  { videoCount: 2, entityCount: 1 });
assert.deepEqual(recentNamedTitleCoverage(previews.get("sampled-film"), [
  { id: "film-id", name: "The Farewell", responseId: null }]),
  { videoCount: 0, entityCount: 0 }, "Unproven search terms cannot drive the Qloo-grounded screen.");
assert.equal(creatorSamplePreviewLimit(20, 60), 12);
assert.equal(creatorSamplePreviewLimit(20, 30), 2);
assert.equal(creatorSamplePreviewLimit(20, 24), 0);
const providerRefs = { responseId: "11111111-1111-4111-8111-111111111111", inputHash: "a".repeat(64) };
const description = { ...providerRefs, envelope: { status: "ok", results: [{
  entity_id: "22222222-2222-4222-8222-222222222222", name: "Radiohead" }],
  interpretation: { entity: { entityId: "22222222-2222-4222-8222-222222222222",
    name: "Radiohead", type: "urn:entity:artist", match: "exact" } } } };
const relation = { responseId: "33333333-3333-4333-8333-333333333333", inputHash: "b".repeat(64),
  envelope: { status: "ok", results: [{ entity_id: description.envelope.results[0].entity_id,
    name: "Radiohead", affinity: 0.2 }] } };
const resolve = (metadata, overrides = {}) => resolveCreatorBridges("sample-user",
  "44444444-4444-4444-8444-444444444444", seed, metadata, {
    findTags: async () => ({ status: "empty", tags: [] }),
    describeEntity: async () => description,
    recommendEntities: async () => relation, ...overrides });
const supported = await resolve({ culturalSignals: [radiohead,
  { videoId: "abc12345679", phrase: "Dark River", centrality: "contradictory" }] });
assert.equal(supported.verified.length, 1);
assert.equal(supported.verified[0].kind, "named");
assert.equal(supported.verified[0].classification, "cross_category");
assert.deepEqual(supported.verified[0].qlooRefs.map((ref) => ref.responseId),
  [description.responseId, relation.responseId]);
assert.equal(supported.review[0].status, "contradictory_context");
assert.equal((await resolve({ culturalSignals: [radiohead] }, { describeEntity: async () => ({
  ...description, envelope: { ...description.envelope, interpretation: { entity: {
    ...description.envelope.interpretation.entity, entityId: "another-id" } } } }) })).verified.length, 0);
assert.equal((await resolve({ culturalSignals: [radiohead] }, { describeEntity: async () => ({
  ...description, envelope: { status: "needs_input", results: description.envelope.results } }) })).verified.length, 0);
const missing = await resolve({ culturalSignals: [radiohead] }, { recommendEntities: async () => ({
  ...relation, envelope: { status: "ok", results: [{ entity_id: "other", affinity: 0.99 }] } }) });
assert.equal(missing.verified.length, 0, "A high affinity for another entity is not a bridge.");
assert.equal(missing.review[0].status, "unsupported_pair_projection");
const brandEntityId = "88888888-8888-4888-8888-888888888888";
const brandDescription = { ...description, envelope: { status: "ok", results: [{
  entity_id: brandEntityId, name: "Eleiko", type: "urn:entity:brand" }],
  interpretation: { entity: { entityId: brandEntityId, name: "Eleiko",
    type: "urn:entity:brand", match: "exact" } } } };
const commercialBrandMention = await resolve({ culturalSignals: [{ videoId: "YNEdLArSzyQ",
  phrase: "ELEIKO", centrality: "central", basisField: "description",
  basisText: "Thank you so much ELEIKO for working with me on our home gym." }] }, {
  describeEntity: async () => brandDescription,
  recommendEntities: async () => ({ ...relation, envelope: { status: "ok", results: [{
    entity_id: brandEntityId, name: "Eleiko", affinity: 0.8 }] } }),
  sourceVideos: [{ sourceId: "YNEdLArSzyQ", title: "building my dream gym in my garage" }],
});
assert.equal(commercialBrandMention.verified.length, 0,
  "A Qloo-related equipment sponsor is not a cultural bridge without distinct cultural context.");
assert.equal(commercialBrandMention.review[0].status, "commercial_or_product_reference");
const culturalBrandDiscussion = await resolve({ culturalSignals: [{ videoId: "cultural001",
  phrase: "Eleiko", centrality: "substantive", basisField: "title",
  basisText: "History of Eleiko weightlifting culture" }] }, {
  describeEntity: async () => brandDescription,
  recommendEntities: async () => ({ ...relation, envelope: { status: "ok", results: [{
    entity_id: brandEntityId, name: "Eleiko", affinity: 0.8 }] } }),
  sourceVideos: [{ sourceId: "cultural001", title: "History of Eleiko weightlifting culture" }],
});
assert.equal(culturalBrandDiscussion.verified.length, 1,
  "An independently observed brand history can remain a cultural reference when Qloo supports it.");
const microfilmId = "D8B73762-B498-483D-8D5E-1C2E6834D827";
const microfilmVideo = { sourceId: "vNhgVtoYEfk",
  title: "The Art Of Imperfection - a #microfilm #mentalhealth #cinematic",
  description: "", tags: [] };
const microfilmObservation = { videoId: microfilmVideo.sourceId, phrase: "Microfilm",
  centrality: "central", basisField: "title", basisText: microfilmVideo.title };
const microfilmDescription = { ...description, envelope: { status: "ok", results: [{
  entity_id: microfilmId, name: "Microfilm", type: "urn:entity:artist" }],
  interpretation: { entity: { entityId: microfilmId, name: "Microfilm",
    type: "urn:entity:artist", match: "exact" } } } };
const microfilmRelation = { ...relation, envelope: { status: "ok", results: [{
  entity_id: microfilmId, name: "Microfilm", affinity: 0.8 }] } };
const ambiguousMicrofilm = await resolve({ culturalSignals: [microfilmObservation] }, {
  describeEntity: async () => microfilmDescription,
  recommendEntities: async () => microfilmRelation, sourceVideos: [microfilmVideo] });
assert.equal(ambiguousMicrofilm.verified.length, 0,
  "A generic ‘a #microfilm’ format cannot become Qloo's same-named artist bridge.");
assert.equal(ambiguousMicrofilm.review[0].status, "generic_format_not_named_entity");
const namedMicrofilm = await resolve({ culturalSignals: [{ ...microfilmObservation,
  basisText: "Interview with artist Microfilm about their music" }] }, {
  describeEntity: async () => microfilmDescription,
  recommendEntities: async () => microfilmRelation,
  sourceVideos: [{ ...microfilmVideo, title: "Interview with artist Microfilm about their music" }] });
assert.equal(namedMicrofilm.verified.length, 1,
  "An explicit named artist discussion remains eligible for Qloo validation.");
const mixedMicrofilm = await resolve({ culturalSignals: [microfilmObservation, {
  ...microfilmObservation, videoId: "artistvideo1", basisText: "Interview with artist Microfilm about their music",
}] }, { describeEntity: async () => microfilmDescription,
  recommendEntities: async () => microfilmRelation,
  sourceVideos: [microfilmVideo, { sourceId: "artistvideo1",
    title: "Interview with artist Microfilm about their music" }] });
assert.deepEqual(mixedMicrofilm.verified[0].observations.map((item) => item.videoId), ["artistvideo1"],
  "A real artist discussion cannot rescue a separate generic-format observation.");
assert.deepEqual(creatorPartnerActivity(mixedMicrofilm.verified[0].observations.map((observation) =>
  ({ observation, bridgeId: "bridge:1" })), new Map([
  [microfilmVideo.sourceId, "excluded-source"], ["artistvideo1", "admitted-source"]]), "Danni Juhl")
  .map((item) => item.id), ["video:artistvideo1"],
"Only the admitted observation may produce bridge-linked R activity.");

const filteredPair = { responseId: "55555555-5555-4555-8555-555555555555", inputHash: "c".repeat(64),
  envelope: { status: "ok", results: [{ entity_id: description.envelope.results[0].entity_id,
    name: "Radiohead", subtype: "urn:entity:artist", affinity: 0.3 }] } };
const top20Omission = { recommendEntities: async () => ({ ...relation,
  envelope: { status: "ok", results: [] } }), rankEntity: async (_user, seedId, entityId, type) => {
  assert.equal(seedId, "44444444-4444-4444-8444-444444444444");
  assert.equal(entityId, description.envelope.results[0].entity_id);
  assert.equal(type, "artist");
  return filteredPair;
} };
const recovered = await resolve({ culturalSignals: [radiohead] }, top20Omission);
assert.equal(recovered.verified.length, 1, "A typed, exact-ID filtered Qloo result can recover a top-20 omission.");
assert.deepEqual(recovered.verified[0].qlooRefs.map((ref) => ref.responseId),
  [description.responseId, filteredPair.responseId]);
for (const invalid of [
  { ...filteredPair, envelope: { status: "ok", results: [{ entity_id: "another-id",
    subtype: "urn:entity:artist", affinity: 0.99 }] } },
  { ...filteredPair, envelope: { status: "ok", results: [{ entity_id: description.envelope.results[0].entity_id,
    subtype: "urn:entity:movie", affinity: 0.99 }] } },
  { ...filteredPair, responseId: null },
]) {
  const result = await resolve({ culturalSignals: [radiohead] }, { ...top20Omission,
    rankEntity: async () => invalid });
  assert.equal(result.verified.length, 0, "Wrong ID/type or missing Qloo provenance cannot grant C.");
}

const halfDomeId = "0BF2D589-1C2F-4FEE-82F6-AFD2579BEB8A";
const halfDome = { ...description, envelope: { status: "ok", results: [{
  entity_id: halfDomeId, name: "Half Dome", type: "urn:entity:place" }],
interpretation: { entity: { entityId: halfDomeId, name: "Half Dome",
  type: "urn:entity:place", match: "exact" } } } };
const earlySubjects = Array.from({ length: 8 }, (_, index) => ({
  videoId: `earlyvideo${index}`, phrase: `Old depot ${index}`, centrality: "substantive",
  basisField: "title", basisText: `Old depot ${index} tour` }));
const observedHalfDome = { videoId: "TBMurjUZHLA", phrase: "Half Dome Hike in Yosemite",
  centrality: "central", basisField: "title", basisText: "Half Dome Hike in Yosemite: My Honest Review" };
const resolvedNames = [];
const laterNamedBridge = await resolve({ culturalSignals: [...earlySubjects, observedHalfDome] }, {
  describeEntity: async (_userId, name) => {
    resolvedNames.push(name);
    return name === "Half Dome" ? halfDome : { ...description,
      envelope: { status: "needs_input", results: [] } };
  },
  recommendEntities: async () => ({ ...relation, envelope: { status: "ok",
    results: [{ entity_id: halfDomeId, name: "Half Dome" }] } }),
});
assert.ok(resolvedNames.includes("Half Dome"), "A later sampled video must reach named resolution.");
assert.deepEqual(laterNamedBridge.verified.map((item) => item.tag.name), ["Half Dome"]);
assert.equal(laterNamedBridge.verified[0].observations[0].videoId, "TBMurjUZHLA");
assert.deepEqual(creatorCulturalObservations({ culturalSignals: [observedHalfDome] }, [
  { videoId: "earlierCaption", entity: "Old depot", centrality: "substantive", kind: "cultural_reference" },
]).map((item) => item.phrase), ["Half Dome Hike in Yosemite", "Old depot"]);
const noSourceAnchor = await resolve({ culturalSignals: [{ ...observedHalfDome,
  basisText: "Unrelated mountain hike" }] }, {
  describeEntity: async (_userId, name) => name === "Half Dome" ? halfDome : { ...description,
    envelope: { status: "needs_input", results: [] } },
});
assert.equal(noSourceAnchor.verified.length, 0, "A prefix must be present in the official video title.");
const moviePrefix = await resolve({ culturalSignals: [{ ...observedHalfDome,
  phrase: "Free Solo Climb", basisText: "Free Solo Climb review" }] }, {
  describeEntity: async (_userId, name) => name === "Free Solo" ? { ...description,
    envelope: { ...description.envelope, results: [{ ...description.envelope.results[0],
      name: "Free Solo", type: "urn:entity:movie" }], interpretation: { entity: {
      ...description.envelope.interpretation.entity, name: "Free Solo", type: "urn:entity:movie" } } } }
    : { ...description, envelope: { status: "needs_input", results: [] } },
});
assert.equal(moviePrefix.verified.length, 0, "Editorial suffixes cannot promote an inferred movie reference.");
const unsupportedHalfDome = await resolve({ culturalSignals: [observedHalfDome] }, {
  describeEntity: async (_userId, name) => name === "Half Dome" ? halfDome : description,
  recommendEntities: async () => ({ ...relation, envelope: { status: "ok", results: [] } }),
});
assert.equal(unsupportedHalfDome.verified.length, 0, "The Qloo brand relation remains mandatory.");

const midsommarId = "B6D76FFA-A387-4B93-B56A-50575C698643";
const midsommarLead = { videoId: "S7L7v7TuZ0A", title: "MIDSOMMAR (2019) Breakdown | Film Analysis",
  namedEntityId: midsommarId, namedEntityName: "Midsommar", namedEntityType: "movie",
  qlooResponseIds: ["actual-qloo-response"] };
const ambiguousFilm = { envelope: { status: "needs_input", results: [], resolution: { issues: [{
  candidates: [{ id: midsommarId, name: "Midsommar", type: "urn:entity:movie",
    release_year: 2019 }, { id: "095A64BB-E6DF-4E1A-A7EF-F9C6794D4CEC",
    name: "Midsommar", type: "urn:entity:movie", release_year: 1991 }] }] } } };
const identifiedFilm = { ...description, envelope: { status: "ok", results: [{
  entity_id: midsommarId, name: "Midsommar", type: "urn:entity:movie" }],
interpretation: { entity: { entityId: midsommarId, name: "Midsommar",
  type: "urn:entity:movie", match: "identifier" } } } };
const filmObservation = { videoId: midsommarLead.videoId, phrase: "Midsommar", centrality: "central" };
const filmResolution = (lead, observations = [filmObservation]) => resolveCreatorBridges(
  "sample-user", "44444444-4444-4444-8444-444444444444", seed,
  { culturalSignals: observations }, { findTags: async () => ({ status: "empty", tags: [] }),
    describeEntity: async (_userId, query) => query === midsommarId ? identifiedFilm : ambiguousFilm,
    recommendEntities: async () => ({ ...relation, envelope: { status: "ok",
      results: [{ entity_id: midsommarId, name: "Midsommar" }] } }), discoveryLead: lead });
assert.deepEqual((await filmResolution(midsommarLead)).verified.map((item) => item.qlooId),
  [midsommarId], "Spoken film, dated title and exact Qloo choice resolve the ambiguous name.");
assert.equal((await filmResolution({ ...midsommarLead, title: "MIDSOMMAR (1991) Breakdown" }))
  .verified.length, 0, "A title year conflicting with the Qloo anchor cannot resolve identity.");
assert.equal((await filmResolution(midsommarLead, [{ ...filmObservation, videoId: "anothervideo" }]))
  .verified.length, 0, "A search hit cannot substitute for an observation from that video.");
assert.equal((await filmResolution({ ...midsommarLead, namedEntityId: "wrong-id" })).verified.length, 0,
  "A Qloo choice cannot be taken from a mismatched ID.");
assert.equal((await resolveCreatorBridges("sample-user", "44444444-4444-4444-8444-444444444444",
  seed, { culturalSignals: [filmObservation] }, {
    findTags: async () => ({ status: "empty", tags: [] }),
    describeEntity: async (_userId, query) => query === midsommarId ? identifiedFilm : ambiguousFilm,
    recommendEntities: async () => ({ ...relation, envelope: { status: "ok", results: [] } }),
    discoveryLead: midsommarLead })).verified.length, 0,
"A resolved movie still needs an actual Qloo seed-brand relationship.");

const socialId = "74C401D6-D3B3-4B08-BBC3-22A9F13E40C7";
const socialPhrase = "The Social Network";
const socialObservation = { videoId: "d0dxBTyZm-M", phrase: socialPhrase, centrality: "central",
  basisField: "title", basisText: "They Made a Sequel to 'The Social Network'...It's Weird" };
const socialAmbiguity = { envelope: { status: "needs_input", results: [], resolution: { issues: [{
  candidates: [{ id: socialId, name: socialPhrase, type: "urn:entity:movie", release_year: 2010 },
    { id: "album-id", name: socialPhrase, type: "urn:entity:album" }] }] } } };
const socialIdentity = { ...description, envelope: { status: "ok", results: [{
  entity_id: socialId, name: socialPhrase, type: "urn:entity:movie" }],
interpretation: { entity: { entityId: socialId, name: socialPhrase,
  type: "urn:entity:movie", match: "identifier" } } } };
const sampledSocial = { sourceId: socialObservation.videoId, title: socialObservation.basisText,
  tags: ["Movie", "Film", "Cinema"] };
const socialDeps = { findTags: async () => ({ status: "empty", tags: [] }),
  describeEntity: async (_user, query) => query === socialId ? socialIdentity : socialAmbiguity,
  recommendEntities: async () => ({ ...relation, envelope: { status: "ok", results: [] } }),
  rankEntity: async () => ({ ...filteredPair, envelope: { status: "ok", results: [{
    entity_id: socialId, subtype: "urn:entity:movie", affinity: 0.3 }] } }),
  sourceVideos: [sampledSocial] };
assert.deepEqual((await resolveCreatorBridges("sample-user", "44444444-4444-4444-8444-444444444444",
  seed, { culturalSignals: [socialObservation] }, socialDeps)).verified.map((item) => item.qlooId),
  [socialId], "An exact sampled film title and official film tags can disambiguate an album homonym.");
assert.equal((await resolveCreatorBridges("sample-user", "44444444-4444-4444-8444-444444444444",
  seed, { culturalSignals: [socialObservation] }, { ...socialDeps,
    sourceVideos: [{ ...sampledSocial, tags: ["Music"] }] })).verified.length, 0,
"A name in a music video must remain ambiguous without film source context.");

const old = [process.env.LLM_API_URL, process.env.LLM_API_KEY, process.env.LLM_MODEL,
  process.env.LLM_PROVIDER];
process.env.LLM_PROVIDER = "openai";
process.env.LLM_API_URL = "https://llm.example.test";
process.env.LLM_API_KEY = "sample-key";
process.env.LLM_MODEL = "sample-model";
const reply = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: {
  content: JSON.stringify(content) } }] }) });
try {
  const spokenFilm = [{ offsetMs: 47960, durationMs: 3200,
    text: "The film Midsommar uses this ritual as its central idea." }];
  let focusedCalls = 0;
  const focusedFilm = await extractCreatorTranscript("S7L7v7TuZ0A", spokenFilm, {
    focusEntityName: "Midsommar", fetchFn: async () => reply(++focusedCalls === 1 ? { findings: [] } : {
      findings: [{ offsetMs: 47960, phrase: "Midsommar", centrality: "central",
        kind: "cultural_reference" }] }) });
  assert.equal(focusedCalls, 2, "An omitted spoken named hit receives one bounded focused check.");
  assert.deepEqual(focusedFilm.map((item) => [item.entity, item.offsetMs, item.kind]),
    [["Midsommar", 47960, "cultural_reference"]]);
  let titleOnlyCalls = 0;
  const titleOnlyFilm = await extractCreatorTranscript("S7L7v7TuZ0A", [{
    offsetMs: 47960, durationMs: 3200, text: "This ritual is central to the story." }], {
    focusEntityName: "Midsommar", fetchFn: async () => {
      titleOnlyCalls += 1; return reply({ findings: [] });
    } });
  assert.equal(titleOnlyCalls, 1, "A search title cannot cause a caption-only focused check.");
  assert.deepEqual(titleOnlyFilm, []);
  let productCalls = 0;
  const retainedProduct = await extractCreatorTranscript("S7L7v7TuZ0A", spokenFilm, {
    focusEntityName: "Midsommar", fetchFn: async () => {
      productCalls += 1;
      return reply({ findings: [{ offsetMs: 47960, phrase: "Midsommar",
        centrality: "incidental", kind: "product_mention" }] });
    } });
  assert.equal(productCalls, 2);
  assert.deepEqual(retainedProduct.map((item) => item.kind), ["product_mention"],
    "A product observation remains available for R/G but cannot become a cultural bridge.");
  let plannedTagIds;
  const planned = await planCreatorQueries({ brandName: "Sample Outdoor Brand",
    objective: "content_collaboration", tags: [
      { id: "place-burger", name: "Burger", type: "urn:tag:specialty_dish:place" },
      { id: "culture-outdoor", name: "Outdoor Clothing", type: "urn:tag:keyword:qloo" },
      { id: "culture-environment", name: "Environmental Activism", type: "urn:tag:keyword:qloo" },
    ] }, { fetchFn: async (_url, init) => {
      plannedTagIds = JSON.parse(JSON.parse(init.body).messages[1].content).tags.map((item) => item.id);
      return reply({ queries: [{ q: "US outdoor clothing video makers",
        signalIds: ["culture-outdoor"], rationale: "The supplied cultural tag supports this direction." }] });
    } });
  assert.deepEqual(plannedTagIds, ["culture-outdoor", "culture-environment"]);
  assert.equal(planned.length, 1);
  const namedPlan = await planCreatorQueries({ brandName: "Hipcamp",
    objective: "content_collaboration", tags: [{ id: "tag-documentary", name: "Documentary" }],
    namedPlaces: [{ id: halfDomeId, name: "Half Dome" }],
    namedResponseId: relation.responseId }, { fetchFn: async (_url, init) => {
      const supplied = JSON.parse(JSON.parse(init.body).messages[1].content);
      assert.deepEqual(supplied.namedPlaces, [{ id: halfDomeId, name: "Half Dome" }]);
      return reply({ queries: [
        { q: "Half Dome hiking documentary creator", signalIds: [halfDomeId],
          rationale: "A Qloo-returned named place guides this source search." },
        { q: "inexpensive women-owned campgrounds near Half Dome", signalIds: [halfDomeId],
          rationale: "Unrelated constraints must not narrow this place search." },
        { q: "Half Dome hiking with unrelated tag", signalIds: [halfDomeId, "tag-documentary"],
          rationale: "A named search cannot inherit unrelated Qloo tag constraints." },
        { q: "Half Dome backpacking trip", signalIds: [halfDomeId],
          rationale: "A second activity variation for the named place." },
        { q: "Yosemite hiking documentary creator", signalIds: [halfDomeId],
          rationale: "This omits the supplied place name and must be rejected." },
      ] });
    } });
  assert.equal(namedPlan.length, 2);
  assert.equal(namedPlan[0].plannerVersion, "creator-search-v4");
  assert.equal(namedPlan[0].namedEntityId, halfDomeId);
  assert.equal(namedPlan[0].namedEntityName, "Half Dome");
  assert.deepEqual(namedPlan[0].qlooResponseIds, [relation.responseId]);
  const typedPlan = await planCreatorQueries({ brandName: "A24",
    objective: "content_collaboration", tags: [{ id: "tag-narrative", name: "Narratively Focused",
      type: "urn:tag:keyword:qloo" }], namedEntities: [
      { id: "movie-id", name: "Eighth Grade", type: "movie", responseId: "movie-response" },
      { id: "place-id", name: "New Museum", type: "place", responseId: "place-response" },
    ] }, { fetchFn: async () => reply({ queries: [
      { q: "Eighth Grade film analysis", signalIds: ["movie-id"],
        rationale: "The Qloo movie relationship supports this search subject." },
      { q: "Eighth Grade cheap product review", signalIds: ["movie-id"],
        rationale: "Unrelated product language must be rejected." },
      { q: "New Museum documentary", signalIds: ["place-id"],
        rationale: "A separate place anchor remains available." },
    ] }) });
  assert.deepEqual(typedPlan.map((item) => [item.namedEntityType, item.qlooResponseIds[0]]),
    [["movie", "movie-response"], ["place", "place-response"]]);
  const personFallback = await planCreatorQueries({ brandName: "Sample Sports Brand",
    objective: "content_collaboration", tags: [{ id: "sport-tag", name: "Professional Sports",
      type: "urn:tag:lifestyle:qloo" }], namedEntities: [
      { id: "person-id", name: "Andrés Iniesta", type: "person", responseId: "person-response" },
    ] }, { fetchFn: async () => reply({ queries: [
      { q: "professional sports training stories", signalIds: ["sport-tag"],
        rationale: "The broad sports tag supports this search direction." },
    ] }) });
  assert.deepEqual(personFallback.map((item) => [item.q, item.namedEntityType,
    item.qlooResponseIds]), [
    ["Andrés Iniesta career analysis", "person", ["person-response"]],
    ["professional sports training stories", null, []],
  ], "An omitted Qloo person anchor gets one exact, provenance-linked retrieval direction.");
  const unsupportedProperName = await planCreatorQueries({ brandName: "Sample Sports Brand",
    objective: "content_collaboration", tags: [{ id: "sport-tag", name: "Professional Sports",
      type: "urn:tag:lifestyle:qloo" }], namedEntities: [
      { id: "person-id", name: "Andrés Iniesta", type: "person", responseId: "person-response" },
    ] }, { fetchFn: async () => reply({ queries: [
      { q: "Serena Williams training analysis", signalIds: ["sport-tag"],
        rationale: "An unsupported named subject must not ride on a broad tag." },
      { q: "Andrés Iniesta career analysis", signalIds: ["sport-tag"],
        rationale: "Even a supplied entity needs its exact named signal ID." },
      { q: "Professional Sports training analysis", signalIds: ["sport-tag"],
        rationale: "This exact supplied tag may appear in the query." },
    ] }) });
  assert.deepEqual(unsupportedProperName.map((item) => item.q),
    ["Andrés Iniesta career analysis", "Professional Sports training analysis"]);
  const noisyNamedPlan = await planCreatorQueries({ brandName: "Example Studio",
    objective: "content_collaboration", tags: [{ id: "film-tag", name: "Filmmaker",
      type: "urn:tag:occupation:qloo" }], namedEntities: [
      { id: "film-one", name: "Sample Film", type: "movie", responseId: "film-source" },
      { id: "place-one", name: "Sample Museum", type: "place", responseId: "place-source" },
    ] }, { fetchFn: async () => reply({ queries: [
      { q: "Sample Film review analysis emotional authenticity", signalIds: ["film-one"],
        rationale: "The exact film is a supported cultural search subject." },
      { q: "Sample Museum visit meditative space design", signalIds: ["place-one"],
        rationale: "The exact place is a supported cultural search subject." },
      { q: "Filmmaker storytelling video essay", signalIds: ["film-tag"],
        rationale: "This broad occupation can support an exploratory search." },
    ] }) });
  assert.deepEqual(noisyNamedPlan.map((item) => item.q), [
    "Sample Film review analysis", "Sample Museum visit guide", "Filmmaker storytelling video essay"]);
  assert.deepEqual(noisyNamedPlan.slice(0, 2).map((item) => item.qlooResponseIds[0]),
    ["film-source", "place-source"]);
  const missingTerritoryPlan = await planCreatorQueries({ brandName: "Example Sports Brand",
    objective: "content_collaboration", tags: [{ id: "sport-tag", name: "Professional Sports",
      type: "urn:tag:lifestyle:qloo" }], namedEntities: [
      { id: "person-one", name: "Sample Player", type: "person", responseId: "person-source" },
      { id: "place-one", name: "Sample Museum", type: "place", responseId: "place-source" },
    ] }, { fetchFn: async () => reply({ queries: [
      { q: "Professional Sports training analysis", signalIds: ["sport-tag"],
        rationale: "An exploratory sports format from the supplied tag." },
    ] }) });
  assert.deepEqual(missingTerritoryPlan.map((item) => [item.q, item.qlooResponseIds[0] ?? null]), [
    ["Sample Museum visit guide", "place-source"],
    ["Sample Player career analysis", "person-source"],
    ["Professional Sports training analysis", null],
  ]);
  const lodgingFallbackPlan = await planCreatorQueries({ brandName: "Example Sports Brand",
    objective: "content_collaboration", tags: [{ id: "sport-tag", name: "Professional Sports",
      type: "urn:tag:lifestyle:qloo" }], namedEntities: [
      { id: "person-one", name: "First Player", type: "person", responseId: "person-source" },
      { id: "person-two", name: "Second Player", type: "person", responseId: "person-source" },
      { id: "hotel-one", name: "Golden Hotel", type: "place", responseId: "place-source" },
    ] }, { fetchFn: async () => reply({ queries: [
      { q: "Professional Sports training analysis", signalIds: ["sport-tag"],
        rationale: "An exploratory sports format from the supplied tag." },
    ] }) });
  assert.deepEqual(lodgingFallbackPlan.map((item) => item.q), [
    "First Player career analysis", "Second Player career analysis",
    "Professional Sports training analysis"]);
  const profile = { name: "Sample Creator", videos: [{ sourceId: "abc12345678", title: "Latest upload",
    publishedAt: "2026-10-01T00:00:00Z" }] };
  let options;
  const selected = await chooseCreatorTranscript(profile, { culturalSignals: [] }, seed.tags, [],
    "Does the discovery hit clarify an open cultural question?", {
      targetedVideos: [{ sourceId: "abc12345680", title: "Older discovered subject",
        sourceRole: "discovery_hit", publishedAt: "2026-08-01T00:00:00Z" }],
      fetchFn: async (_url, init) => { options = JSON.parse(JSON.parse(init.body).messages[1].content).options;
        return reply({ choice: { videoId: "abc12345680", researchQuestion: "Clarify the cultural reference.",
          whyThisVideo: "The discovered video names the subject.",
          predictedDecisionImpact: "The result may confirm a source-backed bridge." } }); },
    });
  assert.equal(selected.videoId, "abc12345680");
  assert.deepEqual(options.map((item) => item.sourceRole), ["representative_sample", "discovery_hit"]);
  const filmPacket = { objective: "content_collaboration", profile,
    discoveryLead: { videoId: "abc12345680", namedEntityName: "Midsommar",
      namedEntityType: "movie", namedEntityId: "qloo-movie", qlooResponseIds: ["qloo-response"] },
    metadata: { sourceCoverage: { failedBatches: 0 }, culturalSignals: [],
      demonstratedFormats: [], collaborationObservations: [] }, transcriptFindings: [] };
  assert.match(transcriptQuestion(filmPacket, seed.tags), /Midsommar/,
    "An out-of-sample Qloo-named film hit must remain an explicit unresolved caption question.");
  assert.doesNotMatch(transcriptQuestion({ ...filmPacket, discoveryLead: {
    ...filmPacket.discoveryLead, qlooResponseIds: [] } }, seed.tags), /Midsommar/,
  "An unproven search subject must not be promoted to a Qloo-anchored question.");
  assert.doesNotMatch(transcriptQuestion({ ...filmPacket, profile: { ...profile,
    videos: [...profile.videos, { sourceId: "abc12345680" }] } }, seed.tags), /Midsommar/,
  "A hit already in the representative sample is not a separate targeted question.");
  const personPacket = { ...filmPacket, discoveryLead: { ...filmPacket.discoveryLead,
    namedEntityName: "Daniel Alves", namedEntityType: "person" } };
  assert.match(transcriptQuestion(personPacket, seed.tags), /Daniel Alves/);
  assert.deepEqual(creatorCulturalObservations(personPacket.metadata, personPacket.transcriptFindings), [],
    "A named person in a discovery query is only a research question, never a creator observation or channel owner.");
  let extractedIds;
  const resumed = await extractCreatorMetadata({ ...profile, videos: [
    { sourceId: "abc12345678", title: "Latest upload", description: "Existing sample video" },
    { sourceId: "abc12345679", title: "Another upload", description: "Missing sample video" }] }, {
    reusable: { culturalSignals: [], demonstratedFormats: [], collaborationObservations: [],
      sourceCoverage: { extractedVideoIds: ["abc12345678"] } },
    fetchFn: async (_url, init) => {
      extractedIds = JSON.parse(JSON.parse(init.body).messages[1].content).videos.map((item) => item.videoId);
      return reply({ culturalSignals: [], demonstratedFormats: [], collaborationObservations: [] });
    } });
  assert.deepEqual(extractedIds, ["abc12345679"]);
  assert.equal(resumed.sourceCoverage.extracted, 2);
  assert.equal(resumed.sourceCoverage.reused, 1);
  const titleOnly = await extractCreatorMetadata({ id: "UC1234567890123456789012", name: "Sample creator",
    videos: [{ sourceId: "TBMurjUZHLA", title: "Half Dome Hike in Yosemite: My Honest Review",
      description: "", tags: [] }, { sourceId: "badtitle001", title: "Half Dome Hike Warning",
      description: "", tags: [] }] }, {
    fetchFn: async () => reply({ culturalSignals: [], demonstratedFormats: [], collaborationObservations: [] }),
  });
  assert.deepEqual(titleOnly.culturalSignals.map((item) => [item.videoId, item.phrase, item.basisField]),
    [["TBMurjUZHLA", "Half Dome", "title"]],
  "A source-grounded named title survives a valid but incomplete model response; a warning stays for review.");
  assert.equal(titleOnly.extractionVersion, "creator-metadata-v4");
  let seenMicrofilmInput;
  const extractedMicrofilm = await extractCreatorMetadata({ id: "UC1234567890123456789012",
    name: "Danni Juhl", videos: [microfilmVideo] }, { fetchFn: async (_url, init) => {
      seenMicrofilmInput = JSON.parse(JSON.parse(init.body).messages[1].content).videos[0];
      return reply({ culturalSignals: [microfilmObservation], demonstratedFormats: [],
        collaborationObservations: [] });
    } });
  assert.deepEqual([seenMicrofilmInput.videoId, seenMicrofilmInput.title,
    seenMicrofilmInput.description, seenMicrofilmInput.tags],
  [microfilmVideo.sourceId, microfilmVideo.title, "", []],
  "The actual official title reaches Qwen without added artist context.");
  assert.equal((await resolve({ culturalSignals: extractedMicrofilm.culturalSignals }, {
    describeEntity: async () => microfilmDescription,
    recommendEntities: async () => microfilmRelation,
    sourceVideos: [microfilmVideo] })).verified.length, 0);
  const ronaldinho = { sourceId: "-JvPjTJkF60",
    title: "Neymar & Ronaldinho Were UNSTOPPABLE at Barcelona 👑",
    description: "Ronaldinho & Neymar Was The Greatest Joga Bonito in History 👑",
    tags: ["neymar", "ronaldinho"] };
  const omitted = await extractCreatorMetadata({ id: "UC1234567890123456789012",
    name: "Sample football creator", summary: "Film and football analysis",
    videos: [ronaldinho] }, { fetchFn: async () => reply({
      culturalSignals: [{ videoId: ronaldinho.sourceId, phrase: "Neymar",
        centrality: "substantive", basisField: "title", basisText: ronaldinho.title }],
      demonstratedFormats: [], collaborationObservations: [] }) });
  assert.deepEqual(omitted.culturalSignals.map((item) => item.phrase),
    ["Neymar", "Ronaldinho"],
    "A second explicit title subject survives a valid Qwen response that names only the first.");
  assert.equal(omitted.culturalSignals[1].videoId, ronaldinho.sourceId);
  assert.equal(omitted.culturalSignals[1].basisText, ronaldinho.title);
  assert.equal(omitted.culturalSignals[1].extractionMethod, "official_title_preservation");
  assert.equal(omitted.culturalSignals[1].centrality, "central",
    "An explicit paired title subject repeated in description/tags has stable centrality.");
  const qwenRonaldinho = await extractCreatorMetadata({ id: "UC1234567890123456789012",
    name: "Sample football creator", videos: [ronaldinho] }, { fetchFn: async () => reply({
      culturalSignals: [{ videoId: ronaldinho.sourceId, phrase: "Ronaldinho",
        centrality: "substantive", basisField: "title", basisText: ronaldinho.title }],
      demonstratedFormats: [], collaborationObservations: [] }) });
  assert.equal(qwenRonaldinho.culturalSignals[0].centrality, "central",
    "The same official title must not receive lower R solely because Qwen chose substantive.");
  assert.deepEqual(preserveNamedTitleObservations({ sourceId: "filmvideo01",
    title: "Eighth Grade film analysis", description: "Eighth Grade is discussed as a film." })
    .map((item) => item.phrase), ["Eighth Grade"]);
  assert.deepEqual(preserveNamedTitleObservations({ sourceId: "filmvideo02",
    title: "The Farewell film review", description: "The Farewell is examined scene by scene." })
    .map((item) => item.phrase), ["The Farewell"]);
  assert.deepEqual(preserveNamedTitleObservations({ sourceId: "placevideo1",
    title: "Half Dome hiking guide", description: "A guide to Half Dome." })
    .map((item) => item.phrase), ["Half Dome"]);
  assert.deepEqual(preserveNamedTitleObservations({ sourceId: "otherperson",
    title: "New football highlights", description: "Unrelated Ronaldinho news." }), [],
  "A description-only name is not promoted to a source-observed cultural subject.");
  assert.deepEqual(preserveNamedTitleObservations({ ...ronaldinho,
    title: "Neymar & Ronaldinho Were FAKE at Barcelona" }), [],
  "Contradictory title language is left for contextual research.");
  assert.deepEqual(preserveNamedTitleObservations({ ...ronaldinho,
    description: "A video about football generally", tags: [] }), [],
  "A title keyword without corroborating video metadata is not enough.");
  const ambiguousTitle = preserveNamedTitleObservations({ sourceId: "ambiguous01",
    title: "Roma film analysis", description: "A discussion of Roma as a film." });
  assert.deepEqual(ambiguousTitle.map((item) => item.phrase), ["Roma"]);
  assert.equal((await resolve({ culturalSignals: ambiguousTitle }, {
    describeEntity: async () => ({ ...description,
      envelope: { status: "needs_input", results: [], resolution: { issues: [
        { candidates: [{ id: "movie-roma", name: "Roma", type: "urn:entity:movie" },
          { id: "place-roma", name: "Roma", type: "urn:entity:place" }] }] } } }),
  })).verified.length, 0, "An exact title observation cannot bypass ambiguous Qloo identity.");
  const budgeted = Array.from({ length: 30 }, (_, index) => ({ phrase: `Other ${index}`,
    observations: [{ videoId: `video${String(index).padStart(6, "0")}` }] }));
  budgeted.push({ phrase: "Ronaldinho", observations: omitted.culturalSignals.filter((item) =>
    item.phrase === "Ronaldinho") });
  assert.ok(namedResolutionOrder(budgeted).some((item) => item.phrase === "Ronaldinho"),
    "An exact title-preserved name survives the bounded Qloo resolution queue.");
  const ronaldinhoId = "E9B81FE2-F5FE-41C3-8CCA-67A28BF46C7D";
  const ronaldinhoDescription = { ...description, envelope: { status: "ok", results: [{
    entity_id: ronaldinhoId, name: "Ronaldinho", type: "urn:entity:person" }],
    interpretation: { entity: { entityId: ronaldinhoId, name: "Ronaldinho",
      type: "urn:entity:person", match: "exact" } } } };
  const ronaldinhoPair = { ...filteredPair, envelope: { status: "ok", results: [{
    entity_id: ronaldinhoId, name: "Ronaldinho", subtype: "urn:entity:person", affinity: 0.2 }] } };
  const resolveRonaldinho = (signals) => resolve({ culturalSignals: signals }, {
    describeEntity: async (_user, phrase) => phrase === "Ronaldinho"
      ? ronaldinhoDescription : { ...description, envelope: { status: "needs_input", results: [] } },
    recommendEntities: async () => ({ ...relation, envelope: { status: "ok", results: [] } }),
    rankEntity: async (_user, _brand, id, type) => id === ronaldinhoId && type === "person"
      ? ronaldinhoPair : { ...ronaldinhoPair, envelope: { status: "empty", results: [] } },
  });
  const discoveryResolved = await resolveRonaldinho(omitted.culturalSignals);
  const directResolved = await resolveRonaldinho((await extractCreatorMetadata({
    id: "UC1234567890123456789012", name: "Sample football creator", videos: [ronaldinho],
  }, { reusable: omitted })).culturalSignals);
  assert.deepEqual(discoveryResolved.verified.map((item) => item.qlooId), [ronaldinhoId]);
  assert.deepEqual(directResolved.verified.map((item) => item.qlooId), [ronaldinhoId],
    "The same sampled observation remains admissible in discovery and direct comparison.");
  assert.deepEqual(discoveryResolved.verified[0].qlooRefs.map((item) => item.responseId),
    [ronaldinhoDescription.responseId, ronaldinhoPair.responseId]);
  assert.equal((await resolveRonaldinho([{ ...omitted.culturalSignals[1],
    centrality: "incidental" }])).verified.length, 0,
  "An incidental source mention cannot become a bridge solely because Qloo returns the person.");
  const titleMovie = await extractCreatorMetadata({ id: "UC1234567890123456789012", name: "Sample creator",
    videos: [{ sourceId: "movievideo1", title: "Free Solo Climb in Yosemite",
      description: "", tags: [] }] }, {
    fetchFn: async () => reply({ culturalSignals: [], demonstratedFormats: [], collaborationObservations: [] }),
  });
  assert.equal((await resolve({ culturalSignals: titleMovie.culturalSignals }, {
    describeEntity: async () => ({ ...description, envelope: { status: "ok", results: [{
      entity_id: description.envelope.results[0].entity_id, name: "Free Solo", type: "urn:entity:movie" }],
    interpretation: { entity: { entityId: description.envelope.results[0].entity_id,
      name: "Free Solo", type: "urn:entity:movie", match: "exact" } } } }),
    recommendEntities: async () => relation,
  })).verified.length, 0, "A deterministic climb title cannot turn a same-named film into a bridge.");
  assert.equal(transcriptQuestion({ objective: "content_collaboration", metadata: {
    sourceCoverage: { failedBatches: 0 }, culturalSignals: [{ ...radiohead, centrality: "unknown" }],
    demonstratedFormats: [], collaborationObservations: [] }, transcriptFindings: [] }, seed.tags),
  "Does spoken context establish whether the observed cultural reference is substantive, incidental, or critical?");
  assert.match(transcriptQuestion({ objective: "content_collaboration", metadata: {
    sourceCoverage: { failedBatches: 1 }, culturalSignals: [radiohead],
    demonstratedFormats: [], collaborationObservations: [] }, transcriptFindings: [] }, []),
  /named cultural subject/, "A partial metadata failure must not erase a source-observed named question.");
  assert.equal(transcriptQuestion({ objective: "content_collaboration", metadata: {
    sourceCoverage: { failedBatches: 0 }, culturalSignals: [radiohead],
    demonstratedFormats: [{ videoId: radiohead.videoId }], collaborationObservations: [] },
    transcriptFindings: [{ videoId: "abc12345679", entity: "Radiohead",
      centrality: "substantive", kind: "cultural_reference" }] }, []), null,
  "Two independent videos resolve the named-subject question without repeated caption requests.");
  const schema = z.object({ ok: z.boolean() });
  let calls = 0;
  const retried = await llmJson("test", {}, schema, { sleepFn: async () => {},
    fetchFn: async () => ++calls === 1 ? { status: 429, headers: { get: () => "0" } } : reply({ ok: true }) });
  assert.equal(retried.ok, true);
  assert.equal(calls, 2);
  await llmJson("record token window", {}, schema, { fetchFn: async () => ({
    ...reply({ ok: true }), headers: { get: (name) => name === "x-ratelimit-remaining-tokens" ? "1"
      : name === "x-ratelimit-reset-tokens" ? "2s" : null } }) });
  let paced = 0;
  await llmJson("paced request", {}, schema, { fetchFn: async () => reply({ ok: true }),
    sleepFn: async (ms) => { paced = ms; } });
  assert.ok(paced >= 1000 && paced <= 3000, "The next request waits for the token reset window.");
  let active = 0; let peak = 0;
  const serialized = async () => { active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1; return reply({ ok: true }); };
  await Promise.all([llmJson("one", {}, schema, { fetchFn: serialized }),
    llmJson("two", {}, schema, { fetchFn: serialized })]);
  assert.equal(peak, 1);
  const previousProvider = [process.env.LLM_PROVIDER, process.env.LLM_FALLBACK_PROVIDER];
  try {
    process.env.LLM_PROVIDER = "bedrock";
    process.env.LLM_FALLBACK_PROVIDER = "openai";
    let bedrockCalls = 0; let fallbackCalls = 0;
    const bedrockResult = await llmJson("bedrock", {}, schema, {
      bedrockSendFn: async (command) => { bedrockCalls += 1;
        assert.equal(command.input.modelId, "qwen.qwen3-next-80b-a3b");
        return { output: { message: { content: [{ text: '{"ok":true}' }] } } }; },
      fetchFn: async () => { fallbackCalls += 1; return reply({ ok: false }); },
    });
    assert.equal(bedrockResult.ok, true);
    assert.equal(bedrockCalls, 1);
    assert.equal(fallbackCalls, 0);
    let repairCalls = 0;
    const repaired = await llmJson("strict schema", {}, schema, {
      bedrockSendFn: async () => { repairCalls += 1; return { output: { message: { content: [
        { text: repairCalls === 1 ? '{"ok":"yes"}' : '{"ok":true}' }] } } }; },
      fetchFn: async () => { throw new Error("Validation is not a provider outage."); },
    });
    assert.equal(repaired.ok, true);
    assert.equal(repairCalls, 2);
    const fallbackResult = await llmJson("fallback", {}, schema, {
      bedrockSendFn: async () => { throw Object.assign(new Error("throttled"), { name: "ThrottlingException" }); },
      sleepFn: async () => {}, fetchFn: async () => { fallbackCalls += 1; return reply({ ok: true }); },
    });
    assert.equal(fallbackResult.ok, true);
    assert.equal(fallbackCalls, 1);
    const recoveryProfile = { name: "Sample Creator", summary: "Independent creator",
      videos: Array.from({ length: 5 }, (_, index) => ({
        sourceId: `abc1234567${index}`, title: `Video ${index} about hiking`,
        description: `Video ${index} about hiking`, tags: [] })) };
    let batchCalls = 0; let singleCalls = 0;
    const recoveredMetadata = await extractCreatorMetadata(recoveryProfile, {
      bedrockSendFn: async (command) => {
        const requested = JSON.parse(command.input.messages[0].content[0].text).videos;
        if (requested.length > 1) { batchCalls += 1;
          return { output: { message: { content: [{ text: '{"culturalSignals":[],"demonstratedFormats":[],"collaborationObservations":[{"videoId":"abc12345670","kind":"unknown","partnerName":null,"basisField":"channel","basisText":"bad"}]}' }] } } }; }
        singleCalls += 1;
        return { output: { message: { content: [{ text: JSON.stringify({ culturalSignals: [],
          demonstratedFormats: [], collaborationObservations: [] }) }] } } };
      },
    });
    assert.equal(batchCalls, 2, "The invalid batch gets one schema repair attempt.");
    assert.equal(singleCalls, 5, "Each failed-batch video gets one bounded recovery call.");
    assert.equal(recoveredMetadata.sourceCoverage.extracted, 5);
    assert.equal(recoveredMetadata.sourceCoverage.recoveryCalls, 5);
    assert.equal(recoveredMetadata.sourceCoverage.failedBatches, 0);
    assert.deepEqual(recoveredMetadata.sourceCoverage.failedVideoIds, []);
    process.env.LLM_FALLBACK_PROVIDER = "";
    const throttledVideoIds = new Set();
    const throttledRecovery = await extractCreatorMetadata(recoveryProfile, {
      bedrockSendFn: async (command) => {
        const requested = JSON.parse(command.input.messages[0].content[0].text).videos;
        if (requested.length > 1) return { output: { message: { content: [
          { text: '{"culturalSignals":[],"demonstratedFormats":[],"collaborationObservations":[{"videoId":"abc12345670","kind":"unknown","partnerName":null,"basisField":"channel","basisText":"bad"}]}' }] } } };
        throttledVideoIds.add(requested[0].videoId);
        throw new Error("Creator intelligence provider returned HTTP 429.");
      },
    });
    assert.equal(throttledVideoIds.size, 1, "A recovery throttle stops further video recovery calls.");
    assert.equal(throttledRecovery.sourceCoverage.failedVideoIds.length, 5);
    process.env.LLM_FALLBACK_PROVIDER = "";
    await assert.rejects(llmJson("no fallback", {}, schema, {
      bedrockSendFn: async () => { throw new Error("network unavailable"); },
      fetchFn: async () => { throw new Error("unexpected fallback"); },
    }), /network unavailable/);
  } finally {
    [process.env.LLM_PROVIDER, process.env.LLM_FALLBACK_PROVIDER] = previousProvider;
  }
} finally {
  [process.env.LLM_API_URL, process.env.LLM_API_KEY, process.env.LLM_MODEL,
    process.env.LLM_PROVIDER] = old;
}

const creator = { name: "Alex Trail", summary: "Official projects https://alextrail.example/about" };
const metadata = { collaborationObservations: [{ partnerName: "TrailCo",
  kind: "explicit_sponsorship_disclosure" }] };
const page = { inspected: true, sourceHash: "c".repeat(64),
  title: "Alex Trail and TrailCo", url: "https://alextrail.example/campaign",
  snippet: "Alex Trail partnered with TrailCo to create a sponsored video series." };
let searches = 0; let extracts = 0;
const commercial = await researchCreatorCommercial(creator, metadata, {
  search: async (_query, options) => { searches += 1;
    assert.deepEqual(options.includeDomains, ["alextrail.example"]);
    return { results: [page], cacheStatus: "fresh" }; },
  extract: async () => { extracts += 1; return { results: [] }; } });
assert.equal(commercial.coverage, "supported");
assert.equal(commercial.cacheStatus, "fresh");
assert.equal(searches, 1); assert.equal(extracts, 0);
assert.equal((await researchCreatorCommercial(creator, metadata, { search: async () => ({
  results: [{ ...page, snippet: "Another creator partnered with TrailCo." }] }) })).coverage, "inconclusive");
assert.equal((await researchCreatorCommercial(creator, metadata, { search: async () => {
  throw new Error("Web research has reached its daily provider limit."); } })).reason, "web_budget_exhausted");
assert.equal((await researchCreatorCommercial(creator, { collaborationObservations: [] }, {
  search: async () => { throw new Error("No request expected"); } })).coverage, "not_performed");
console.log("Creator named Qloo projection, ambiguity, discovery-hit selection, adaptive questions, bounded LLM retry/serialization, and selective cache-first commercial verification passed.");
