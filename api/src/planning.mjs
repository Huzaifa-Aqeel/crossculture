const concernOptions = new Set(["Budget", "Timing", "Geography", "Format", "Scope"]);

export function feedbackScope(input) {
  const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return input.mode === "compare"
    ? `compare:${input.leftType}:${normalize(input.left)}:${input.rightType}:${normalize(input.right)}`
    : `discover:${input.type}:${normalize(input.seed)}:${input.partnerType}`;
}

export function makeRunPlan(input, feedback = []) {
  const scope = feedbackScope(input);
  const recent = feedback.filter((item) => item.scope === scope).slice(-20);
  const rejectedIds = [...new Set(recent.filter((item) => item.action === "reject").map((item) => item.candidateId))];
  const reasons = recent.filter((item) => item.action === "reject").map((item) => item.reason);
  const concerns = [...new Set(recent.map((item) => item.correction).filter((item) => concernOptions.has(item)))];
  const savedIds = [...new Set(recent.filter((item) => item.action === "save").map((item) => item.candidateId))];
  const requireStrongerEvidence = reasons.includes("Poor cultural fit");
  const plan = {
    version: 1,
    goal: String(input.goal ?? "Content collaboration"),
    excludedCandidateIds: rejectedIds,
    savedCandidateIds: savedIds,
    requireStrongerEvidence,
    avoidCloseCategories: input.excludeCompetitors !== false || reasons.includes("Too obvious"),
    contentSignalOffset: requireStrongerEvidence ? 1 : 0,
    concerns,
    feedbackIds: recent.map((item) => item.id),
  };
  return plan;
}
