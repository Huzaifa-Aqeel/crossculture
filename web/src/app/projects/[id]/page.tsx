"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { GOALS, marketName } from "@/lib/markets";
import "../../research/research.css";
import { CommerceResearch } from "./commerce-research";

type Project = { id: string; name: string; objective: string; notes: string; seedName: string;
  market?: string; updatedAt: string };

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const [project, setProject] = useState<Project | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    params.then(({ id }) => fetch(`/api/projects/${id}`, { cache: "no-store" })).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "This project is unavailable.");
      if (!active) return;
      setProject(payload.project); setNotes(payload.project.notes ?? "");
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "This project is unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params]);

  async function saveNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: project.name, objective: project.objective, notes }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Notes could not be saved.");
      setProject(payload.project); setMessage("Notes saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Notes could not be saved."); }
    finally { setSaving(false); }
  }

  return <><Header /><main className="shell rs-page">
    {loading ? <p className="rs-quiet">Opening project…</p> : !project ? <div className="rs-card"><h2>Project unavailable</h2>
      <p className="rs-error" role="alert">{error}</p><p style={{ marginTop: 14 }}><Link className="rs-link" href="/account">Back to workspace</Link></p></div> : <>
      <div className="rs-head"><div><Link href="/account" className="rs-quiet" style={{ display: "inline-block", marginBottom: 14 }}>← Workspace</Link>
        <h1>{project.name}</h1>
        <div className="rs-meta"><span>{project.seedName}</span><span>{marketName(project.market ?? "US")}</span>
          <span>{GOALS[project.objective]?.label ?? "Partnership"}</span></div></div>
</div>

      <CommerceResearch projectId={project.id} />

      <details className="rs-more" style={{ marginTop: 34 }}><summary>Working notes</summary>
        <form className="rs-form" onSubmit={saveNotes}>
          <label className="rs-field">Notes <small>Private to you</small>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={10000} rows={6}
              placeholder="Questions to raise with partners, ideas to try next…" /></label>
          <div><button className="rs-button-quiet" type="submit" disabled={saving}>{saving ? "Saving…" : "Save notes"}</button></div>
          {message && <p className="rs-note" role="status">{message}</p>}
          {error && <p className="rs-error" role="alert">{error}</p>}
        </form></details>
    </>}
  </main></>;
}
