const sections = [
  "Partnership overview", "Opportunity summary", "Why this pair fits culturally",
  "Partner intelligence and documented collaborations", "Value for each partner",
  "Selected creative concept", "Deliverables and responsibilities", "Pilot schedule",
  "Measurement plan", "Budget, terms, open questions and next steps",
];

export function proposalTemplate({ seedName, partnerName, objective, sourceUrls = [], sample = false }) {
  const name = (value) => String(value ?? "").replace(/[\r\n#*\[\]]/g, " ").trim().slice(0, 160);
  const links = [...new Set(sourceUrls.filter((url) => {
    try { return new URL(url).protocol === "https:"; } catch { return false; }
  }))].slice(0, 5);
  const header = `# ${name(seedName)} × ${name(partnerName)} — partnership proposal\n\n` +
    `${sample ? "**SAMPLE PREVIEW — replace with verified research before use**\n\n" : ""}` +
    `**Starting brand:** ${name(seedName)}\n**Potential partner:** ${name(partnerName)}\n` +
    `**Objective:** ${name(objective).replaceAll("_", " ")}\n` +
    (links.length ? `\n**Identity and source links:**\n${links.map((url) => `- ${url}`).join("\n")}\n` : "");
  return `${header}\n${sections.map((section) => `## ${section}\n\n`).join("\n")}`;
}

export function citedFinding(claim, sources) {
  const linked = (claim?.sourceIds ?? []).map((id) => sources.find((source) => source.id === id))
    .filter((source) => source?.sourceUrl && source?.freshness !== "sample");
  if (!linked.length || typeof claim?.text !== "string") throw new Error("Only supported findings can be inserted.");
  return `${claim.text.trim()} ${linked.map((source) => `[Source](${source.sourceUrl})`).join(" ")}`;
}
