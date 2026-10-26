"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import { GOALS } from "@/lib/markets";
import "../research/research.css";

// Developer-only review queue. The API answers "not found" to anyone who is
// not a named reviewer. Each call here becomes a labelled case for evaluating
// the pair judgment; product details are loaded live, never stored.
type Offer = { status: string; title?: string; url?: string | null; message?: string };
type Item = { source: "user_flag" | "verdict_flip" | "rejected_sample" | "supported_sample";
  matchId: string | null; sampleId: string | null; objective: string; appStatus: string | null;
  appReason: string | null; appRationale: string | null; reasonCodes: string[] | null;
  seedName: string | null; partnerName: string | null; userNote: string | null;
  references: { seed?: { storefrontDomain?: string }; partner?: { storefrontDomain?: string } };
  offers: { seed?: Offer; partner?: Offer } | null };

const SOURCES: Record<Item["source"], string> = {
  user_flag: "A user said these products don't go together",
  verdict_flip: "Judged differently in different runs",
  rejected_sample: "Not recommended (sample)",
  supported_sample: "Recommended (sample)",
};
const STATUS: Record<string, string> = { supported: "Recommended", needs_verification: "Needs checking",
  unsupported: "Not suitable" };

function Product({ label, offer, domain }: { label: string; offer?: Offer; domain?: string }) {
  const name = offer?.title ?? offer?.message ?? "Product details unavailable";
  return <div className="rs-product"><small>{label}</small>
    {offer?.url ? <a href={offer.url} target="_blank" rel="noopener noreferrer">{name}</a> : <strong>{name}</strong>}
    <span>{domain ?? ""}</span></div>;
}

function ReviewCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function label(value: "good" | "bad") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/personal/review/labels", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: item.source, matchId: item.matchId, sampleId: item.sampleId, label: value, note }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "The label could not be saved.");
      onDone();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The label could not be saved."); }
    finally { setBusy(false); }
  }
  const reason = item.appReason || item.appRationale;
  return <article className="rs-opportunity">
    <div className="rs-opp-head"><div><h3>{item.seedName ?? "Starting brand"} × {item.partnerName ?? item.references.partner?.storefrontDomain ?? "Partner"}</h3>
      <p className="rs-opp-about">{SOURCES[item.source]} · {GOALS[item.objective]?.label ?? item.objective}</p></div>
      <span className="rs-pill rs-pill-check">{STATUS[item.appStatus ?? ""] ?? "Unknown"}</span></div>
    <div className="rs-products">
      <Product label="Starting product" offer={item.offers?.seed} domain={item.references.seed?.storefrontDomain} />
      <span className="rs-plus" aria-hidden="true">+</span>
      <Product label="Partner product" offer={item.offers?.partner} domain={item.references.partner?.storefrontDomain} />
    </div>
    <dl className="rs-facts">
      <div className="rs-fact"><dt>App&apos;s reason</dt><dd>{reason || (item.reasonCodes?.length
        ? item.reasonCodes.join(", ") : "No reason recorded.")}</dd></div>
      {item.userNote && <div className="rs-fact"><dt>User&apos;s note</dt><dd>{item.userNote}</dd></div>}
    </dl>
    <div className="rs-opp-actions">
      <input className="rs-review-note" aria-label="Note" placeholder="Why? (one line, optional)" maxLength={500}
        value={note} onChange={(event) => setNote(event.target.value)} />
      <button className="rs-button-quiet" type="button" disabled={busy} onClick={() => label("good")}>Good pair</button>
      <button className="rs-button-quiet" type="button" disabled={busy} onClick={() => label("bad")}>Bad pair</button>
    </div>
    {error && <p className="rs-error" role="alert">{error}</p>}
  </article>;
}

export default function ReviewPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/personal/review/queue", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 404 ? "Not found." : payload.message ?? "The review queue is unavailable.");
        setItems(payload.items ?? []);
      }).catch((failure) => setError(failure instanceof Error ? failure.message : "The review queue is unavailable."));
  }, []);
  return <><Header /><main className="shell rs-page">
    <div className="rs-head"><div><h1>Review queue</h1>
      <div className="rs-meta"><span>Mark each pair good or bad. Your calls become test cases for the pair judgment.</span></div></div></div>
    {error && <p className="rs-error" role="alert">{error}</p>}
    {!error && items === null && <p className="rs-quiet">Loading pairs and current product details…</p>}
    {items?.length === 0 && <div className="rs-empty">Nothing to review right now.</div>}
    {items?.map((item) => <ReviewCard key={`${item.matchId ?? item.sampleId}`} item={item}
      onDone={() => setItems((current) => current?.filter((entry) => entry !== item) ?? null)} />)}
  </main></>;
}
