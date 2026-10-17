// Convert only explicit user choices and attributed, server-verified findings
// into frozen constraints. An unknown or possible conflict remains review-only.
export function assessmentConstraints(run, partnerId, potentialConflicts = []) {
  const latestFeedback = run.feedback_snapshot_json?.events?.find((item) =>
    item.partner_entity_id === partnerId);
  const excluded = (run.constraints_json?.excludedPartnerEntityIds ?? []).includes(partnerId) ||
    latestFeedback?.action === "reject";
  const constraints = excluded
    ? [{ id: "user:excluded_partner", text: "The user excluded this partner from consideration.",
      kind: "user", blocking: true, sourceIds: [] }]
    : [];
  for (const item of potentialConflicts) {
    if (!item?.sourceId || !item?.key) continue;
    if (constraints.some((constraint) => constraint.id === `verified:potential:${item.key}`)) continue;
    constraints.push({ id: `verified:potential:${item.key}`,
      text: `An official statement may limit ${item.key}; review the exact proposed mechanism.`,
      kind: "verified", blocking: false, sourceIds: [item.sourceId] });
  }
  return constraints;
}
