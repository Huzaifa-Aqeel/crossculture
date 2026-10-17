const base = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000";
let cookie = "";

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(options.headers ?? {}) },
  });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${body.message ?? JSON.stringify(body)}`);
  return body;
}

async function run() {
  const started = await request("/api/runs", { method: "POST", body: JSON.stringify({ type: "brand", partnerType: "brand", seed: "Patagonia", goal: "Content collaboration", creativity: "Balanced", excludeCompetitors: true }) });
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const current = await request(`/api/runs/${started.runId}`);
    if (["completed", "partial", "failed"].includes(current.status)) {
      if (current.status === "failed") throw new Error(current.error);
      return current;
    }
  }
  throw new Error("Search timed out");
}

const first = await run();
if (!first.result?.candidates?.length) throw new Error("No live candidates returned");
const selected = first.result.candidates[0];
const feedback = await request("/api/feedback", { method: "POST", body: JSON.stringify({ runId: first.id, candidateId: selected.id, action: "reject", reason: "Too obvious" }) });
const second = await run();
if (second.result.candidates.some((candidate) => candidate.id === selected.id)) throw new Error("Rejected candidate returned after feedback");
await request(`/api/feedback/${feedback.id}`, { method: "DELETE" });
process.stdout.write(JSON.stringify({ firstStatus: first.status, firstCount: first.result.candidates.length, firstTop: selected.name, secondStatus: second.status, secondCount: second.result.candidates.length, secondTop: second.result.candidates[0]?.name, feedbackApplied: true, undoWorked: true }, null, 2) + "\n");
