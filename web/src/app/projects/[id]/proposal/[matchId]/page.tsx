"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/header";
import { GOALS } from "@/lib/markets";
import "../../../../research/research.css";
import { forgetCachedRun } from "../../commerce-research";

type Proposal = { id: string; markdown: string; revision: number; seedName: string;
  partnerName: string; objective: string; reused: boolean };

// One request per opportunity, even if the page mounts twice.
const requests = new Map<string, Promise<{ ok: boolean; status: number; payload: { proposal?: Proposal; message?: string } }>>();
function requestProposal(matchId: string) {
  if (!requests.has(matchId)) requests.set(matchId, fetch(`/api/personal/matches/${matchId}/proposal`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    .then(async (response) => ({ ok: response.ok, status: response.status, payload: await response.json() }))
    .finally(() => window.setTimeout(() => requests.delete(matchId), 1000)));
  return requests.get(matchId)!;
}

// Renders the small Markdown subset proposals use: headings, lists, bold and links.
function inline(text: string, key: string) {
  return text.split(/(\*\*[^*]+\*\*|https:\/\/[^\s)]+)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={`${key}-${index}`}>{part.slice(2, -2)}</strong>
      : part.startsWith("https://") ? <a key={`${key}-${index}`} href={part} target="_blank" rel="noopener noreferrer">{part.replace(/^https:\/\/(www\.)?/, "")}</a>
        : part);
}
function ProposalView({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((item, index) =>
    <li key={index}>{inline(item, `li${blocks.length}-${index}`)}</li>)}</ul>); list = []; };
  for (const raw of text.split("\n")) {
    const lineText = raw.trim();
    if (/^[-*] /.test(lineText)) { list.push(lineText.slice(2)); continue; }
    flush();
    if (!lineText) continue;
    if (lineText.startsWith("## ")) blocks.push(<h4 key={blocks.length}>{lineText.slice(3)}</h4>);
    else if (lineText.startsWith("# ")) blocks.push(<h3 key={blocks.length}>{lineText.slice(2)}</h3>);
    else blocks.push(<p key={blocks.length}>{inline(lineText, `p${blocks.length}`)}</p>);
  }
  flush();
  return <div className="rs-proposal-view">{blocks}</div>;
}

// The proposal is the user's draft: read it formatted, edit any part, then save, copy or download.
export default function ProposalPage({ params }: { params: Promise<{ id: string; matchId: string }> }) {
  const router = useRouter();
  const [route, setRoute] = useState<{ id: string; run: string | null } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    params.then(async ({ id, matchId }) => {
      const run = new URLSearchParams(window.location.search).get("run");
      if (active) setRoute({ id, run });
      const { ok, status, payload } = await requestProposal(matchId);
      if (!ok || !payload.proposal) throw new Error(status === 409
        ? "A product or price changed since this was reviewed, so a proposal can't be written. Start a new search for an up-to-date result."
        : payload.message ?? "The proposal could not be written.");
      if (!active) return;
      setProposal(payload.proposal); setText(payload.proposal.markdown);
      if (!payload.proposal.reused && run) {
        forgetCachedRun(run);
        // Writing a proposal is the sign of interest: the opportunity is kept
        // and its partner reviewed against public sources.
        void fetch("/api/personal/feedback", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId: run, matchId, action: "save" }) }).catch(() => {});
      }
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "The proposal could not be written."); });
    return () => { active = false; };
  }, [params]);

  const unsaved = Boolean(proposal) && text !== proposal?.markdown;
  function close() {
    if (unsaved && !window.confirm("Leave without saving your changes?")) return;
    if (route) router.push(`/projects/${route.id}${route.run ? `?run=${route.run}` : ""}`);
  }
  async function save() {
    if (!proposal) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/personal/briefs/${proposal.id}`, { method: "PATCH",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: proposal.revision, markdown: text }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "The proposal could not be saved.");
      setProposal({ ...proposal, revision: payload.brief.revision, markdown: payload.brief.markdown });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The proposal could not be saved."); }
    finally { setSaving(false); }
  }

  return <><Header /><main className="shell rs-page">
    <div className="rs-head"><div><h1>Proposal</h1>
      {proposal && <div className="rs-meta"><span>{proposal.seedName} × {proposal.partnerName}</span>
        <span>{GOALS[proposal.objective]?.label ?? "Partnership"}</span></div>}</div></div>
    {!proposal ? <div className="rs-card">
      {error ? <p className="rs-error" role="alert">{error}</p> : <p className="rs-quiet">Writing proposal…</p>}
      {error && <p style={{ marginTop: 14 }}><button className="rs-button-quiet" type="button" onClick={close}>Back to results</button></p>}
    </div> : <div className="rs-studio">
      <div className="rs-studio-head"><strong>{proposal.partnerName}</strong>
        <div className="rs-studio-tools">
          <button className="rs-link" type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Preview" : "Edit"}</button>
          <button className="rs-link" type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy"}</button>
          <button className="rs-link" type="button" onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
            const link = document.createElement("a"); link.href = url;
            link.download = `${proposal.partnerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-proposal.md`; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download</button>
          <button className="rs-link" type="button" onClick={close}>Close</button></div></div>
      {editing ? <textarea aria-label={`Proposal for ${proposal.partnerName}`} value={text} autoFocus
        onChange={(event) => setText(event.target.value)} /> : <ProposalView text={text} />}
      <div className="rs-studio-foot">
        <span className="rs-quiet">{editing ? "Edit, add or remove anything. Headings start with ##, list items with -." : "This is your draft. Change anything before sharing it."}</span>
        <button className="rs-button-quiet" type="button" disabled={saving || !unsaved} onClick={save}>
          {saving ? "Saving…" : unsaved ? "Save changes" : "Saved"}</button></div>
    </div>}
    {proposal && error && <p className="rs-error" role="alert">{error}</p>}
  </main></>;
}
