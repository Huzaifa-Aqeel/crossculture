"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { browserSupabase } from "@/lib/supabase/client";
import "../research/research.css";

type Project = { id: string; name: string; objective: string; seedName: string; market?: string; updatedAt: string;
  latestRunStatus?: string | null; recommendedPartners?: number };

// Where a project stands: a draft has no research yet.
function projectStatus(project: Project): [string, string] {
  switch (project.latestRunStatus) {
    case null: case undefined: return ["Draft", "rs-pill-draft"];
    case "queued": case "running": return ["Researching", "rs-pill-check"];
    case "failed": return ["Couldn't finish", "rs-pill-no"];
    default: return project.recommendedPartners
      ? [`${project.recommendedPartners} recommended`, "rs-pill-good"] : ["No recommendation", "rs-pill-draft"];
  }
}

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => browserSupabase().auth.getUser())
      .then(({ data, error: failure }) => {
        if (!active) return;
        setEmail(failure ? null : data.user?.email ?? null);
        if (data.user && !failure) fetch("/api/projects", { cache: "no-store" }).then((response) => {
          if (!response.ok) throw new Error("Your projects could not be loaded.");
          return response.json();
        }).then((payload) => {
          if (!Array.isArray(payload?.projects)) throw new Error("Your projects could not be loaded.");
          if (active) { setProjects(payload.projects); setError(""); }
        })
          .catch(() => { if (active) setError("Your projects could not be loaded."); })
          .finally(() => { if (active) setProjectsLoading(false); });
        setChecking(false);
      }).catch(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  return <><Header /><main className="shell rs-page">
    {checking ? <p className="rs-quiet">Loading your workspace…</p> : !email ? <div className="rs-card">
      <h2>Sign in to continue</h2><p>Sign in to research brand partnerships for your products.</p>
      <div className="rs-actions"><Link className="button button-dark" href="/auth">Sign in or create an account</Link></div></div> : <>
      <div className="rs-head"><div><h1>Partnership research</h1><p>Find brands whose products pair with yours, then turn the best fit into a proposal.</p></div>
        <Link className="button button-dark" href="/research/new">New research</Link></div>

      <h4 className="rs-section-title">Your projects</h4>
      {projectsLoading ? <p className="rs-quiet">Loading your projects…</p>
        : error ? <p className="rs-error" role="alert">{error}</p>
        : projects.length ? <div className="rs-projects">{projects.map((project) => {
        const [status, pill] = projectStatus(project);
        const draft = !project.latestRunStatus;
        // A draft continues where setup stopped: choosing the product.
        return <Link className="rs-project" key={project.id}
          href={draft ? `/research/new?project=${project.id}` : `/projects/${project.id}`}>
          <div><strong>{project.name}</strong></div>
          <div className="rs-project-side"><span className={`rs-pill ${pill}`}>{status}</span>
            <span>{draft ? "Continue setup" : new Date(project.updatedAt).toLocaleDateString()}</span></div></Link>;
      })}</div>
        : <div className="rs-empty">No projects yet. Start new research to find partners for one of your products.</div>}
    </>}
  </main></>;
}
