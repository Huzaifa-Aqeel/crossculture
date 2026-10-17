import { qlooCall } from "./qloo.mjs";
import { importChannel, topicsInText } from "./youtube.mjs";
import { isOutsideProductScope, makeConcept } from "./discovery.mjs";
import { makeRunPlan } from "./planning.mjs";

async function loadEntity(type, value, trace, selectedBrand, qloo, importCreator) {
  if (type === "creator") {
    const channel = await importCreator(value);
    trace.push({ step: "youtube_import", sourceId: channel.id, items: channel.videoCount, at: new Date().toISOString() });
    return { id: channel.id, name: channel.name, kind: "Creator", summary: channel.summary, url: channel.url,
      videos: channel.videos ?? [] };
  }
  if (type !== "brand") throw new Error("Start with a brand.");
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > 90) throw new Error("Enter a brand name between 2 and 90 characters.");
  const described = selectedBrand ? { status: "ok", results: [selectedBrand], result_count: 1 } : await qloo("qloo_describe", { entity: name, type: "brand" });
  trace.push({ step: selectedBrand ? "confirmed_brand" : "describe", query: name, status: described.status, count: described.result_count ?? 0, at: new Date().toISOString() });
  const brand = described.results?.[0];
  if (described.status !== "ok" || !brand?.entity_id || isOutsideProductScope(brand)) throw new Error(`We could not confirm ${name} as a brand. Try a more specific name.`);
  const summary = brand.properties?.short_description ?? brand.properties?.description ?? "";
  const labels = topicsInText(`${brand.properties?.description ?? ""} ${summary}`);
  return { id: brand.entity_id, name: brand.name, kind: "Brand", summary, signals: labels.map((label) => ({ label, count: 1, sources: [] })) };
}

function partial(left, message) {
  return { status: "partial", seed: { name: left.name, kind: left.kind, summary: left.summary, url: left.url, topics: left.signals.map((item) => item.label) }, candidates: [], message, count: 0 };
}

export async function analyzePair(input, memory, trace, { qloo = qlooCall, importCreator = importChannel } = {}) {
  if (input.leftType !== "brand" || !["brand", "creator"].includes(input.rightType)) throw new Error("Compare a brand with another brand or a YouTube creator.");
  const plan = makeRunPlan(input, memory.feedback ?? []);
  trace.push({ step: "plan", plan, at: new Date().toISOString() });
  const left = await loadEntity(input.leftType, input.left, trace, input.selectedSeed, qloo, importCreator);
  const right = await loadEntity(input.rightType, input.right, trace, input.selectedRight, qloo, importCreator);
  if (left.id === right.id) throw new Error("Choose two different partners to compare.");
  if (right.kind === "Creator") {
    const sourceLinks = right.videos.slice(0, 3).map((video) => ({ title: video.title, url: video.sourceUrl,
      publishedAt: video.publishedAt })).filter((source) => source.title && source.url);
    trace.push({ step: "creator_content_policy", status: "metadata_only", sourceId: right.id, at: new Date().toISOString() });
    return { status: "partial", seed: { name: left.name, kind: left.kind, summary: left.summary,
      topics: left.signals.map((item) => item.label) }, count: 1,
      message: "This pair has been identified, but its cultural fit has not been assessed. Review the creator's public videos and confirm interest before proceeding.",
      candidates: [{ id: right.id, name: right.name, kind: "Creator", summary: right.summary,
        connection: `${left.name}'s brand profile and ${right.name}'s public channel are available. A shared cultural topic has not been verified.`,
        reason: "Use the public videos to decide whether to research this pairing further.",
        concept: makeConcept(left, right, input.goal), evidenceStrength: "Cultural fit unassessed",
        evidenceNotes: [`${left.name}'s brand profile is available.`, `${right.name}'s public channel and recent videos were identified; their themes have not been assessed.`],
        evidenceLimit: "No verified shared topic, creator endorsement, audience overlap, or partner interest. The linked videos are context, not evidence of fit.",
        practicalConcern: "Confirm the creator's content relevance, interest, audience fit, rights, and budget.",
        sourceLinks, channelUrl: right.url }],
    };
  }

  let connection;
  let reason;
  let evidenceStrength;
  let evidenceNotes = [];
  let evidenceLimit;
  let bridge;
  let sources = [];
  if (left.kind === "Brand" && right.kind === "Brand") {
    const rank = await qloo("qloo_rank", { options: [right.id], option_type: "brand", signals: [left.id] });
    const match = rank.results?.find((item) => item.entity_id === right.id);
    trace.push({ step: "pair_rank", status: rank.status, leftId: left.id, rightId: right.id, affinity: match?.affinity, at: new Date().toISOString() });
    if (rank.status !== "ok" || typeof match?.affinity !== "number") return partial(left, "We could not verify a cultural connection for this pair. Try another combination.");
    const shared = left.signals.map((item) => item.label).filter((label) => right.signals.some((item) => item.label === label));
    if (!shared.length) return partial(left, "The available brand profiles do not establish a specific shared theme for this pair. Try another combination or research the pair further.");
    bridge = shared[0];
    connection = `Both brand profiles describe ${shared.slice(0, 2).join(" and ")}; partnership research also indicates a cultural connection.`;
    reason = `${left.name} and ${right.name} bring different roles to a potential collaboration. Confirm the audience question and operating fit with both teams.`;
    evidenceStrength = "Shared profile theme";
    evidenceNotes = [`${left.name}'s profile mentions ${shared.join(" and ")}.`, `${right.name}'s profile mentions ${shared.join(" and ")}.`, "Partnership research suggests cultural affinity; no public source link is available for that signal."];
    evidenceLimit = "Public campaign examples, actual audience overlap, and partner interest have not been verified.";
  }

  const candidate = {
    id: right.id, name: right.name, summary: right.summary, kind: right.kind,
    connection, reason, evidenceStrength, evidenceNotes, evidenceLimit, sourceLinks: sources,
    concept: makeConcept({ name: left.name, kind: left.kind }, { name: right.name, kind: right.kind }, input.goal, bridge),
    practicalConcern: "Confirm both partners' interest, audience relevance, budget, and rights before proceeding.",
  };
  trace.push({ step: "pair_assessment", pairing: `${left.kind}-${right.kind}`, candidateId: right.id, evidenceStrength, at: new Date().toISOString() });
  return {
    status: "completed",
    seed: { name: left.name, kind: left.kind, summary: left.summary, url: left.url, topics: left.signals.map((item) => item.label) },
    candidates: [candidate], count: 1,
  };
}
