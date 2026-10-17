"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RunSummary = { id: string; kind: string; status: string; stage: string; partnerType: string; createdAt: string; result?: { sample?: boolean } };
type Score = { status: string; displayScore: number | null; ratings?: { C: number | null; R: number | null; G: number | null };
  confidence?: string; reasonCodes?: string[]; findings?: { C?: string | null; R?: string | null; G?: string | null } };
type Match = { id: string; partnerEntityId: string; partnerName: string; savedAt: string | null; evidence: { sample: boolean; unknowns: string[];
  claims: { id: string; text: string; kind: string; sourceIds: string[] }[];
  sources: { id: string; title: string; excerpt: string; sourceUrl: string | null }[] };
  score: Score | null; scoringVersion: string | null; evidenceStatus: string;
  concept: { title: string; format: string; hypothesis: string; validation: string } | null;
  briefId: string | null; briefMarkdown: string | null; briefRevision: number | null; briefStatus: string | null };
type Run = { id: string; kind: string; matchType: string; status: string; stage: string; seedName: string; positioningDirection?: string | null; result?: { sample?: boolean; message?: string; candidates?: { name?: string; description?: string; businessStatus?: string; businessRecordUrl?: string | null; officialWebsite?: string | null; culturalSignals?: string[]; matchId?: string; researchStatus?: string; status?: string; sourceUrl?: string | null; channelId?: string }[] }; matches: Match[] };
type BrandCandidate = { id: string; name: string; description: string | null; website: string | null };
type BrandResolution = { id: string; message: string; qloo: { candidates: BrandCandidate[] }; wikidata: { candidates: BrandCandidate[] } };

export function PersonalResearchPreview({ projectId, objective }: { projectId: string; objective: string }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [mode, setMode] = useState("discovery");
  const [partnerType, setPartnerType] = useState("brand");
  const [positioningDirection, setPositioningDirection] = useState("");
  useEffect(() => {
    if (objective === "sponsorship") setPartnerType("creator");
    else if (["co_created_product", "repositioning"].includes(objective)) setPartnerType("brand");
  }, [objective]);
  const [creatorChannel, setCreatorChannel] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
  const [brandResolution, setBrandResolution] = useState<BrandResolution | null>(null);
  const [brandQlooId, setBrandQlooId] = useState("");
  const [brandWikidataId, setBrandWikidataId] = useState("");
  const [partnerBrand, setPartnerBrand] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [briefText, setBriefText] = useState("");
  const [savingProposal, setSavingProposal] = useState(false);
  const proposalSaveLock = useRef(false);
  const loadedBriefId = useRef<string | null>(null);
  const [lastFeedbackId, setLastFeedbackId] = useState<string | null>(null);
  const [passReason, setPassReason] = useState("Not relevant");

  const loadRuns = useCallback(async () => {
    const response = await fetch(`/api/personal/runs?projectId=${projectId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Research history is unavailable.");
    const payload = await response.json();
    setRuns(payload.runs ?? []);
  }, [projectId]);

  const loadRun = useCallback(async (id: string) => {
    const response = await fetch(`/api/personal/runs/${id}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Research run is unavailable.");
    setRun(payload.run);
    const selectedMatch = payload.run.matches?.find((item: Match) => item.id === activeMatchId) ?? payload.run.matches?.[0];
    setActiveMatchId(selectedMatch?.id ?? null);
    const nextBriefId = selectedMatch?.briefId ?? null;
    if (nextBriefId !== loadedBriefId.current) {
      loadedBriefId.current = nextBriefId;
      setBriefText(selectedMatch?.briefMarkdown ?? "");
    }
    if (["completed", "partial", "failed"].includes(payload.run.status)) await loadRuns();
  }, [activeMatchId, loadRuns]);

  function selectMatch(item: Match) {
    setActiveMatchId(item.id);
    loadedBriefId.current = item.briefId;
    setBriefText(item.briefMarkdown ?? "");
  }

  useEffect(() => { loadRuns().catch((failure) => setError(failure.message)); }, [loadRuns]);
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const timer = window.setInterval(() => loadRun(run.id).catch((failure) => setError(failure.message)), 1800);
    return () => window.clearInterval(timer);
  }, [run, loadRun]);

  async function start(researchMode: "sample" | "live_youtube" | "live_brand" = "sample", liveMode: "discovery" | "direct_pair" = "direct_pair") {
    setBusy(true); setError(""); setNotice(""); setLastFeedbackId(null);
    try {
      const response = await fetch("/api/personal/runs", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(researchMode === "live_youtube"
          ? { projectId, mode: liveMode, partnerType: "creator", researchMode,
            ...(liveMode === "direct_pair" ? { creatorChannel: creatorChannel.trim() } : {}),
            idempotencyKey: crypto.randomUUID() }
          : researchMode === "live_brand"
            ? { projectId, mode: liveMode, partnerType: "brand", researchMode,
              ...(objective === "repositioning" ? { positioningDirection: positioningDirection.trim() } : {}),
              ...(liveMode === "direct_pair" ? { partnerEntityId: partnerBrand?.id } : {}), idempotencyKey: crypto.randomUUID() }
          : { projectId, mode, partnerType, researchMode,
            ...(objective === "repositioning" && partnerType === "brand" ? { positioningDirection: positioningDirection.trim() } : {}),
            idempotencyKey: crypto.randomUUID() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not start this research.");
      await loadRun(payload.runId);
      await loadRuns();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start this research."); }
    finally { setBusy(false); }
  }

  async function findPartnerBrand(name = brandQuery) {
    setBusy(true); setError(""); setPartnerBrand(null); setBrandResolution(null);
    try {
      setBrandQuery(name);
      const response = await fetch("/api/entities/resolve", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not find this brand.");
      setBrandResolution(payload);
      const exact = payload.qloo?.candidates?.filter((item: BrandCandidate) => item.name.toLowerCase() === name.trim().toLowerCase()) ?? [];
      setBrandQlooId(exact.length === 1 ? exact[0].id : ""); setBrandWikidataId("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not find this brand."); }
    finally { setBusy(false); }
  }

  async function confirmPartnerBrand() {
    if (!brandResolution || !brandQlooId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/entities/confirm", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionId: brandResolution.id, qlooId: brandQlooId,
          wikidataId: brandWikidataId || null, purpose: "partner" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not confirm this brand.");
      setPartnerBrand({ id: payload.entity.id, name: payload.entity.name }); setBrandResolution(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not confirm this brand."); }
    finally { setBusy(false); }
  }

  async function feedback(action: "save" | "reject") {
    const match = run?.matches.find((item) => item.id === activeMatchId) ?? run?.matches[0];
    if (!run || !match) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/personal/feedback", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id, matchId: match.id, action, reason: action === "reject" ? passReason : undefined }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not save your choice.");
      setLastFeedbackId(payload.feedback.id);
      setNotice(action === "save" ? "Saved to this project." : "Passed on this partner.");
      await loadRun(run.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save your choice."); }
    finally { setBusy(false); }
  }

  async function undo() {
    if (!lastFeedbackId || !run) return;
    const response = await fetch(`/api/personal/feedback/${lastFeedbackId}`, { method: "DELETE" });
    if (!response.ok) { setError("Could not undo that choice."); return; }
    setLastFeedbackId(null); setNotice("Choice undone."); await loadRun(run.id);
  }

  async function draftProposal(match: Match) {
    if (!run) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/personal/matches/${match.id}/proposal`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not start the proposal draft.");
      await loadRun(run.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start the proposal draft."); }
    finally { setBusy(false); }
  }

  const ratingLabel = (value: number | null | undefined) =>
    value === null || value === undefined ? "Not enough evidence"
      : value === 1 ? "Strong" : value === 0.75 ? "Supported" : value === 0.5 ? "Moderate"
        : value === 0.25 ? "Weak" : "Documented mismatch";

  async function saveBrief(match: Match, markdown: string) {
    if (proposalSaveLock.current) return;
    proposalSaveLock.current = true; setSavingProposal(true); setError("");
    try {
      const response = await fetch(`/api/personal/briefs/${match.briefId}`, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown, revision: match.briefRevision }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not save this proposal.");
      setRun((current) => current ? { ...current, matches: current.matches.map((item) => item.id === match.id
        ? { ...item, briefMarkdown: payload.brief.markdown, briefRevision: payload.brief.revision } : item) } : current);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this proposal."); }
    finally { proposalSaveLock.current = false; setSavingProposal(false); }
  }

  useEffect(() => {
    const match = run?.matches.find((item) => item.id === activeMatchId) ?? run?.matches[0];
    if (!match || match.briefStatus !== "valid" || briefText === match.briefMarkdown) return;
    const timer = window.setTimeout(() => { void saveBrief(match, briefText); }, 900);
    return () => window.clearTimeout(timer);
  }, [briefText, run]);

  function insertFinding(claim: Match["evidence"]["claims"][number]) {
    const match = run?.matches.find((item) => item.id === activeMatchId) ?? run?.matches[0];
    if (!match || match.evidenceStatus !== "valid" || match.evidence.sample) return;
    const linked = claim.sourceIds.map((id) => match.evidence.sources.find((source) => source.id === id))
      .filter((source): source is Match["evidence"]["sources"][number] => Boolean(source?.sourceUrl));
    if (!linked.length) return;
    const citation = linked.map((source) => `[Source](${source.sourceUrl})`).join(" ");
    setBriefText((current) => `${current.trimEnd()}\n\n${claim.text} ${citation}\n`);
  }

  function downloadBrief() {
    if (!run) return;
    const url = URL.createObjectURL(new Blob([briefText], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url; link.download = `crossculture-${run.result?.sample === false ? "research" : "sample"}-${run.id}.md`; link.click(); URL.revokeObjectURL(url);
  }

  const match = run?.matches.find((item) => item.id === activeMatchId) ?? run?.matches[0];
  const brandGoalAvailable = ["co_created_product", "content_collaboration", "repositioning"].includes(objective);
  const creatorGoalAvailable = ["content_collaboration", "sponsorship"].includes(objective);
  const needsDirection = objective === "repositioning";
  const brandReady = brandGoalAvailable && (!needsDirection || Boolean(positioningDirection.trim()));
  return <section className="account-panel preview-panel"><span className="workspace-kicker">PROJECT RESEARCH</span><h2>Research a partnership</h2>
    <p>Compare a confirmed brand or public YouTube creator with this project’s starting brand. Real research saves its sources and shows what remains unknown. The sample preview uses fictional evidence.</p>
    <p>{brandGoalAvailable && creatorGoalAvailable ? "This goal supports brand and creator partners." : brandGoalAvailable ? "This goal supports brand partners." : creatorGoalAvailable ? "This goal supports creator partners." : "This historical goal remains available to read, but cannot start new research. Choose a current goal in Project direction above."}</p>
    {needsDirection && <label>Desired cultural positioning direction<input value={positioningDirection} onChange={(event) => setPositioningDirection(event.target.value)} maxLength={240} required placeholder="e.g. Connect the brand with contemporary outdoor craft" /></label>}
    <div className="preview-controls"><label>Research mode<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="discovery">Find a sample partner</option><option value="direct_pair">Compare a sample pair</option></select></label><label>Partner type<select value={partnerType} onChange={(event) => setPartnerType(event.target.value)}><option value="brand" disabled={!brandGoalAvailable}>Brand</option><option value="creator" disabled={!creatorGoalAvailable}>YouTube creator</option></select></label><button className="button button-dark" disabled={busy || (partnerType === "brand" ? !brandReady : !creatorGoalAvailable)} type="button" onClick={() => start()}>{busy ? "Working…" : "Start sample preview"}</button></div>
    <div className="preview-controls"><p>Find brand collaborators from the starting brand’s cultural connections.</p><button className="button button-dark" disabled={busy || !brandReady} type="button" onClick={() => start("live_brand", "discovery")}>{busy ? "Working…" : "Find brand collaborators"}</button></div>
    <div className="preview-controls"><p>Find creators connected to the starting brand’s cultural territory.</p><button className="button button-dark" disabled={busy || !creatorGoalAvailable} type="button" onClick={() => start("live_youtube", "discovery")}>{busy ? "Working…" : "Find creators"}</button></div>
    <div className="preview-controls"><label>Specific creator channel<input value={creatorChannel} onChange={(event) => setCreatorChannel(event.target.value)} placeholder="@MKBHD or YouTube channel URL" aria-label="Specific creator channel" disabled={!creatorGoalAvailable} /></label><button className="button button-dark" disabled={busy || !creatorGoalAvailable || !creatorChannel.trim()} type="button" onClick={() => start("live_youtube")}>{busy ? "Working…" : "Compare this creator"}</button></div>
    <div className="preview-controls"><label>Partner brand name<input value={brandQuery} onChange={(event) => { setBrandQuery(event.target.value); setPartnerBrand(null); setBrandResolution(null); }} placeholder="e.g. REI" aria-label="Partner brand name" minLength={2} maxLength={90} disabled={!brandReady} /></label><button className="button button-dark" disabled={busy || !brandReady || brandQuery.trim().length < 2} type="button" onClick={() => findPartnerBrand()}>{busy ? "Working…" : "Find partner brand"}</button></div>
    {brandResolution && <div className="brand-resolution"><p role="status">{brandResolution.message}</p><div className="brand-source-grid"><fieldset><legend>Cultural brand</legend>{brandResolution.qloo.candidates.map((item) => <label className="brand-choice" key={item.id}><input type="radio" name="partner-qloo" checked={brandQlooId === item.id} onChange={() => setBrandQlooId(item.id)} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}{item.website && <small>{item.website}</small>}</span></label>)}</fieldset><fieldset><legend>Business record</legend><label className="brand-choice"><input type="radio" name="partner-wikidata" checked={!brandWikidataId} onChange={() => setBrandWikidataId("")} /><span><strong>None of these</strong></span></label>{brandResolution.wikidata.candidates.map((item) => <label className="brand-choice" key={item.id}><input type="radio" name="partner-wikidata" checked={brandWikidataId === item.id} onChange={() => setBrandWikidataId(item.id)} /><span><strong>{item.name}</strong>{item.website && <small>{item.website}</small>}</span></label>)}</fieldset></div><button className="button button-dark" type="button" disabled={busy || !brandQlooId} onClick={confirmPartnerBrand}>Confirm partner brand</button></div>}
    {partnerBrand && <div className="preview-controls"><p>Confirmed partner: <strong>{partnerBrand.name}</strong></p><button className="button button-dark" disabled={busy || !brandReady} type="button" onClick={() => start("live_brand")}>{busy ? "Working…" : "Compare these brands"}</button></div>}
    <p>Real comparisons show an evidence-based opportunity index only when cultural connection, partner activity and goal fit each have source-backed evidence.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice} {lastFeedbackId && <button className="auth-text-button" type="button" onClick={undo}>Undo</button>}</p>}
    {runs.length > 0 && <div className="preview-history"><h3>Research history</h3>{runs.map((item) => <button type="button" key={item.id} disabled={savingProposal || Boolean(match?.briefId && briefText !== match.briefMarkdown)} onClick={() => { setActiveMatchId(null); loadRun(item.id).catch((failure) => setError(failure.message)); setLastFeedbackId(null); }}><strong>{item.result?.sample === false ? item.kind === "discovery" ? item.partnerType === "brand" ? "Brand partner research" : "Creator discovery" : item.partnerType === "brand" ? "Brand comparison" : "Creator comparison" : item.kind === "direct_pair" ? "Sample comparison" : "Sample discovery"} · {item.partnerType}</strong><span>{item.status} · {new Date(item.createdAt).toLocaleString()}</span></button>)}</div>}
    {run && <div className="preview-result"><h3>{run.result?.sample === false ? run.kind === "discovery" ? run.matchType === "brand_brand" ? "Brand partner shortlist" : "Creator shortlist" : run.matchType === "brand_brand" ? "Brand comparison" : "Creator comparison" : run.kind === "direct_pair" ? "Sample pair" : "Sample shortlist"}</h3>{run.positioningDirection && <p>Desired cultural positioning: {run.positioningDirection}</p>}<p role="status">{run.status === "failed" ? "This research could not finish. Please try again." : run.status === "running" || run.status === "queued" ? run.stage : run.result?.message ?? run.stage}</p>
      {run.kind === "discovery" && run.matches.length > 0 && <div className="preview-sources"><h4>Researched partners</h4>{[
        { title: "Scored opportunities", items: run.matches.filter((item) => item.evidenceStatus === "valid" && item.score?.status === "eligible") },
        { title: "Conditional opportunities", items: run.matches.filter((item) => item.evidenceStatus === "valid" && item.score?.status === "conditional") },
        { title: "Needs more evidence or review", items: run.matches.filter((item) => item.evidenceStatus !== "valid" || !["eligible", "conditional"].includes(item.score?.status ?? "")) },
      ].filter((group) => group.items.length > 0).map((group) => <div key={group.title}><h5>{group.title}</h5>{group.items.map((item) => <button type="button" key={item.id} className="brand-choice" disabled={savingProposal || Boolean(match?.briefId && briefText !== match.briefMarkdown)} onClick={() => selectMatch(item)} aria-pressed={match?.id === item.id}><strong>{item.partnerName}</strong><span>{item.evidenceStatus !== "valid" ? "Research needs review" : typeof item.score?.displayScore === "number" ? `${item.score.displayScore}/100 · ${item.score.confidence ?? "limited"} evidence confidence` : item.score?.status === "excluded" ? "Excluded by a verified constraint" : "More evidence needed"}</span></button>)}</div>)}</div>}
      {run.result?.candidates && <div className="preview-sources"><h4>{run.matchType === "brand_brand" ? "All discovered brands" : "Creator leads"}</h4><p>Some leads need identity confirmation or more source evidence before assessment.</p>{run.result.candidates.map((candidate, index) => <div key={candidate.channelId ?? candidate.name ?? index}><strong>{candidate.name ?? (run.matchType === "brand_brand" ? "Partner lead" : "Creator lead")}</strong>{candidate.description && <p>{candidate.description}</p>}
        {candidate.businessStatus === "corroborated" && <p>{candidate.matchId ? "Public business identity corroborated; research is available above." : "Matching public business record found. Confirm this brand to continue research."}</p>}
        {candidate.businessStatus === "record_found" && <p>A possible business record was found. Check that it describes the intended brand.</p>}
        {candidate.businessStatus === "ambiguous" && <p>Several business records may match. Choose the intended brand.</p>}
        {candidate.businessStatus === "conflicting" && <p>Public website records differ. Review the identity carefully.</p>}
        {candidate.businessStatus === "unavailable" && <p>Business records were unavailable during this search.</p>}
        {candidate.researchStatus === "research_incomplete" && <p>Identity is confirmed, but cultural or business research is incomplete. Activity and goal capabilities remain open questions.</p>}
        {candidate.culturalSignals && candidate.culturalSignals.length > 0 && <p>Early cultural connections to examine: {candidate.culturalSignals.join(", ")}. These do not establish partnership fit.</p>}
        {run.matchType === "brand_youtube_creator" && candidate.status && <p>{candidate.status === "assessed" ? "Research is available above."
          : candidate.status === "excluded_organization" ? "This channel appears to belong to an organization, so it is outside this creator search."
            : candidate.status === "lead" ? "This lead has not been screened yet."
              : "Research needs more evidence or another attempt."}</p>}
        {run.matchType === "brand_youtube_creator" && candidate.sourceUrl && <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">View public video</a>}
        {candidate.businessRecordUrl && <a href={candidate.businessRecordUrl} target="_blank" rel="noopener noreferrer">View business record</a>}
        {candidate.officialWebsite && <a href={candidate.officialWebsite} target="_blank" rel="noopener noreferrer">View possible official site</a>}
        {candidate.matchId && run.matches.some((item) => item.id === candidate.matchId)
          ? <button type="button" disabled={savingProposal || Boolean(match?.briefId && briefText !== match.briefMarkdown)} onClick={() => selectMatch(run.matches.find((item) => item.id === candidate.matchId)!)}>View assessment</button>
          : run.matchType === "brand_brand" && candidate.name ? <button type="button" disabled={busy} onClick={() => findPartnerBrand(candidate.name!)}>Research this partner</button> : null}</div>)}</div>}
      {match && <><div className="preview-match">
        <strong>{run.seedName} × {match.partnerName}</strong>
        {match.evidenceStatus === "redacted" ? (
          <>
            <span>Source evidence expired</span>
            <p>The source-linked assessment needs review; your proposal writing remains saved.</p>
          </>
        ) : match.evidenceStatus === "stale" ? (
          <>
            <span>Source evidence changed</span>
            <p>This assessment needs review before its findings are used. Your proposal writing remains saved.</p>
          </>
        ) : /^4\.0\.[01]$/.test(match.scoringVersion ?? "") && match.score ? (
          <div className="score-panel">
            {typeof match.score.displayScore === "number" ? (
              <p><strong>Evidence-based opportunity index: {match.score.displayScore}/100</strong>
                {match.score.status === "conditional" ? " · open questions need review before this is execution-ready" : ""}
                {match.score.confidence ? ` · evidence confidence: ${match.score.confidence}` : ""}</p>
            ) : (
              <p><strong>{match.score.status === "excluded"
                ? "This pair is excluded by a verified constraint."
                : "Not enough verified evidence for a score yet."}</strong></p>
            )}
            <ul>
              <li>Cultural connection: {ratingLabel(match.score.ratings?.C)}{match.score.findings?.C ? ` — ${match.score.findings.C}` : ""}</li>
              <li>Why it fits: {ratingLabel(match.score.ratings?.R)}{match.score.findings?.R ? ` — ${match.score.findings.R}` : ""}</li>
              <li>Goal fit: {ratingLabel(match.score.ratings?.G)}{match.score.findings?.G ? ` — ${match.score.findings.G}` : ""}</li>
            </ul>
          </div>
        ) : (
          <>
            <span>{match.evidence.sample ? "Sample only · no verified cultural connection or score" : run.matchType === "brand_brand" ? "Brand identities checked · cultural fit unassessed · no score" : "Public YouTube metadata · cultural fit unassessed · no score"}</span>
            <p>{match.concept?.hypothesis ?? ""}</p>
          </>
        )}
        <div className="preview-sources"><strong>{match.evidenceStatus === "redacted" ? "Sources removed" : match.evidence.sample ? "Sample source notes" : run.matchType === "brand_brand" ? "Research sources" : "Public video sources"}</strong>
          {match.evidence.claims?.map((claim) => <p key={claim.id}>{claim.text} {claim.sourceIds.map((id) => match.evidence.sources?.find((source) => source.id === id)).filter((source): source is Match["evidence"]["sources"][number] => Boolean(source)).map((source) => source.sourceUrl ? <a key={source.id} href={source.sourceUrl} target="_blank" rel="noopener noreferrer">View source</a> : <small key={source.id}>{source.title}</small>)} {!match.evidence.sample && match.evidenceStatus === "valid" && claim.sourceIds.some((id) => match.evidence.sources?.some((source) => source.id === id && source.sourceUrl)) && <button type="button" onClick={() => insertFinding(claim)}>Insert finding</button>}</p>)}
        </div>
        {match.evidenceStatus !== "redacted" && <p><strong>Open questions:</strong> {(match.evidence.unknowns ?? []).join(", ")}.</p>}
        <div className="preview-actions"><button type="button" disabled={busy} onClick={() => feedback("save")}>{match.savedAt ? "Saved" : "Save"}</button><label className="preview-pass-reason">Reason for passing<select value={passReason} onChange={(event) => setPassReason(event.target.value)}><option>Not relevant</option><option>Too obvious</option><option>Poor cultural fit</option><option>Not feasible</option><option>Already contacted</option></select></label><button type="button" disabled={busy} onClick={() => feedback("reject")}>Pass</button></div>
      </div>
        <div className="preview-brief"><h3>Proposal Studio</h3><p>Write the proposal in your own words. Select source-backed findings from the research above. Budget, rights, and partner acceptance remain for you to confirm.</p>
          {match.briefId ? (
            <><textarea aria-label="Partnership proposal" value={briefText} onChange={(event) => setBriefText(event.target.value)} maxLength={20000} /><div className="preview-actions"><span role="status">{savingProposal ? "Saving…" : briefText === match.briefMarkdown ? "Saved" : "Unsaved changes"}</span><button type="button" disabled={savingProposal || briefText === match.briefMarkdown || match.briefStatus !== "valid"} onClick={() => saveBrief(match, briefText)}>Save now</button><button type="button" onClick={downloadBrief}>Download Markdown</button></div></>
          ) : (
            <div className="preview-actions"><button className="button button-dark" type="button" disabled={busy} onClick={() => draftProposal(match)}>{busy ? "Working…" : "Draft a proposal from this research"}</button></div>
          )}
        </div></>}
    </div>}
  </section>;
}
