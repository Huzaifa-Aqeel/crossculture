"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { browserSupabase } from "@/lib/supabase/client";
import "./youtube.css";

type Brand = { id: string; name: string; description: string | null; website: string | null };
type Resolution = { id: string; qloo: { candidates: Brand[] } };
type Connection = { tagName: string; state: string; reason: string; hasChallenges: boolean;
  samplePrevalence: { matched: number; reviewed: number } | null;
  evidence: { source: string; observation: string; url: string }[] };
type Channel = { name: string; url: string; confidence: string;
  connections: Connection[]; sourceVideos: { title: string; url: string;
    publishedAt: string | null; sampleRole: string }[];
  collaborationHistory?: { state: "observed" | "not_observed";
    observations: { partnerName: string | null; videoTitle: string; url: string;
      publishedAt: string | null }[] };
  viewContext?: { title: string; url: string; publishedAt: string | null;
    viewCount: number; observedAt: string;
    length: "up_to_three_minutes" | "over_three_minutes" | null }[];
  coverage: { inventoryCount: number; hasMore: boolean; representativeCount: number;
    targetedCount: number; transcriptAvailable: number; transcriptUnavailable: number } };
type Run = { id: string; brandName: string; campaignMode: "ongoing" | "one_off";
  status: string; stage: string;
  result: { culturalConnections?: { name: string }[]; channels?: Channel[];
    coverage?: { searchDirections: number; candidateChannels: number; channelsReviewed: number;
      complete: boolean } }; errorCode?: string; createdAt: string };
type RunSummary = Pick<Run, "id" | "brandName" | "status" | "createdAt">;

export default function YoutubePage() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [query, setQuery] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [choice, setChoice] = useState("");
  const [campaignMode, setCampaignMode] = useState<"ongoing" | "one_off">("ongoing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);

  useEffect(() => {
    browserSupabase().auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user)); setReady(true);
      if (data.user) fetch("/api/youtube/runs", { cache: "no-store" }).then((r) => r.json())
        .then((payload) => setHistory(payload.runs ?? [])).catch(() => {});
    }).catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!run?.id || !["queued", "running"].includes(run.status)) return;
    const timer = setInterval(() => {
      fetch(`/api/youtube/runs/${run.id}`, { cache: "no-store" }).then((r) => r.json())
        .then((payload) => { if (payload.run) setRun(payload.run); }).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [run?.id, run?.status]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setResolution(null); setRun(null);
    try {
      const response = await fetch("/api/entities/resolve", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: query, purpose: "youtube_seed" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Brand lookup is unavailable.");
      setResolution(payload); setChoice("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Brand lookup is unavailable."); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!resolution || !choice) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/youtube/runs", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionId: resolution.id, qlooId: choice, campaignMode }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Creator research is unavailable.");
      const detail = await fetch(`/api/youtube/runs/${payload.runId}`, { cache: "no-store" });
      const loaded = await detail.json();
      if (loaded.run) setRun(loaded.run);
      setResolution(null);
      setHistory((current) => [{ id: payload.runId, brandName: query,
        status: "queued", createdAt: new Date().toISOString() }, ...current]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Creator research is unavailable."); }
    finally { setBusy(false); }
  }

  async function openRun(id: string) {
    setError("");
    try { const response = await fetch(`/api/youtube/runs/${id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Saved research is unavailable.");
      setRun(payload.run); setResolution(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Saved research is unavailable."); }
  }

  return <><Header /><main className="yt-shell shell">
    <div className="yt-intro"><span className="eyebrow"><span className="eyebrow-dot" /> Creator partnerships</span>
      <h1>Find creators with a real cultural connection.</h1>
      <p>Start with your brand. We follow its cultural connections into creator content, then check whether the connection holds across the channel.</p>
    </div>
    {!ready ? <p>Checking your account…</p> : !signedIn ?
      <p><Link href="/auth" className="yt-link">Sign in to start creator research →</Link></p> : <>
      <form className="yt-search" onSubmit={search}><label htmlFor="yt-brand">Brand name</label>
        <div><input id="yt-brand" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Enter your brand" minLength={2} maxLength={90} required />
          <button disabled={busy} type="submit">Find brand</button></div></form>
      {error && <p className="yt-error" role="alert">{error}</p>}
      {resolution && <section className="yt-panel"><h2>Choose your brand</h2>
        {resolution.qloo.candidates.length ? <><div className="yt-options">
          {resolution.qloo.candidates.map((item) => <label key={item.id}>
            <input type="radio" name="brand" checked={choice === item.id}
              onChange={() => setChoice(item.id)} /><span><strong>{item.name}</strong>
                {item.description && <small>{item.description}</small>}
                {item.website && <small>{item.website}</small>}</span></label>)}</div>
          <fieldset className="yt-campaign"><legend>What kind of collaboration?</legend>
            <label><input type="radio" name="campaign" checked={campaignMode === "ongoing"}
              onChange={() => setCampaignMode("ongoing")} /> Ongoing creator partnership</label>
            <label><input type="radio" name="campaign" checked={campaignMode === "one_off"}
              onChange={() => setCampaignMode("one_off")} /> One focused project</label></fieldset>
          <button className="yt-primary" onClick={start} disabled={!choice || busy}>Research creators</button></>
          : <p>No matching cultural brand was found.</p>}</section>}
      {run && <section className="yt-results"><div className="yt-result-head"><div>
        <span className="eyebrow">Creator research</span><h2>{run.brandName}</h2>
          <p>{run.campaignMode === "one_off" ? "One focused project" : "Ongoing partnership"}</p></div>
        <span className="yt-state">{run.status === "running" || run.status === "queued"
          ? "Research in progress" : run.status === "failed" ? "Research unavailable" : "Research complete"}</span></div>
        {["queued", "running"].includes(run.status) ?
          <p>Checking cultural directions and creator content. This may take a few minutes.</p> :
          run.status === "failed" ? <p>We could not complete this research. Please try again later.</p> : <>
            <div className="yt-connections"><h3>Cultural connections</h3><p>
              {(run.result.culturalConnections ?? []).map((item) => item.name).join(" · ") ||
                "No usable cultural direction was returned."}</p></div>
            {(run.result.channels ?? []).length ? run.result.channels?.map((channel) =>
              <article className="yt-channel" key={channel.url}>
                <div className="yt-channel-head"><h3><a href={channel.url} target="_blank" rel="noreferrer">{channel.name} ↗</a></h3>
                  <span>{channel.confidence === "high" ? "Broad evidence" : "Some evidence gaps"}</span></div>
                {channel.connections.filter((item) => item.state === "supported").map((item, connectionIndex) =>
                  <div key={`${item.tagName}-${connectionIndex}`}><strong>Why it fits · {item.tagName}</strong><p>{item.reason}</p>
                    {item.samplePrevalence && <p className="yt-coverage">This connection appeared in {item.samplePrevalence.matched} of {item.samplePrevalence.reviewed} distinct content groups in the broad sample. This is a sample of accessible uploads.</p>}
                    <div className="yt-evidence">{item.evidence.slice(0, 4).map((finding, index) =>
                      <a key={`${finding.url}-${index}`} href={finding.url} target="_blank" rel="noreferrer">
                        {finding.observation} · {finding.source === "transcript" ? "Spoken moment" : "Video details"} ↗
                      </a>)}</div></div>)}
                {channel.connections.some((item) => item.hasChallenges) &&
                  <div><strong>Potential challenges</strong><p>Some checked content complicates this connection. Review the linked videos before contacting the creator.</p></div>}
                <div><strong>Previous paid partnerships</strong>
                  {channel.collaborationHistory?.state === "observed" ?
                    <p>Public sponsorship disclosures were found in the videos checked:</p> :
                    <p>None was verified in the videos checked. This does not affect the cultural match.</p>}
                  {channel.collaborationHistory?.observations.map((item, index) =>
                    <p key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noreferrer">
                      {item.partnerName ? `${item.partnerName} · ` : "Sponsorship disclosure · "}{item.videoTitle} ↗</a></p>)}</div>
                {!!channel.viewContext?.length && <div><strong>Recent public video views</strong>
                  <p>Counts checked {new Date(channel.viewContext[0].observedAt).toLocaleDateString()}.
                    Older videos have had more time to gain views.</p>
                  {channel.viewContext.map((item) => <p key={item.url}>
                    <a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a>
                    {` · ${new Intl.NumberFormat().format(item.viewCount)} views`}
                    {item.length ? ` · ${item.length === "up_to_three_minutes" ? "Up to 3 minutes" : "Over 3 minutes"}` : ""}
                    {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleDateString()}` : ""}</p>)}</div>}
                <p className="yt-coverage">Reviewed {channel.coverage.representativeCount} broadly selected and {channel.coverage.targetedCount} focused videos from {channel.coverage.inventoryCount} accessible uploads. {channel.coverage.hasMore ? "More uploads remain unreviewed. " : ""}{channel.coverage.transcriptUnavailable ? "Some spoken content was unavailable. " : ""}</p>
                <div className="yt-sources"><strong>Content checked</strong>{channel.sourceVideos.slice(0, 8).map((video) =>
                  <a key={video.url} href={video.url} target="_blank" rel="noreferrer">{video.title} ↗</a>)}</div>
              </article>) : <p>No creator met the evidence threshold in the content reviewed. This does not rule out other creators.</p>}
            {run.result.coverage && !run.result.coverage.complete && <p className="yt-coverage">Research coverage was partial. Additional channels or videos may change the shortlist.</p>}
          </>}
      </section>}
      {history.length > 0 && <section className="yt-history"><h2>Recent research</h2>
        {history.map((item) => <button key={item.id} onClick={() => openRun(item.id)}>
          <strong>{item.brandName}</strong><span>{new Date(item.createdAt).toLocaleDateString()}</span></button>)}</section>}
    </>}
  </main></>;
}
