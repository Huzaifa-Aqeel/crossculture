"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/header";
import { GOALS, MARKETS, marketCurrency, marketName } from "@/lib/markets";
import "../research.css";

type Candidate = { id: string; name: string; description: string | null; website: string | null };
type Resolution = { id: string; qloo: { status: string; candidates: Candidate[] } };
type Brand = { id: string; name: string; website?: string | null };
type Product = { productId: string; variantId: string; title: string; url?: string | null; categoryId?: string | null;
  sized?: boolean };

const productCoverage: Record<string, string> = {
  selected_seed_product_unverified: "That product could not be confirmed. Try its product page link.",
  storefront_probe_unavailable: "Your store could not be reached right now. Please try again shortly.",
  catalog_rate_limited: "Your store is busy right now. Please try again shortly.",
  catalog_unavailable: "Your store could not be reached right now. Please try again shortly.",
};

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

function Step({ index, label, step, done, reachable, onSelect }: { index: number; label: string; step: number;
  done: boolean; reachable: boolean; onSelect: (index: number) => void }) {
  const current = step === index;
  const mark = <><b>{done && !current ? "✓" : index}</b>{label}</>;
  return <li aria-current={current ? "step" : undefined} data-done={done && !current ? "true" : undefined}>
    {!current && reachable ? <button type="button" onClick={() => onSelect(index)} aria-label={`Go to ${label}`}>{mark}</button> : mark}</li>;
}

export default function NewResearchPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // 1. Brand
  const [market, setMarket] = useState("US");
  const [brandQuery, setBrandQuery] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [brandChoice, setBrandChoice] = useState("");
  const [websiteNeeded, setWebsiteNeeded] = useState(false);
  const [website, setWebsite] = useState("");
  const [brand, setBrand] = useState<Brand | null>(null);

  // 2. Goal
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<"discovery" | "direct_pair">("discovery");
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerResolution, setPartnerResolution] = useState<Resolution | null>(null);
  const [partnerChoice, setPartnerChoice] = useState("");
  const [partner, setPartner] = useState<Brand | null>(null);
  // The project appears as a draft once the goal is confirmed; until research
  // runs, changing the goal just updates that draft.
  const [projectId, setProjectId] = useState("");
  const [projectObjective, setProjectObjective] = useState("");
  const [projectNotes, setProjectNotes] = useState("");

  // 3. Product
  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productChoice, setProductChoice] = useState("");
  const [productNote, setProductNote] = useState("");
  const [occasion, setOccasion] = useState("");
  const [preferences, setPreferences] = useState("");
  const [priceCap, setPriceCap] = useState("");
  const [mustShip, setMustShip] = useState(false);
  const [mustBeAvailable, setMustBeAvailable] = useState(false);

  // Continue an existing project: brand and goal are already known.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("project");
    if (!id) return;
    fetch(`/api/projects/${id}`, { cache: "no-store" }).then((response) => response.json())
      .then((payload) => {
        const project = payload.project;
        if (!project) return;
        setBrand({ id: project.seedEntityId, name: project.seedName });
        setMarket(project.market ?? "US"); setObjective(project.objective);
        setProjectId(project.id); setProjectObjective(project.objective); setProjectNotes(project.notes ?? ""); setStep(3);
      }).catch(() => {});
  }, []);

  async function findBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const query = brandQuery.trim();
    setBusy("find-brand"); setResolution(null); setBrandChoice("");
    setWebsiteNeeded(false); setWebsite("");
    const { ok, payload } = await post("/api/entities/resolve", { name: query, purpose: "commerce_seed", market });
    setBusy(null);
    if (!ok) { setError(payload.message ?? "This brand could not be looked up right now."); return; }
    // A brand already confirmed for this country in an earlier project goes straight on.
    if (payload.known) { setBrand(payload.known); setStep(2); return; }
    setResolution(payload);
  }

  async function confirmBrand() {
    if (!resolution || !brandChoice) return;
    setError(""); setBusy("confirm-brand");
    const { ok, status, payload } = await post("/api/entities/confirm", { resolutionId: resolution.id,
      qlooId: brandChoice, purpose: "commerce_seed", market,
      ...(website.trim() ? { officialWebsite: website.trim() } : {}) });
    setBusy(null);
    if (ok) {
      const chosen = resolution.qloo.candidates.find((item) => item.id === brandChoice);
      setBrand({ id: payload.entity.id, name: payload.entity.name, website: payload.entity.canonicalUrl ?? chosen?.website });
      setStep(2); return;
    }
    if (status === 409) { setWebsiteNeeded(true); return; }
    setError(payload.message ?? "This brand could not be confirmed right now.");
  }

  async function findPartner() {
    setBusy("find-partner"); setError(""); setPartnerResolution(null); setPartnerChoice(""); setPartner(null);
    const { ok, payload } = await post("/api/entities/resolve", { name: partnerQuery.trim(), purpose: "commerce_partner" });
    if (!ok) setError(payload.message ?? "This brand could not be looked up right now.");
    else setPartnerResolution(payload);
    setBusy(null);
  }

  async function confirmPartner() {
    if (!partnerResolution || !partnerChoice) return;
    setBusy("confirm-partner"); setError("");
    const { ok, status, payload } = await post("/api/entities/confirm", { resolutionId: partnerResolution.id,
      qlooId: partnerChoice, purpose: "commerce_partner", market });
    setBusy(null);
    if (ok) { setPartner({ id: payload.entity.id, name: payload.entity.name }); setPartnerResolution(null); return; }
    setError(status === 409 ? "We couldn't confirm this partner's store automatically. Try another brand."
      : payload.message ?? "This partner could not be confirmed right now.");
  }

  async function continueToProduct() {
    if (!brand || !objective || !partnerValid) return;
    setError("");
    if (!projectId || projectObjective !== objective) {
      setBusy("continue");
      const name = `${brand.name} · ${GOALS[objective].short}`;
      // A draft takes the new goal; a project that already has research keeps
      // its goal, so the new goal starts a new project.
      const updated = projectId ? await fetch(`/api/projects/${projectId}`, { method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, objective, notes: projectNotes }) }) : null;
      const created = updated?.ok ? null : await post("/api/projects", { seedEntityId: brand.id, objective, market, name });
      setBusy(null);
      if (created && !created.ok) { setError(created.payload.message ?? "This research could not be set up."); return; }
      if (created) { setProjectId(created.payload.project.id); setProjectNotes(created.payload.project.notes ?? ""); }
      setProjectObjective(objective);
    }
    setStep(3);
  }

  async function findProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("find-products"); setError(""); setProducts(null); setProductChoice(""); setProductNote("");
    const response = await fetch(`/api/entities/${brand?.id}/commerce-products?market=${market}&query=${encodeURIComponent(productQuery.trim())}`,
      { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) { setError(payload.message ?? "Your store could not be searched right now."); return; }
    setProducts(payload.products ?? []);
    if (!(payload.products ?? []).length) setProductNote(productCoverage[payload.coverage] ??
      "No matching products were found. Try a different name or paste the product page link.");
  }

  async function start() {
    const hero = products?.find((item) => item.productId === productChoice);
    if (!hero || !brand || !objective) return;
    const currency = marketCurrency(market);
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    if (priceCap.trim() && !(digits ? new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`) : /^\d+$/).test(priceCap.trim())) {
      setError("Enter the price limit as a number, for example 40 or 39.99."); return;
    }
    const softPreferences = [...new Set(preferences.split(",").map((value) => value.trim()).filter(Boolean))];
    if (softPreferences.length > 6 || softPreferences.some((value) => value.length < 3 || value.length > 60)) {
      setError("Enter up to six short preferences, separated by commas."); return;
    }
    setBusy("start"); setError("");
    let runProjectId = projectId && projectObjective === objective ? projectId : "";
    if (!runProjectId) {
      const created = await post("/api/projects", { seedEntityId: brand.id, objective, market,
        name: `${brand.name} · ${GOALS[objective].short}` });
      if (!created.ok) { setBusy(null); setError(created.payload.message ?? "This research could not be set up."); return; }
      runProjectId = created.payload.project.id;
      setProjectId(runProjectId); setProjectObjective(objective);
    }
    const { ok, payload } = await post("/api/personal/runs", { projectId: runProjectId, mode, partnerType: "brand",
      researchMode: "live_commerce", market,
      ...(mode === "direct_pair" ? { partnerEntityId: partner?.id } : {}),
      commerceRequirements: { mustShipToMarket: mustShip, mustBeAvailableNow: mustBeAvailable,
        ...(occasion.trim() ? { occasion: occasion.trim() } : {}),
        ...(softPreferences.length ? { softPreferences } : {}),
        ...(priceCap.trim() ? { priceLimit: { amountMinor: Math.round(Number(priceCap) * 10 ** digits), currencyCode: currency } } : {}),
        heroProduct: { productId: hero.productId, variantId: hero.variantId, title: hero.title,
          ...(hero.categoryId ? { categoryId: hero.categoryId } : {}) } },
      idempotencyKey: crypto.randomUUID() });
    if (!ok) { setBusy(null); setError(payload.message ?? "Research could not start right now."); return; }
    router.push(`/projects/${runProjectId}?run=${payload.runId}`);
  }

  // A two-brand Bundle never contains an item sold in fit sizes, so those are not offered.
  const shownProducts = (products ?? []).filter((item) => !(objective === "product_bundle" && item.sized));

  function goTo(index: number) { setError(""); setStep(index); }
  const partnerValid = mode === "discovery" || Boolean(partner);

  // The brand and country are fixed once confirmed; the goal can change until research starts.
  const goalReady = Boolean(brand && objective && partnerValid && projectId && projectObjective === objective);

  const chosenBrand = resolution?.qloo.candidates.find((item) => item.id === brandChoice);
  return <><Header /><main className="shell rs-page">
    <div className="rs-head"><div>
      <h1>Find a partner for your product</h1>
      <p>Three short steps. We check real products from both stores before suggesting anything.</p></div></div>
    <ol className="rs-steps">
      <Step index={1} label="Brand" step={step} done={step > 1} reachable={false} onSelect={goTo} />
      <Step index={2} label="Goal" step={step} done={goalReady} reachable={step > 1} onSelect={goTo} />
      <Step index={3} label="Product" step={step} done={goalReady && Boolean(productChoice)} reachable={goalReady} onSelect={goTo} /></ol>

    {step > 1 && brand ? <section className="rs-card rs-done"><div><strong>{brand.name}</strong>
      <div><span>{marketName(market)}{brand.website ? ` · ${brand.website.replace(/^https?:\/\//, "")}` : ""}</span></div></div>
    </section> : <section className="rs-card"><h2>Your brand</h2>
      <p>Choose the brand and the country you sell in.</p>
      <form className="rs-form" onSubmit={findBrand}><div className="rs-row">
        <label className="rs-field">Brand name<input value={brandQuery} onChange={(event) => setBrandQuery(event.target.value)}
          minLength={2} maxLength={90} required placeholder="e.g. Caraway" /></label>
        <label className="rs-field">Country<select value={market} onChange={(event) => setMarket(event.target.value)}>
          {MARKETS.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      </div><div><button className="rs-button" type="submit" disabled={busy !== null || brandQuery.trim().length < 2}
        data-busy={busy === "find-brand"} data-unavailable={brandQuery.trim().length < 2}>
        {busy === "find-brand" ? "Searching…" : "Find brand"}</button></div></form>
      {resolution && (resolution.qloo.candidates.length ? <>
        <div className="rs-options" role="radiogroup" aria-label="Matching brands">
          {resolution.qloo.candidates.map((item) => <label className="rs-option" key={item.id}>
            <input type="radio" name="brand" checked={brandChoice === item.id}
              onChange={() => { setBrandChoice(item.id); setWebsiteNeeded(false); setWebsite(""); }} />
            <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span></label>)}
        </div>
        {websiteNeeded && chosenBrand && <div className="rs-form">
          <p className="rs-hint">We couldn&apos;t confirm {chosenBrand.name}&apos;s online store in {marketName(market)} automatically.
            Enter its official website and we&apos;ll check it.</p>
          <label className="rs-field">Official website<input type="url" value={website}
            onChange={(event) => setWebsite(event.target.value)} placeholder="https://yourbrand.com" /></label></div>}
        <div className="rs-actions"><button className="rs-button" type="button" onClick={confirmBrand}
          disabled={busy !== null || !brandChoice || (websiteNeeded && !website.trim())}
          data-busy={busy === "confirm-brand"} data-unavailable={!brandChoice || (websiteNeeded && !website.trim())}>
          {busy === "confirm-brand" ? "Checking…" : "Continue"}</button></div>
      </> : <p className="rs-hint" style={{ marginTop: 16 }}>No brand matched. Check the spelling or try the full brand name.</p>)}
    </section>}

    {step === 2 && <section className="rs-card"><h2>Your goal</h2>
      <div className="rs-choices" role="radiogroup" aria-label="Partnership goal">
        {Object.entries(GOALS).map(([value, goal]) => <label className="rs-choice" key={value}
          data-selected={objective === value}><input type="radio" name="goal" checked={objective === value}
            onChange={() => setObjective(value)} /><strong>{goal.label}</strong><span>{goal.detail}</span></label>)}
      </div>
      <div className="rs-segment rs-mode-switch" role="group" aria-label="Partner">
        <button type="button" aria-pressed={mode === "discovery"} onClick={() => setMode("discovery")}>Suggest partners</button>
        <button type="button" aria-pressed={mode === "direct_pair"} onClick={() => setMode("direct_pair")}>Compare with a brand</button>
      </div>
      {mode === "direct_pair" && <div className="rs-form">
        {partner ? <div className="rs-done"><div><strong>{partner.name}</strong></div>
          <button className="rs-link" type="button" onClick={() => setPartner(null)}>Change</button></div> : <>
          <div className="rs-row-action"><label className="rs-field">Partner brand<input value={partnerQuery}
            onChange={(event) => setPartnerQuery(event.target.value)} placeholder="e.g. Cuyana" /></label>
            <button className="rs-button-quiet" type="button" disabled={busy !== null || partnerQuery.trim().length < 2}
              data-busy={busy === "find-partner"} data-unavailable={partnerQuery.trim().length < 2}
              onClick={findPartner}>Find</button></div>
          {partnerResolution && (partnerResolution.qloo.candidates.length ? <>
            <div className="rs-options">{partnerResolution.qloo.candidates.map((item) => <label className="rs-option" key={item.id}>
              <input type="radio" name="partner" checked={partnerChoice === item.id} onChange={() => setPartnerChoice(item.id)} />
              <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span></label>)}</div>
            <div><button className="rs-button-quiet" type="button" disabled={busy !== null || !partnerChoice}
              data-busy={busy === "confirm-partner"} data-unavailable={!partnerChoice}
              onClick={confirmPartner}>{busy === "confirm-partner" ? "Checking…" : "Use this brand"}</button></div></>
            : <p className="rs-hint">No brand matched. Check the spelling or try the full brand name.</p>)}
        </>}
      </div>}
      <div className="rs-actions"><button className="rs-button" type="button" onClick={continueToProduct}
        disabled={busy !== null || !objective || !partnerValid} data-busy={busy === "continue"}
        data-unavailable={!objective || !partnerValid}>
        {busy === "continue" ? "Continuing…" : "Continue"}</button></div>
    </section>}

    {step === 3 && <section className="rs-card"><h2>Your product</h2>
      <p>Pick one product from your store. Partner products are matched to it.</p>
      <form className="rs-form" onSubmit={findProducts}><div className="rs-row-action">
        <label className="rs-field">Product name or page link<input value={productQuery}
          onChange={(event) => setProductQuery(event.target.value)} minLength={3} maxLength={300}
          placeholder="e.g. Sauté Pan" /></label>
        <button className="rs-button-quiet" type="submit" disabled={busy !== null || productQuery.trim().length < 3}
          data-busy={busy === "find-products"} data-unavailable={productQuery.trim().length < 3}>
          {busy === "find-products" ? "Searching…" : "Search store"}</button></div></form>
      {shownProducts.length > 0 && <div className="rs-options" role="radiogroup" aria-label="Your products">
        {shownProducts.map((item) => <label className="rs-option" key={item.productId}>
          <input type="radio" name="product" checked={productChoice === item.productId}
            onChange={() => setProductChoice(item.productId)} /><span><strong>{item.title}</strong></span>
          {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">View</a>}</label>)}</div>}
      {productNote && <p className="rs-hint" style={{ marginTop: 14 }}>{productNote}</p>}

      <details className="rs-more"><summary>More options</summary>
        <div className="rs-form">
          <label className="rs-field">Occasion <small>Optional, e.g. a weekend camping trip</small>
            <input value={occasion} maxLength={100} onChange={(event) => setOccasion(event.target.value)} /></label>
          <label className="rs-field">Preferences <small>Optional, separated by commas, e.g. organic cotton</small>
            <input value={preferences} maxLength={365} onChange={(event) => setPreferences(event.target.value)} /></label>
          <label className="rs-field">Maximum partner price ({marketCurrency(market)}) <small>Optional</small>
            <input value={priceCap} inputMode="decimal" onChange={(event) => setPriceCap(event.target.value)} /></label>
          <div className="rs-checks">
            <label className="rs-check"><input type="checkbox" checked={mustShip} onChange={(event) => setMustShip(event.target.checked)} />
              Both products must ship to {marketName(market)}</label>
            <label className="rs-check"><input type="checkbox" checked={mustBeAvailable} onChange={(event) => setMustBeAvailable(event.target.checked)} />
              Both products must be in stock now</label></div>
        </div></details>

      <div className="rs-actions"><button className="rs-button" type="button" onClick={start}
        disabled={busy !== null || !productChoice} data-busy={busy === "start"} data-unavailable={!productChoice}>
        {busy === "start" ? "Starting…" : mode === "direct_pair" ? `Compare with ${partner?.name ?? "partner"}` : "Find partners"}</button>
        <button className="rs-link" type="button" onClick={() => goTo(2)}>Back</button></div>
    </section>}

    {error && <p className="rs-error" role="alert">{error}</p>}
  </main></>;
}
