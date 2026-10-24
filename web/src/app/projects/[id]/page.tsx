"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import "../../auth/auth.css";
import "../../account/projects.css";
import { CommerceResearch } from "./commerce-research";

type Project = { id: string; name: string; objective: string; notes: string; seedName: string;
  seedNative: boolean; updatedAt: string };
const goals = [
  ["product_bundle", "Product Bundle Discovery"], ["cross_sell", "Cross-Sell Partner Discovery"],
];

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("product_bundle");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    params.then(({ id }) => fetch(`/api/projects/${id}`, { cache: "no-store" })).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Project unavailable.");
      if (!active) return;
      setProject(payload.project); setName(payload.project.name); setObjective(payload.project.objective);
      setNotes(payload.project.notes);
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "Project unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, objective, notes }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not save this project.");
      setProject(payload.project); setMessage("Project saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this project."); }
    finally { setSaving(false); }
  }

  return <><Header /><main className="shell account-shell"><span className="eyebrow"><span className="eyebrow-dot" /> PERSONAL RESEARCH</span>
    {loading ? <p role="status">Opening project…</p> : !project ? <section className="account-panel"><h1>Project unavailable</h1><p className="auth-error" role="alert">{error}</p><Link href="/account">Back to account</Link></section> : <><div className="account-head"><div><h1>{project.name}</h1><p>Starting brand: {project.seedName}</p></div></div><section className="account-panel"><h2>Project direction</h2><p>Capture your goal and working questions. These are your private notes.</p><form className="project-editor" onSubmit={save}><label htmlFor="project-title">Project name</label><input id="project-title" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /><label htmlFor="project-objective">Goal</label><select id="project-objective" value={objective} onChange={(event) => setObjective(event.target.value)}>{goals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><label htmlFor="project-notes">Working notes</label><textarea id="project-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={10000} placeholder="What kind of partnership are you exploring? What must be checked with both partners?" /><button className="button button-dark" type="submit" disabled={saving}>{saving ? "Saving…" : "Save project"}</button></form>{message && <p className="auth-message" role="status">{message}</p>}{error && <p className="auth-error" role="alert">{error}</p>}</section>{["product_bundle", "cross_sell"].includes(project.objective)
      ? <CommerceResearch projectId={project.id} objective={project.objective}
          requiresSelectedProduct={!project.seedNative} />
      : null}
      <Link className="project-page-back" href="/account">← All projects</Link></>}
  </main></>;
}
