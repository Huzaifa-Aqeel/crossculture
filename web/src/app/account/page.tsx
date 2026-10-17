"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { browserSupabase } from "@/lib/supabase/client";
import "../auth/auth.css";
import "./projects.css";

type Candidate = { id: string; name: string; description: string | null; website: string | null; wikidataUrl?: string };
type Resolution = { id: string; query: string; qloo: { status: string; candidates: Candidate[] }; wikidata: { status: string; candidates: Candidate[] }; message: string };
type Confirmed = { id: string; name: string; identityStatus: string; qlooId: string; wikidataQid: string | null };
type Project = { id: string; name: string; objective: string; seedName: string; updatedAt: string };
const goals = [
  ["content_collaboration", "Content collaboration"], ["repositioning", "Repositioning"],
  ["co_created_product", "Co-created product"], ["sponsorship", "Sponsorship"],
];
const historicalGoals: Record<string, string> = { awareness: "Awareness", new_audience: "New audience" };
const goalsByPartnerType: Record<string, string[]> = {
  brand: ["co_created_product", "content_collaboration", "repositioning"],
  creator: ["content_collaboration", "sponsorship"],
};

function availability(status: string, count: number) {
  if (status === "unavailable") return "Unavailable right now";
  return count ? `${count} possible ${count === 1 ? "match" : "matches"}` : "No matches found";
}

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [query, setQuery] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [qlooId, setQlooId] = useState("");
  const [wikidataId, setWikidataId] = useState("");
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectGoal, setProjectGoal] = useState("content_collaboration");
  const [projectPartnerType, setProjectPartnerType] = useState("brand");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState("");

  useEffect(() => {
    let active = true;
    try {
      browserSupabase().auth.getUser().then(({ data, error: failure }) => {
        if (!active) return;
        setEmail(failure ? null : data.user?.email ?? null);
        if (data.user && !failure) fetch("/api/projects", { cache: "no-store" }).then((response) => {
          if (!response.ok) throw new Error("Projects are unavailable.");
          return response.json();
        }).then((payload) => {
          if (active && payload?.projects) setProjects(payload.projects);
        }).catch(() => { if (active) setProjectError("Your projects could not be loaded."); });
        setChecking(false);
      });
    } catch { setChecking(false); }
    return () => { active = false; };
  }, []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setConfirmed(null); setResolution(null);
    try {
      const response = await fetch("/api/entities/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: query }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not look up this brand.");
      setResolution(payload); setQlooId(""); setWikidataId("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not look up this brand."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!resolution || !qlooId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/entities/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolutionId: resolution.id, qlooId, wikidataId: wikidataId || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not confirm this brand.");
      setConfirmed(payload.entity); setResolution(null);
      setProjectName(`${payload.entity.name} partnerships`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not confirm this brand."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await browserSupabase().auth.signOut();
    window.location.assign("/auth");
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setProjectBusy(true); setProjectError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ seedEntityId: confirmed.id, name: projectName, objective: projectGoal }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not create this project.");
      window.location.assign(`/projects/${payload.project.id}`);
    } catch (failure) { setProjectError(failure instanceof Error ? failure.message : "Could not create this project."); }
    finally { setProjectBusy(false); }
  }

  return <><Header /><main className="shell account-shell"><div className="account-head"><div><span className="eyebrow"><span className="eyebrow-dot" /> PERSONAL RESEARCH</span><h1>Your account</h1><p>Research begins with the right brand identity.</p></div>{email && <button className="auth-text-button" type="button" onClick={signOut}>Sign out</button>}</div>
    {checking ? <p role="status">Checking your account…</p> : !email ? <section className="account-panel"><h2>Sign in to continue</h2><p>Your anonymous live demo remains open to everyone.</p><Link className="button button-dark" href="/auth">Sign in or create an account</Link><Link className="text-link" href="/discover">Open live demo</Link></section> : <><p className="account-email">Signed in as {email}</p><section className="account-panel"><h2>Confirm a starting brand</h2><p>Search independent cultural and business records, then choose the exact brand. Similar names are kept separate.</p><form className="brand-search" onSubmit={search}><label htmlFor="brand-query">Brand name</label><div><input id="brand-query" value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} maxLength={90} required placeholder="e.g. Patagonia" /><button className="button button-dark" disabled={busy} type="submit">{busy ? "Searching…" : "Find brand"}</button></div></form>{error && <p className="auth-error" role="alert">{error}</p>}{confirmed && <p className="auth-message" role="status">Confirmed {confirmed.name}. {confirmed.wikidataQid ? confirmed.identityStatus === "verified" ? "The selected business record has a matching official website." : "The business record was selected, but its official match remains unverified." : "Business details remain unconfirmed."}</p>}
      {resolution && <div className="brand-resolution"><p role="status">{resolution.message}</p><div className="brand-source-grid"><fieldset><legend>Cultural connections</legend><small>{availability(resolution.qloo.status, resolution.qloo.candidates.length)}</small>{resolution.qloo.candidates.length ? resolution.qloo.candidates.map((item) => <label className="brand-choice" key={item.id}><input type="radio" name="qloo-brand" checked={qlooId === item.id} onChange={() => setQlooId(item.id)} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}{item.website && <small>{item.website}</small>}</span></label>) : <p>No cultural brand match available yet.</p>}</fieldset><fieldset><legend>Business details</legend><small>{availability(resolution.wikidata.status, resolution.wikidata.candidates.length)}</small><label className="brand-choice"><input type="radio" name="wikidata-brand" checked={!wikidataId} onChange={() => setWikidataId("")} /><span><strong>None of these</strong><small>Keep business facts unknown for now.</small></span></label>{resolution.wikidata.candidates.map((item) => <label className="brand-choice" key={item.id}><input type="radio" name="wikidata-brand" checked={wikidataId === item.id} onChange={() => setWikidataId(item.id)} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}{item.website && <small>{item.website}</small>}{item.wikidataUrl && <small><a href={item.wikidataUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>View record</a></small>}</span></label>)}</fieldset></div><button className="button button-dark" type="button" onClick={confirm} disabled={!qlooId || busy}>{busy ? "Confirming…" : "Confirm selected brand"}</button></div>}
    </section>{confirmed && <section className="account-panel"><h2>Start a project</h2><p>Keep your goal and working notes together. Choose a partner type to see its goals; you can choose a different type for a later research run when the goal supports it.</p><form className="project-create" onSubmit={createProject}><label htmlFor="project-name">Project name</label><input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={120} required /><label htmlFor="project-partner-type">Partner type</label><select id="project-partner-type" value={projectPartnerType} onChange={(event) => { const next = event.target.value; setProjectPartnerType(next); if (!goalsByPartnerType[next].includes(projectGoal)) setProjectGoal("content_collaboration"); }}><option value="brand">Brand</option><option value="creator">YouTube creator</option></select><label htmlFor="project-goal">Goal</label><select id="project-goal" value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)}>{goals.filter(([value]) => goalsByPartnerType[projectPartnerType].includes(value)).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="button button-dark" disabled={projectBusy} type="submit">{projectBusy ? "Creating…" : "Create project"}</button></form>{projectError && <p className="auth-error" role="alert">{projectError}</p>}</section>}
      <section className="account-panel"><h2>Your projects</h2>{projects.length ? <div className="project-list">{projects.map((project) => <Link href={`/projects/${project.id}`} key={project.id}><strong>{project.name}</strong><span>{project.seedName} · {goals.find(([value]) => value === project.objective)?.[1] ?? historicalGoals[project.objective] ?? "Partnership project"}</span></Link>)}</div> : <p>No projects yet. Confirm a starting brand to create one.</p>}</section><p className="account-note"><Link href="/discover">Open live demo</Link> to explore possible partners.</p></>}</main></>;
}
