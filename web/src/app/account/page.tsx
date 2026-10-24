"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { browserSupabase } from "@/lib/supabase/client";
import "../auth/auth.css";
import "./projects.css";

type Candidate = { id: string; name: string; description: string | null; website: string | null };
type Resolution = { id: string; query: string; qloo: { status: string; candidates: Candidate[] }; message: string };
type Confirmed = { id: string; name: string; identityStatus: string; qlooId: string | null };
type Project = { id: string; name: string; objective: string; seedName: string; updatedAt: string };
const goals = [
  ["product_bundle", "Product Bundle Discovery"], ["cross_sell", "Cross-Sell Partner Discovery"],
];

function availability(status: string, count: number) {
  if (status === "unavailable") return "Unavailable right now";
  return count ? `${count} possible ${count === 1 ? "match" : "matches"}` : "No matches found";
}

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [query, setQuery] = useState("");
  const [contextDiscoveryAvailable, setContextDiscoveryAvailable] = useState(false);
  const [officialWebsite, setOfficialWebsite] = useState("");
  const [nativeOfficialWebsite, setNativeOfficialWebsite] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [qlooId, setQlooId] = useState("");
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectGoal, setProjectGoal] = useState("product_bundle");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => browserSupabase().auth.getUser())
      .then(({ data, error: failure }) => {
        if (!active) return;
        setEmail(failure ? null : data.user?.email ?? null);
        if (data.user && !failure) fetch("/api/me", { cache: "no-store" }).then((response) => response.json())
          .then((payload) => { if (active) setContextDiscoveryAvailable(payload.contextDiscoveryAvailable === true); })
          .catch(() => {});
        if (data.user && !failure) fetch("/api/projects", { cache: "no-store" }).then((response) => {
          if (!response.ok) throw new Error("Projects are unavailable.");
          return response.json();
        }).then((payload) => {
          if (active && payload?.projects) setProjects(payload.projects);
        }).catch(() => { if (active) setProjectError("Your projects could not be loaded."); });
        setChecking(false);
      }).catch(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setConfirmed(null); setResolution(null);
    try {
      const response = await fetch("/api/entities/resolve", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: query, purpose: "commerce_seed" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not look up this brand.");
      setResolution(payload); setQlooId(""); setNativeOfficialWebsite("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not look up this brand."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!resolution || !qlooId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/entities/confirm", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionId: resolution.id, qlooId, purpose: "commerce_seed",
          ...(nativeOfficialWebsite.trim() ? { officialWebsite: nativeOfficialWebsite.trim() } : {}) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not confirm this brand.");
      setConfirmed(payload.entity); setResolution(null);
      setProjectName(`${payload.entity.name} partnerships`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not confirm this brand."); }
    finally { setBusy(false); }
  }

  async function confirmOfficialSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/entities/confirm-commerce-site", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: query, website: officialWebsite }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not verify this website.");
      setConfirmed(payload.entity); setResolution(null);
      setProjectName(`${payload.entity.name} partnerships`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not verify this website."); }
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
    {checking ? <p role="status">Checking your account…</p> : !email ? <section className="account-panel"><h2>Sign in to continue</h2><p>Create projects to research brand partnerships.</p><Link className="button button-dark" href="/auth">Sign in or create an account</Link></section> : <><p className="account-email">Signed in as {email}</p><section className="account-panel"><h2>Confirm a starting brand</h2><p>Choose the exact cultural brand. We verify its official website before starting research.</p><form className="brand-search" onSubmit={search}><label htmlFor="brand-query">Brand name</label><div><input id="brand-query" value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} maxLength={90} required placeholder="e.g. Patagonia" /><button className="button button-dark" disabled={busy} type="submit">{busy ? "Searching…" : "Find brand"}</button></div></form>{contextDiscoveryAvailable && <form className="brand-search" onSubmit={confirmOfficialSite}><p>If this brand has no cultural match, verify its own website to research a selected product.</p><label htmlFor="official-website">Official website</label><div><input id="official-website" type="url" value={officialWebsite} onChange={(event) => setOfficialWebsite(event.target.value)} required placeholder="https://example.com" /><button className="button button-dark" disabled={busy || query.trim().length < 2} type="submit">Verify website</button></div></form>}{error && <p className="auth-error" role="alert">{error}</p>}{confirmed && <p className="auth-message" role="status">Confirmed {confirmed.name}. {confirmed.identityStatus === "verified" ? "Official website verified." : "Business details remain unconfirmed."}</p>}
      {resolution && <div className="brand-resolution"><p role="status">{resolution.message}</p><div className="brand-source-grid"><fieldset><legend>Cultural connections</legend><small>{availability(resolution.qloo.status, resolution.qloo.candidates.length)}</small>{resolution.qloo.candidates.length ? resolution.qloo.candidates.map((item) => <label className="brand-choice" key={item.id}><input type="radio" name="qloo-brand" checked={qlooId === item.id} onChange={() => { setQlooId(item.id); setNativeOfficialWebsite(""); }} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}{item.website && <small>{item.website}</small>}</span></label>) : <p>No cultural brand match available yet.</p>}</fieldset></div>{qlooId && <div className="brand-search"><label htmlFor="native-official-website">Official website, if missing or incorrect above</label><input id="native-official-website" type="url" value={nativeOfficialWebsite} onChange={(event) => setNativeOfficialWebsite(event.target.value)} placeholder="https://yourbrand.com" /><small>We check that this website belongs to the selected brand and has a product store.</small></div>}<button className="button button-dark" type="button" onClick={confirm} disabled={!qlooId || busy}>{busy ? "Confirming…" : "Confirm selected brand"}</button></div>}
    </section>{confirmed && <section className="account-panel"><h2>Start a project</h2><p>Choose a product partnership goal and keep your working notes together.</p><form className="project-create" onSubmit={createProject}><label htmlFor="project-name">Project name</label><input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={120} required /><label htmlFor="project-goal">Goal</label><select id="project-goal" value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)}>{goals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="button button-dark" disabled={projectBusy} type="submit">{projectBusy ? "Creating…" : "Create project"}</button></form>{projectError && <p className="auth-error" role="alert">{projectError}</p>}</section>}
      <section className="account-panel"><h2>Your projects</h2>{projects.length ? <div className="project-list">{projects.map((project) => <Link href={`/projects/${project.id}`} key={project.id}><strong>{project.name}</strong><span>{project.seedName} · {goals.find(([value]) => value === project.objective)?.[1] ?? "Partnership project"}</span></Link>)}</div> : <p>No projects yet. Confirm a starting brand to create one.</p>}</section></>}</main></>;
}
