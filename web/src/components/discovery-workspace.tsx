"use client";

import { useState } from "react";
import { ArrowRight, ArrowUpRight, Bookmark, ChevronDown, Download, RotateCcw, Search, X } from "lucide-react";

type Concept = { title: string; summary: string; format: string; topic: string; seedRole: string; partnerRole: string; deliverable: string; measure: string; steps: string[]; validation: string };
type DevelopedConcept = { title: string; hook: string; format: string; insight: string; communityHypothesis: string; roles: { seed: string; partner: string }; deliverables: string[]; pilotSteps: string[]; channels: string[]; budgetTier: string; guardrails: string; measurement: string; validation: string; sources: { title: string; url: string }[] };
type Candidate = { id: string; name: string; summary: string; kind: string; connection: string; reason: string; concept: Concept; evidenceStrength: string; evidenceNotes?: string[]; evidenceLimit?: string; practicalConcern: string; sourceLinks?: { title: string; url: string; publishedAt?: string }[] };
type Result = { seed: { name: string; summary: string; kind: string; url?: string; itemCount?: number; topics?: string[] }; candidates: Candidate[]; message?: string; count: number };
type Run = { id: string; mode?: "discover" | "compare"; goal?: string; status: string; stage: string; result?: Result; error?: string };
type BrandChoice = { id: string; name: string; description: string | null; website: string | null; wikidataUrl?: string };
type BrandResolution = { id: string; message: string; qloo: { status: string; candidates: BrandChoice[] }; wikidata: { status: string; candidates: BrandChoice[] } };
type SearchInput = Record<string, string | boolean | undefined>;
type PendingBrand = { role: "starting" | "second"; resolution: BrandResolution; input: SearchInput; seedSelectionId?: string };

const goals = ["Content collaboration", "New audience", "Cultural credibility", "Co-created product", "Event / experience", "Sponsorship"];
const reasons = ["Too obvious", "Poor cultural fit", "Not feasible", "Not relevant", "Already contacted"];
const concerns = ["Budget", "Timing", "Geography", "Format", "Scope"];

function exportBrief(seed: string, candidate: Candidate, goal: string) {
  const text = [
    `# ${candidate.concept.title}`,
    "", `**Starting partner:** ${seed}`, `**Potential partner:** ${candidate.name}`, `**Goal:** ${goal}`, "",
    "## Opportunity", candidate.concept.summary, "", "## What we found", candidate.connection, ...(candidate.evidenceNotes ?? []).map((note) => `- ${note}`),
    "", "## Public examples", ...(candidate.sourceLinks?.length ? candidate.sourceLinks.map((source) => `- [${source.title}](${source.url})${source.publishedAt ? ` — ${source.publishedAt.slice(0, 10)}` : ""}`) : ["No public examples linked for this match."]),
    "", "## Pilot to discuss", `**Format:** ${candidate.concept.format}`, `**${seed}'s role:** ${candidate.concept.seedRole}`, `**${candidate.name}'s role:** ${candidate.concept.partnerRole}`, `**Deliverable:** ${candidate.concept.deliverable}`, `**Success question:** ${candidate.concept.measure}`,
    "", "## First steps", ...candidate.concept.steps.map((step, index) => `${index + 1}. ${step}`),
    "", "## Open questions", candidate.concept.validation, candidate.practicalConcern, candidate.evidenceLimit ?? "Audience overlap and partner interest have not been verified.",
    "", "_Working proposal. Confirm the evidence and terms with both partners before committing._",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${seed}-${candidate.name}-brief`.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".md";
  link.click();
  URL.revokeObjectURL(url);
}

function exportIdeas(seed: string, candidate: Candidate, ideas: DevelopedConcept[]) {
  const sections = ideas.map((idea, index) => [
    `## ${index + 1}. ${idea.title}`, idea.hook, "", `**Format:** ${idea.format}  `,
    `**Budget tier:** ${idea.budgetTier}  `, `**Channels:** ${idea.channels.join(", ")}`, "",
    `**Cultural insight:** ${idea.insight}`, `**Community to explore:** ${idea.communityHypothesis} (hypothesis; audience overlap is unverified)`, "",
    `**${seed}'s role:** ${idea.roles.seed}`, `**${candidate.name}'s role:** ${idea.roles.partner}`, "",
    "**Deliverables**", ...idea.deliverables.map((item) => `- ${item}`), "",
    "**Pilot sequence**", ...idea.pilotSteps.map((item, step) => `${step + 1}. ${item}`), "",
    `**Creative guardrails:** ${idea.guardrails}`, `**Measure:** ${idea.measurement}`, `**Validate:** ${idea.validation}`, "",
    ...idea.sources.map((source) => `Source: [${source.title}](${source.url})`),
  ].join("\n"));
  const text = [`# ${seed} × ${candidate.name}`, "", "Collaboration ideas to validate with both partners.", "", ...sections].join("\n\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${seed}-${candidate.name}-ideas`.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".md";
  link.click();
  URL.revokeObjectURL(url);
}

export function DiscoveryWorkspace() {
  const [mode, setMode] = useState<"discover" | "compare">("discover");
  const [partnerType, setPartnerType] = useState<"brand" | "creator">("brand");
  const [seed, setSeed] = useState("");
  const [rightType, setRightType] = useState<"brand" | "creator">("brand");
  const [right, setRight] = useState("");
  const [goal, setGoal] = useState(goals[0]);
  const [excludeCompetitors, setExcludeCompetitors] = useState(true);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [passingId, setPassingId] = useState<string | null>(null);
  const [feasibilityId, setFeasibilityId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [passed, setPassed] = useState<string[]>([]);
  const [lastFeedback, setLastFeedback] = useState<{ id: string; candidateId: string; action: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [ideas, setIdeas] = useState<Record<string, DevelopedConcept[]>>({});
  const [ideaIndex, setIdeaIndex] = useState(0);
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaError, setIdeaError] = useState("");
  const [pendingBrand, setPendingBrand] = useState<PendingBrand | null>(null);
  const [chosenCulturalId, setChosenCulturalId] = useState("");
  const [chosenBusinessId, setChosenBusinessId] = useState("");

  const candidates = run?.result?.candidates ?? [];
  const visibleCandidates = candidates.filter((candidate) => !passed.includes(candidate.id));
  const selected = visibleCandidates.find((candidate) => candidate.id === selectedId) ?? visibleCandidates[0];
  const conditionalCreatorLead = selected?.evidenceStrength === "Cultural fit unassessed";

  async function resolveDemoBrand(name: string, role: "starting" | "second", input: SearchInput, seedSelectionId?: string) {
    const response = await fetch("/api/demo/entities/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "We could not check that brand.");
    setPendingBrand({ role, resolution: payload, input, seedSelectionId });
    setChosenCulturalId(""); setChosenBusinessId("");
  }

  async function startSearch(event?: React.FormEvent) {
    event?.preventDefault();
    if (seed.trim().length < 2) { setError("Enter a brand name to begin."); return; }
    if (mode === "compare" && right.trim().length < 2) { setError(rightType === "brand" ? "Enter the second brand name." : "Enter the second channel link or @handle."); return; }
    setLoading(true); setError(""); setNotice(""); setRun(null); setSelectedId(null); setPassed([]); setPassingId(null); setIdeas({}); setIdeaError(""); setPendingBrand(null);
    try {
      const input: SearchInput = mode === "compare" ? { mode, leftType: "brand", left: seed.trim(), rightType, right: right.trim(), goal } : { mode, type: "brand", partnerType, seed: seed.trim(), goal, excludeCompetitors };
      await resolveDemoBrand(seed.trim(), "starting", input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setLoading(false); }
  }

  async function confirmBrand() {
    if (!pendingBrand || !chosenCulturalId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/demo/entities/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolutionId: pendingBrand.resolution.id, qlooId: chosenCulturalId, wikidataId: chosenBusinessId || null }) });
      const confirmed = await response.json();
      if (!response.ok) throw new Error(confirmed.message ?? "We could not confirm that brand.");
      if (pendingBrand.role === "starting" && pendingBrand.input.mode === "compare" && pendingBrand.input.rightType === "brand") {
        await resolveDemoBrand(String(pendingBrand.input.right), "second", pendingBrand.input, confirmed.selectionId);
        setLoading(false);
        return;
      }
      const input = { ...pendingBrand.input, seedSelectionId: pendingBrand.role === "starting" ? confirmed.selectionId : pendingBrand.seedSelectionId, rightSelectionId: pendingBrand.role === "second" ? confirmed.selectionId : undefined };
      setPendingBrand(null);
      await launchRun(input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); setLoading(false); }
  }

  async function launchRun(input: SearchInput) {
    try {
      const endpoint = input.mode === "compare" ? "/api/pairs" : "/api/runs";
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const created = await response.json();
      if (!response.ok) throw new Error(created.message ?? "We could not start this search.");
      for (let attempt = 0; attempt < 36; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const check = await fetch(`/api/runs/${created.runId}`, { cache: "no-store" });
        const current: Run = await check.json();
        if (!check.ok) throw new Error("We could not finish this search. Please try again.");
        if (["completed", "partial", "failed"].includes(current.status)) {
          setRun(current);
          setSelectedId(current.result?.candidates?.[0]?.id ?? null);
          if (current.status === "failed") setError(current.error ?? "We could not complete this search.");
          setLoading(false);
          return;
        }
      }
      throw new Error("This search is taking longer than expected. Please try again shortly.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
      setLoading(false);
    }
  }

  async function giveFeedback(candidate: Candidate, action: "save" | "reject", reason?: string, correction?: string) {
    if (!run) return;
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id, candidateId: candidate.id, action, reason, correction }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Please try again.");
      setLastFeedback({ id: payload.id, candidateId: candidate.id, action });
      if (action === "save") { setSaved((current) => [...new Set([...current, candidate.id])]); setNotice(`${candidate.name} saved.`); }
      else { setPassed((current) => [...current, candidate.id]); setNotice(`${candidate.name} removed from this list.`); }
      setPassingId(null); setFeasibilityId(null);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "Please try again."); }
  }

  async function undoFeedback() {
    if (!lastFeedback) return;
    const response = await fetch(`/api/feedback/${lastFeedback.id}`, { method: "DELETE" });
    if (!response.ok) { setNotice("We could not undo that action."); return; }
    if (lastFeedback.action === "save") setSaved((current) => current.filter((id) => id !== lastFeedback.candidateId));
    else setPassed((current) => current.filter((id) => id !== lastFeedback.candidateId));
    setLastFeedback(null);
    setNotice("Your last choice was undone.");
  }

  async function developIdeas(candidate: Candidate) {
    if (!run || ideaLoading) return;
    setIdeaLoading(true); setIdeaError("");
    try {
      const response = await fetch("/api/concepts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id, candidateId: candidate.id }) });
      let payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "We could not develop those ideas.");
      for (let attempt = 0; payload.status === "running" && attempt < 50; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const check = await fetch(`/api/concepts/${run.id}?candidateId=${encodeURIComponent(candidate.id)}`, { cache: "no-store" });
        payload = await check.json();
        if (!check.ok) throw new Error(payload.message ?? "We could not finish those ideas.");
      }
      if (payload.status !== "completed" || !Array.isArray(payload.concepts)) throw new Error(payload.message ?? "These ideas are taking longer than expected. Please try again.");
      setIdeas((current) => ({ ...current, [candidate.id]: payload.concepts }));
      setIdeaIndex(0);
    } catch (failure) { setIdeaError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setIdeaLoading(false); }
  }

  return (
    <main className="workspace shell">
      <div className="workspace-intro"><div><span className="workspace-kicker">THE WORKSPACE / DISCOVER</span><h1>Find your next<br />great collaborator.</h1><p>Find a brand or YouTube creator for your brand, or look closely at a pair you already have in mind.</p></div><div className="workspace-intro-note">The best partnership is rarely the most obvious one. Give the search a direction, then see what takes shape.</div></div>

      <form className="search-panel" onSubmit={startSearch}>
        <div className="search-panel-head"><div><span>NEW SEARCH</span><h2>What are you exploring?</h2></div><span className="search-panel-step">01 / START</span></div>
        <div className="mode-toggle" role="group" aria-label="Workspace mode"><button type="button" className={mode === "discover" ? "active" : ""} onClick={() => setMode("discover")}>Find collaborators</button><button type="button" className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")}>Compare two partners</button></div>
        <div className="form-main"><label htmlFor="seed" className="seed-label">{mode === "compare" ? "Your brand" : "Start with your brand"}</label><div className="input-wrap"><Search size={20} strokeWidth={1.8} /><input id="seed" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="Enter a brand name" autoComplete="off" maxLength={90} /></div><div className="seed-examples"><span>Try an example</span><button type="button" onClick={() => setSeed("Patagonia")}>Patagonia <ArrowUpRight size={12} /></button></div></div>
        {mode === "compare" && <div className="partner-field"><label>Second partner</label><div className="entity-toggle" role="group" aria-label="Second partner type"><button type="button" className={rightType === "brand" ? "active" : ""} onClick={() => { setRightType("brand"); setRight(""); }}>A brand</button><button type="button" className={rightType === "creator" ? "active" : ""} onClick={() => { setRightType("creator"); setRight(""); }}>A YouTube creator</button></div><label htmlFor="right-seed">{rightType === "brand" ? "Brand name" : "Channel link or @handle"}</label><div className="input-wrap"><Search size={20} strokeWidth={1.8} /><input id="right-seed" value={right} onChange={(event) => setRight(event.target.value)} placeholder={rightType === "brand" ? "Enter a brand name" : "youtube.com/@channel or @handle"} autoComplete="off" maxLength={300} /></div></div>}
        {mode === "discover" && <div className="partner-field"><label>Find</label><div className="entity-toggle" role="group" aria-label="Partner type"><button type="button" className={partnerType === "brand" ? "active" : ""} onClick={() => setPartnerType("brand")}>Brand partners</button><button type="button" className={partnerType === "creator" ? "active" : ""} onClick={() => setPartnerType("creator")}>YouTube creators</button></div></div>}
        <div className="form-row"><div className="form-field"><label htmlFor="goal">Your goal</label><div className="select-wrap"><select id="goal" value={goal} onChange={(event) => setGoal(event.target.value)}>{goals.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={16} /></div></div></div>
        <div className="search-panel-footer">{mode === "discover" && partnerType === "brand" ? <label className="checkline"><input type="checkbox" checked={excludeCompetitors} onChange={(event) => setExcludeCompetitors(event.target.checked)} /><span>Leave out close competitors</span></label> : <span className="checkline">Public information only</span>}<button className="button button-dark" type="submit" disabled={loading}>{loading ? (mode === "compare" ? "Comparing partners…" : "Finding partners…") : (mode === "compare" ? "Compare partners" : "Find collaborators")}<ArrowRight size={17} /></button></div>
      </form>

      {pendingBrand && <section className="demo-brand-confirm" aria-labelledby="demo-brand-title">
        <span className="workspace-kicker">CONFIRM THE BRAND</span>
        <h2 id="demo-brand-title">{pendingBrand.role === "starting" ? "Which starting brand do you mean?" : "Which second brand do you mean?"}</h2>
        <p>{pendingBrand.resolution.message} Similar names can refer to different places or organizations.</p>
        <div className="demo-brand-grid">
          <fieldset><legend>Cultural connections</legend>
            {pendingBrand.resolution.qloo.candidates.length ? pendingBrand.resolution.qloo.candidates.map((candidate) => <label className="demo-brand-choice" key={candidate.id}><input type="radio" name="demo-cultural-brand" checked={chosenCulturalId === candidate.id} onChange={() => setChosenCulturalId(candidate.id)} /><span><strong>{candidate.name}</strong>{candidate.description && <small>{candidate.description}</small>}{candidate.website && <small>{candidate.website}</small>}</span></label>) : <p>No cultural brand match is available. Try a more specific name.</p>}
          </fieldset>
          <fieldset><legend>Business details</legend>
            <label className="demo-brand-choice"><input type="radio" name="demo-business-brand" checked={!chosenBusinessId} onChange={() => setChosenBusinessId("")} /><span><strong>None of these</strong><small>Leave business details unconfirmed.</small></span></label>
            {pendingBrand.resolution.wikidata.candidates.map((candidate) => <label className="demo-brand-choice" key={candidate.id}><input type="radio" name="demo-business-brand" checked={chosenBusinessId === candidate.id} onChange={() => setChosenBusinessId(candidate.id)} /><span><strong>{candidate.name}</strong>{candidate.description && <small>{candidate.description}</small>}{candidate.website && <small>{candidate.website}</small>}{candidate.wikidataUrl && <small><a href={candidate.wikidataUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>View record</a></small>}</span></label>)}
            {pendingBrand.resolution.wikidata.status === "unavailable" && <p>Business records are unavailable right now. You can still continue with a cultural brand match.</p>}
          </fieldset>
        </div>
        <div className="demo-brand-actions"><button className="button button-dark" type="button" disabled={!chosenCulturalId || loading} onClick={confirmBrand}>{loading ? "Checking…" : pendingBrand.role === "starting" && pendingBrand.input.mode === "compare" && pendingBrand.input.rightType === "brand" ? "Continue to second brand" : "Continue with this brand"}<ArrowRight size={17} /></button><button className="refresh-button" type="button" onClick={() => setPendingBrand(null)}>Cancel</button></div>
      </section>}

      {error && <div className="message error-message" role="alert">{error}</div>}
      {loading && <div className="loading-panel" role="status"><span className="loading-spinner" /><div><strong>{mode === "compare" ? "Reviewing this pair" : "Looking for promising connections"}</strong><span>This usually takes a few moments.</span></div></div>}

      {run?.result && <section className="results-section" aria-live="polite"><div className="results-heading"><div><span className="workspace-kicker">{run.mode === "compare" ? "PAIR REVIEW" : run.result.candidates.some((candidate) => candidate.evidenceStrength === "Cultural fit unassessed") ? "CREATOR LEADS" : "PARTNERSHIP SHORTLIST"}</span><h2>{run.mode === "compare" ? run.result.candidates[0] ? `${run.result.seed.name} × ${run.result.candidates[0].name}` : `Review of ${run.result.seed.name}` : `New possibilities for ${run.result.seed.name}`}<span className="results-count">{run.mode === "compare" ? "" : visibleCandidates.length}</span></h2><p>{run.mode === "compare" ? "A closer look at the cultural connection and the questions both partners should answer." : run.result.candidates.some((candidate) => candidate.evidenceStrength === "Cultural fit unassessed") ? "Public YouTube leads for review. Their cultural fit is still unverified." : "Potential collaborators selected for cultural connection and a workable starting point."} Partner interest and audience overlap have not been verified.</p></div><button type="button" className="refresh-button" onClick={() => startSearch()} disabled={loading}><RotateCcw size={15} /> {run.mode === "compare" ? "Review again" : "Refresh suggestions"}</button></div>
        {notice && <div className="message notice-message">{notice}{lastFeedback && <button onClick={undoFeedback} type="button">Undo</button>}<button className="dismiss" type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button></div>}
        {run.result.message && <div className="message">{run.result.message}</div>}
        {visibleCandidates.length > 0 && <div className="results-layout"><div className="candidate-list">{visibleCandidates.map((candidate, index) => <article className={`candidate-card ${selected?.id === candidate.id ? "selected" : ""}`} key={candidate.id}><button type="button" className="candidate-select" onClick={() => { setSelectedId(candidate.id); setIdeaIndex(0); setIdeaError(""); }} aria-label={`View ${candidate.name}`}><div className="candidate-top"><span className="candidate-index">{String(index + 1).padStart(2, "0")}</span><span className="candidate-kind">{candidate.kind}</span></div><div className="candidate-name-row"><span className="candidate-monogram">{candidate.name.slice(0, 1)}</span><h3>{candidate.name}</h3><ArrowUpRight size={19} /></div><p>{candidate.summary}</p><div className="candidate-tags"><span>{candidate.evidenceStrength}</span><span>{candidate.concept.format}</span></div></button><div className="candidate-actions"><button type="button" onClick={() => giveFeedback(candidate, "save")} disabled={saved.includes(candidate.id)}><Bookmark size={15} fill={saved.includes(candidate.id) ? "currentColor" : "none"} />{saved.includes(candidate.id) ? "Saved" : "Save"}</button><button type="button" onClick={() => setPassingId(passingId === candidate.id ? null : candidate.id)}>Pass <ChevronDown size={14} /></button></div>{passingId === candidate.id && <div className="reason-menu"><span>What&apos;s the reason?</span>{reasons.map((reason) => <button type="button" key={reason} onClick={() => reason === "Not feasible" ? setFeasibilityId(candidate.id) : giveFeedback(candidate, "reject", reason)}>{reason}</button>)}{feasibilityId === candidate.id && <div className="concern-options"><span>What makes it difficult?</span>{concerns.map((concern) => <button type="button" key={concern} onClick={() => giveFeedback(candidate, "reject", "Not feasible", concern)}>{concern}</button>)}</div>}</div>}</article>)}</div>
          {selected && <aside className="match-detail"><div className="detail-top"><span>{conditionalCreatorLead ? "CREATOR TO REVIEW" : "PARTNERSHIP OPPORTUNITY"}</span><span>{selected.kind}</span></div><div className="detail-identity"><span className="detail-monogram">{selected.name.slice(0, 1)}</span><span>{run.result.seed.name} <span className="detail-times">×</span> {selected.name}</span></div><h3>{selected.concept.summary}</h3><div className="detail-section"><span className="detail-label">{conditionalCreatorLead ? "RESEARCH HYPOTHESIS" : "CULTURAL CONNECTIONS"}</span><p>{selected.connection}</p><p>{selected.reason}</p></div><div className="detail-section"><span className="detail-label">{conditionalCreatorLead ? "WHAT WE FOUND" : "WHY IT FITS"}</span><ul className="evidence-notes">{(selected.evidenceNotes ?? [selected.connection]).map((note) => <li key={note}>{note}</li>)}</ul>{selected.sourceLinks?.length ? <div className="source-list">{selected.sourceLinks.map((source) => <a href={source.url} target="_blank" rel="noopener noreferrer" key={source.url}><span>{source.title}{source.publishedAt && <small>{new Date(source.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</small>}</span><ArrowUpRight size={13} /></a>)}</div> : <p className="evidence-empty">No public examples linked for this match.</p>}</div><div className="detail-section"><span className="detail-label">{conditionalCreatorLead ? "PILOT HYPOTHESIS" : "A PILOT TO DISCUSS"}</span><h4>{selected.concept.format}</h4><div className="pilot-roles"><p><strong>{run.result.seed.name}</strong> {selected.concept.seedRole}</p><p><strong>{selected.name}</strong> {selected.concept.partnerRole}</p></div><p><strong>Deliverable</strong> {selected.concept.deliverable}</p><p><strong>Success question</strong> {selected.concept.measure}</p><ol>{selected.concept.steps.map((step) => <li key={step}>{step}</li>)}</ol></div><div className="detail-section detail-caution"><span className="detail-label">POTENTIAL CHALLENGES</span><p>{selected.concept.validation}</p><p>{selected.evidenceLimit}</p><p>{selected.practicalConcern}</p></div>
            <div className="detail-section idea-studio"><span className="detail-label">COLLABORATION IDEAS</span>
              {!ideas[selected.id] ? <><p>Develop three ways to bring this partnership to life.</p><button type="button" className="detail-export" onClick={() => developIdeas(selected)} disabled={ideaLoading}>{ideaLoading ? "Developing ideas…" : "Develop three ideas"}<ArrowRight size={16} /></button></> : <>
                <div className="idea-tabs" role="tablist" aria-label="Collaboration ideas">{ideas[selected.id].map((idea, index) => <button role="tab" aria-selected={ideaIndex === index} className={ideaIndex === index ? "active" : ""} key={idea.title} type="button" onClick={() => setIdeaIndex(index)}>{String(index + 1).padStart(2, "0")} · {idea.format}</button>)}</div>
                {(() => { const idea = ideas[selected.id][ideaIndex] ?? ideas[selected.id][0]; return <div className="idea-content"><h4>{idea.title}</h4><p className="idea-hook">{idea.hook}</p><p>{idea.insight}</p><div className="idea-grid"><div><span>THEIR ROLES</span><p><strong>{run.result!.seed.name}</strong> — {idea.roles.seed}</p><p><strong>{selected.name}</strong> — {idea.roles.partner}</p></div><div><span>DELIVERABLES</span><ul>{idea.deliverables.map((item) => <li key={item}>{item}</li>)}</ul></div></div><span className="detail-label">PILOT SEQUENCE</span><ol>{idea.pilotSteps.map((step) => <li key={step}>{step}</li>)}</ol><p className="idea-meta"><strong>Channels</strong> {idea.channels.join(", ")} · <strong>Budget</strong> {idea.budgetTier}</p><p><strong>Community to explore:</strong> {idea.communityHypothesis} This is a hypothesis, not verified audience overlap.</p><p><strong>Guardrails:</strong> {idea.guardrails}</p><p><strong>Measure:</strong> {idea.measurement}</p><p><strong>Validate:</strong> {idea.validation}</p>{idea.sources.length > 0 && <div className="source-list">{idea.sources.map((source) => <a href={source.url} target="_blank" rel="noopener noreferrer" key={source.url}>{source.title}<ArrowUpRight size={13} /></a>)}</div>}</div>; })()}
                <button type="button" className="detail-export" onClick={() => exportIdeas(run.result!.seed.name, selected, ideas[selected.id])}><Download size={17} /> Download all ideas <ArrowUpRight size={16} /></button>
              </>}
              {ideaError && <p className="idea-error" role="alert">{ideaError}</p>}
            </div><button type="button" className="detail-secondary" onClick={() => exportBrief(run.result!.seed.name, selected, run.goal ?? goal)}><Download size={15} /> Download partnership brief</button></aside>}
        </div>}</section>}
      <footer className="workspace-footer"><span>CrossCulture © 2026</span><span>Connections worth exploring. Decisions worth making carefully.</span></footer>
    </main>
  );
}
