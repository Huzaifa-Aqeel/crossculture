export function selectedDemoBrand(selections, id, sessionId, now = Date.now()) {
  if (typeof id !== "string") return null;
  const record = selections.get(id);
  return record?.sessionId === sessionId && now - record.createdAt < 15 * 60_000 ? record : null;
}
