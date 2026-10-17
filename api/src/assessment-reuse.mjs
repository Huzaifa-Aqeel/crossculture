// Assessment snapshots are append-only for scorer/rubric changes and evidence
// changes. Only the latest valid snapshot can satisfy an unchanged replay.
export function assessmentNeedsAppend(rows, inputHash, scoringVersion) {
  const latest = rows[0];
  return !latest || latest.input_hash !== inputHash ||
    latest.scoring_version !== scoringVersion || latest.validity_status !== "valid";
}
