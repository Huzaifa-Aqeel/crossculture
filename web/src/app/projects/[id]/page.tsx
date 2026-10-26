"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import "../../research/research.css";
import { CommerceResearch } from "./commerce-research";

type Project = { id: string; name: string };

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    params.then(({ id }) => fetch(`/api/projects/${id}`, { cache: "no-store" })).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "This project is unavailable.");
      if (active) setProject(payload.project);
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "This project is unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params]);

  return <><Header /><main className="shell rs-page">
    {loading ? <p className="rs-quiet">Opening project…</p> : !project ? <div className="rs-card"><h2>Project unavailable</h2>
      <p className="rs-error" role="alert">{error}</p></div> : <>
      <div className="rs-head"><div><h1>{project.name}</h1></div></div>
      <CommerceResearch projectId={project.id} />
    </>}
  </main></>;
}
