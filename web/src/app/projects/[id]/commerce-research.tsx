"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Candidate = { id: string; name: string; description?: string | null; website?: string | null };
type Resolution = { id: string; qloo: { candidates: Candidate[] }; message: string };
type Offer = { status: string; title?: string; url?: string | null;
  price?: { amountMinor: number; currencyCode: string } | null; available?: boolean | null;
  checkedAt?: string; message?: string; selectedOptions?: string[];
  marketCheck?: { state: string } };
type SeedProduct = { productId: string; variantId: string; title: string; url?: string | null };
type Assessment = { policyVersion: string; status: "supported" | "needs_verification" | "unsupported";
  culturalRelationship: string; culturalExplanation: string; culturalTheme?: string | null;
  reasonCodes: string[]; currentOfferReview?: "current" | "changed_since_assessment" | "refresh_unavailable" | "not_checked";
  materialUnknowns: string[]; dealUnknowns: string[]; reviewFlags?: string[];
  assortmentScope?: { observedFamilies: string[]; inspectedQueries: string[];
    coverage: string; limitationNotes: string[] } | null;
  rankingFeatures?: { objectiveSuitability?: string; productQuality?: string;
    culturalExplanation?: string; partnerDifferentiation?: string } | null;
  productMechanism: { boundedRationale: string; roles: { seedRole: string; partnerRole: string } } };
type Match = { id: string; partnerEntityId: string; partnerName: string; score: Assessment;
  savedScore?: Assessment & { evaluatedAt?: string }; savedAt?: string | null;
  evidence?: { commerce?: { identitySourceRefs?: string[]; culturalSourceRefs?: string[];
    externalSourceRefs?: string[];
    externalFindings?: { kind: string; url: string; publishedAt?: string | null }[] } };
  currentOffers?: { seed: Offer; partner: Offer };
  conceptOptions?: { id: string; title: string; format: string; summary: string }[];
  briefId?: string | null; briefMarkdown?: string | null; briefRevision?: number | null };
type AudienceFit = { status: "specific_patterns_observed" | "no_specific_pattern_observed" | "unavailable";
  connections: { name: string }[]; demographicStatus: "not_requested" | "observed" | "unavailable";
  sharedDemographicSignals: { age: string[]; gender: string[] } | null };
type Run = { id: string; kind: string; status: string; stage: string; seedName: string;
  errorCode?: string | null;
  result?: { message?: string; coverage?: string; stopReason?: string };
  matches: Match[] };

const title = { supported: "Supported opportunity", needs_verification: "Needs verification",
  unsupported: "Unsupported" };
const coverageMessage: Record<string, string> = {
  seed_storefront_unverified: "We confirmed the starting business but could not verify a product store linked to it.",
  seed_identity_unverified: "The starting business could not be confirmed against its current public sources.",
  storefront_identity_unverified: "A product store could not be linked to the businesses reviewed.",
  storefront_probe_unavailable: "A product store could not be reached for verification right now.",
  catalog_capability_unavailable: "The verified stores did not provide enough product detail for this review.",
  no_catalog_results: "No suitable product listings were returned in the reviewed searches.",
  no_verified_product_opportunity: "No product opportunity was verified within this review.",
  catalog_rate_limited: "Current product research was temporarily limited. Please retry later.",
  catalog_unavailable: "Current product research could not reach the store. Please retry later.",
  selected_seed_product_unverified: "The chosen starting product or variant could not be confirmed. Please choose it again.",
  no_source_backed_context_reference: "This product's description did not establish a specific cultural connection for partner discovery. Choose another product with a clearly documented cultural context.",
  no_resolved_context_signal: "A product detail suggested a cultural reference, but no matching cultural signal could be confirmed.",
  no_qloo_context_recommendation: "The confirmed cultural reference did not return usable partner suggestions right now.",
  no_qloo_brand_candidates: "No partner brands were returned for this confirmed cultural reference.",
  context_candidate_identity_unverified: "Suggested businesses could not be confirmed as suitable partners in this review.",
  qloo_unavailable: "Cultural partner suggestions were temporarily unavailable.",
};
const currencyDigits = (currency: string) => new Intl.NumberFormat("en", { style: "currency", currency })
  .resolvedOptions().maximumFractionDigits ?? 2;
function rankingReasons(features: NonNullable<Assessment["rankingFeatures"]>) {
  const objective = { matches_explicit_focus: "Matches your selected focus",
    clearly_serves_objective: "Clear fit for your objective",
    adequately_serves_objective: "Fits your objective" };
  const quality = { distinct_concrete_joint_value: "Detailed product benefits",
    credible_joint_value: "Concrete complementary roles" };
  const culture = { specific_theme: "Specific cultural connection",
    broad_theme: "Broad cultural connection",
    no_named_theme: "Cultural connection without a verified theme" };
  return [objective[features.objectiveSuitability as keyof typeof objective],
    quality[features.productQuality as keyof typeof quality],
    culture[features.culturalExplanation as keyof typeof culture],
    features.partnerDifferentiation === "evidenced_partner_specific_reason"
      ? "Verified detail specific to this partner" : null].filter(Boolean).join(" · ");
}
function groupedMatches(matches: Match[]) {
  return (["supported", "needs_verification", "unsupported"] as const).map((status) => {
    const byPartner = new Map<string, Match[]>();
    for (const match of matches.filter((item) => item.score?.status === status)) {
      const key = match.partnerEntityId || match.partnerName;
      byPartner.set(key, [...(byPartner.get(key) ?? []), match]);
    }
    return { status, partners: [...byPartner.values()] };
  }).filter((section) => section.partners.length);
}
function OfferCard({ label, offer }: { label: string; offer?: Offer }) {
  if (!offer || offer.status !== "current") return <p>{label}: {offer?.message ?? "Current offer not verified."}</p>;
  const price = offer.price ? new Intl.NumberFormat(undefined, { style: "currency",
    currency: offer.price.currencyCode }).format(offer.price.amountMinor /
      10 ** currencyDigits(offer.price.currencyCode)) : "Price not verified";
  return <p>{label}: {offer.url ? <a href={offer.url} target="_blank" rel="noopener noreferrer">{offer.title}</a>
    : offer.title}{offer.selectedOptions?.length ? ` (${offer.selectedOptions.join(", ")})` : ""} · {price} · {offer.available === true ? "Available when checked"
      : offer.available === false ? "Unavailable when checked" : "Availability unknown"}
    {offer.marketCheck && <> · {offer.marketCheck.state === "supported"
      ? "Shown for the selected market when checked" : offer.marketCheck.state === "contradicted"
        ? "Selected market requirement not met" : "Selected market delivery not confirmed"}</>}
    {offer.checkedAt && <> · Checked {new Date(offer.checkedAt).toLocaleString()}</>}</p>;
}

export function CommerceResearch({ projectId, objective, requiresSelectedProduct = false }:
  { projectId: string; objective: string; requiresSelectedProduct?: boolean }) {
  const [runs, setRuns] = useState<{ id: string; status: string; createdAt: string }[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [mode, setMode] = useState<"discovery" | "direct_pair">("discovery");
  const [market, setMarket] = useState("US");
  const [mustShip, setMustShip] = useState(false);
  const [mustBeAvailable, setMustBeAvailable] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [softPreferences, setSoftPreferences] = useState("");
  const [priceCap, setPriceCap] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("USD");
  const [seedProducts, setSeedProducts] = useState<SeedProduct[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [selectedHero, setSelectedHero] = useState("");
  const [productCoverage, setProductCoverage] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [qlooId, setQlooId] = useState("");
  const [partner, setPartner] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Record<string, string>>({});
  const [audienceFit, setAudienceFit] = useState<Record<string, AudienceFit>>({});
  const audienceRequested = useRef(new Set<string>());

  const loadRuns = useCallback(async () => {
    const response = await fetch(`/api/personal/runs?projectId=${projectId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Research history is unavailable.");
    setRuns((await response.json()).runs ?? []);
  }, [projectId]);
  const loadRun = useCallback(async (id: string) => {
    const response = await fetch(`/api/personal/runs/${id}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Research unavailable.");
    setRun(payload.run);
    await loadRuns();
  }, [loadRuns]);
  async function refreshMatch(matchId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/personal/matches/${matchId}/current-offers`,
        { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Current product details are unavailable.");
      setRun((current) => current ? { ...current, matches: current.matches.map((item) =>
        item.id === matchId ? { ...item, ...payload.match } : item) } : current);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Current product details are unavailable."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    queueMicrotask(() => loadRuns().catch((failure) => setError(failure.message)));
  }, [loadRuns]);
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const timer = window.setInterval(() => loadRun(run.id).catch((failure) => setError(failure.message)), 2200);
    return () => window.clearInterval(timer);
  }, [run, loadRun]);
  useEffect(() => {
    if (!run || !["completed", "partial"].includes(run.status)) return;
    const shortlist = new Map<string, Match>();
    for (const match of run.matches) {
      if (!["supported", "needs_verification"].includes(match.score?.status) ||
          match.score?.culturalRelationship === "contradicted") continue;
      if (!shortlist.has(match.partnerEntityId)) shortlist.set(match.partnerEntityId, match);
    }
    async function inspect() {
      for (const [partnerId, match] of shortlist) {
        const key = `${run!.id}:${partnerId}`;
        if (audienceRequested.current.has(key)) continue;
        audienceRequested.current.add(key);
        try {
          const response = await fetch(`/api/personal/matches/${match.id}/audience-fit?demographics=auto`,
            { cache: "no-store" });
          if (!response.ok) continue;
          const payload = await response.json();
          setAudienceFit((current) => ({ ...current, [key]: payload.audience }));
        } catch { /* Optional evidence must not interrupt the product review. */ }
      }
    }
    void inspect();
  }, [run]);

  async function resolvePartner() {
    setBusy(true); setError(""); setPartner(null);
    try {
      const response = await fetch("/api/entities/resolve", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: partnerName.trim(), purpose: "commerce_partner" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Partner could not be found.");
      setResolution(payload); setQlooId("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Partner lookup unavailable."); }
    finally { setBusy(false); }
  }
  async function confirmPartner() {
    if (!resolution || !qlooId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/entities/confirm", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionId: resolution.id, qlooId, purpose: "commerce_partner" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Partner could not be confirmed.");
      setPartner({ id: payload.entity.id, name: payload.entity.name }); setResolution(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Partner confirmation unavailable."); }
    finally { setBusy(false); }
  }
  async function start() {
    setBusy(true); setError("");
    try {
      let digits = 2;
      if (priceCap.trim()) {
        try { digits = currencyDigits(priceCurrency.trim().toUpperCase()); }
        catch { throw new Error("Enter a valid three-letter price currency."); }
      }
      const pricePattern = digits ? new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`) : /^\d+$/;
      if (priceCap.trim() && !pricePattern.test(priceCap.trim())) {
        throw new Error(`Enter a price with no more than ${digits} decimal places.`);
      }
      const hero = seedProducts.find((item) => item.productId === selectedHero);
      if (requiresSelectedProduct && !hero) throw new Error("Choose a starting product from your store.");
      if (productQuery.trim() && !hero) throw new Error("Select an exact result from your product search, or clear the search for automatic discovery.");
      const preferences = [...new Set(softPreferences.split(",")
        .map((value) => value.trim()).filter(Boolean))];
      if (preferences.length > 6 || preferences.some((value) => value.length < 3 || value.length > 60)) {
        throw new Error("Enter up to six short product preferences, separated by commas.");
      }
      const response = await fetch("/api/personal/runs", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, mode, partnerType: "brand", researchMode: "live_commerce",
          ...(mode === "direct_pair" ? { partnerEntityId: partner?.id } : {}),
          market: market.trim().toUpperCase(),
          commerceRequirements: { mustShipToMarket: mustShip, mustBeAvailableNow: mustBeAvailable,
            ...(occasion.trim() ? { occasion: occasion.trim() } : {}),
            ...(preferences.length ? { softPreferences: preferences } : {}),
            ...(priceCap.trim() ? { priceLimit: { amountMinor: Math.round(Number(priceCap) * 10 ** digits),
              currencyCode: priceCurrency.trim().toUpperCase() } } : {}),
            ...(hero ? { heroProduct: { productId: hero.productId,
              variantId: hero.variantId } } : {}) },
          idempotencyKey: crypto.randomUUID() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Research could not start.");
      await loadRun(payload.runId);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Research unavailable."); }
    finally { setBusy(false); }
  }
  async function loadSeedProducts() {
    setBusy(true); setError("");
    try {
      if (productQuery.trim().length < 3) throw new Error("Enter a product name or product page URL.");
      const response = await fetch(`/api/projects/${projectId}/commerce-products?market=${encodeURIComponent(market)}&query=${encodeURIComponent(productQuery.trim())}`,
        { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Starting products could not be loaded.");
      setSeedProducts(payload.products ?? []); setSelectedHero("");
      setProductCoverage(payload.coverage ?? "");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Products unavailable."); }
    finally { setBusy(false); }
  }
  async function createProposal(match: Match, conceptId?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/personal/matches/${match.id}/proposal`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(conceptId ? { conceptId } : {}) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Proposal could not be prepared.");
      await loadRun(run!.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Proposal unavailable."); }
    finally { setBusy(false); }
  }
  async function saveProposal(match: Match) {
    if (!match.briefId || !match.briefRevision) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/personal/briefs/${match.briefId}`, { method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: match.briefRevision, markdown: proposal[match.id] }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Proposal could not be saved.");
      await loadRun(run!.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Proposal unavailable."); }
    finally { setBusy(false); }
  }
  function downloadProposal(match: Match) {
    const markdown = proposal[match.id] ?? match.briefMarkdown ?? "";
    if (!markdown) return;
    const objectUrl = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "partnership-proposal.md";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  return <section className="account-panel preview-panel"><span className="workspace-kicker">PARTNER RESEARCH</span>
    <h2>{objective === "product_bundle" ? "Find a product bundle partner" : "Find a cross-sell partner"}</h2>
    <p>Explore existing products from culturally connected brands. Each product opportunity is assessed separately.</p>
    <div className="research-form">
      <div className="research-grid research-grid-two">
        <label className="research-field">Research path<select value={mode}
          onChange={(event) => { setMode(event.target.value as "discovery" | "direct_pair"); setRun(null); }}>
          <option value="discovery">Find partners</option>{!requiresSelectedProduct &&
            <option value="direct_pair">Compare two brands</option>}
        </select></label>
        <label className="research-field">Market country code<input value={market} maxLength={2}
          onChange={(event) => { setMarket(event.target.value.toUpperCase()); setSeedProducts([]); setSelectedHero(""); }}
          aria-describedby="market-help" /></label>
      </div>
      <p className="research-help" id="market-help">Current offers are checked for this market. Use a two-letter country code, such as US.</p>
      <fieldset className="research-requirements"><legend>Required offer conditions</legend>
        <label className="research-check"><input type="checkbox" checked={mustShip}
          onChange={(event) => setMustShip(event.target.checked)} /><span>Shipping to this market must be verified</span></label>
        <label className="research-check"><input type="checkbox" checked={mustBeAvailable}
          onChange={(event) => setMustBeAvailable(event.target.checked)} /><span>Both selected products must be available now</span></label>
      </fieldset>
      <div className="research-grid research-grid-three">
        <label className="research-field">Specific use occasion <span>(optional)</span><input value={occasion}
          maxLength={100} onChange={(event) => setOccasion(event.target.value)}
          placeholder="e.g. a weekend travel kit" /></label>
        <label className="research-field">Maximum partner product price <span>(optional)</span><input value={priceCap}
          inputMode="decimal" onChange={(event) => setPriceCap(event.target.value)} placeholder="Amount" /></label>
        <label className="research-field">Price currency<input value={priceCurrency} maxLength={3}
          disabled={!priceCap.trim()}
          onChange={(event) => setPriceCurrency(event.target.value.toUpperCase())} /></label>
      </div>
      <label className="research-field">Product preferences <span>(optional)</span><input value={softPreferences}
        onChange={(event) => setSoftPreferences(event.target.value)} maxLength={365}
        placeholder="e.g. organic cotton, botanical print" /></label>
      <p className="research-help">Preferences guide product research and ranking when the listings verify them. They do not guarantee a match.</p>
      <div className="research-product"><div><h3>Your product focus</h3><p>{requiresSelectedProduct
        ? "Enter one product from your verified store, then choose it from the results."
        : "Enter a product name or its product page URL to focus the search. Leave this blank to explore your store automatically."}</p></div>
        <div className="research-search-row"><label className="research-field" htmlFor="starting-product-query">Product name or page URL
          <input id="starting-product-query" value={productQuery} maxLength={300}
            onChange={(event) => { setProductQuery(event.target.value); setSeedProducts([]); setSelectedHero(""); setProductCoverage(""); }}
            placeholder="e.g. Made in Italy Ballet Flat" /></label>
          <button className="button button-dark" type="button" disabled={busy || market.length !== 2 ||
            productQuery.trim().length < 3} onClick={loadSeedProducts}>Search my store</button></div>
        {seedProducts.length > 0 && <fieldset className="research-product-results"><legend>Choose your product</legend>
          {seedProducts.map((item) => <label className="research-product-option" key={item.productId}>
            <input type="radio" name="starting-product" checked={selectedHero === item.productId}
              onChange={() => setSelectedHero(item.productId)} /><span><strong>{item.title}</strong></span>
            {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}>View listing</a>}</label>)}
          <p className="research-help">These are matching products from your store. Refine the name or paste a product URL if yours is missing.</p>
        </fieldset>}
        {productCoverage && !seedProducts.length && <p className="research-help" role="status">{coverageMessage[productCoverage] ??
          "No exact product was confirmed in this search. Try its product page URL or a more specific name."}</p>}
      </div>
    </div>
    {mode === "direct_pair" && <><div className="preview-controls"><label>Partner brand
      <input value={partnerName} onChange={(event) => { setPartnerName(event.target.value); setPartner(null); }}
        placeholder="Brand name" /></label><button type="button" disabled={busy || partnerName.trim().length < 2}
        onClick={resolvePartner}>Find brand</button></div>
      {resolution && <div className="brand-resolution"><p>{resolution.message}</p>
        {resolution.qloo.candidates.map((item) => <label className="brand-choice" key={item.id}>
          <input type="radio" name="commerce-partner" checked={qlooId === item.id}
            onChange={() => setQlooId(item.id)} /><span>{item.name}</span></label>)}
        <button type="button" disabled={busy || !qlooId} onClick={confirmPartner}>Confirm brand</button></div>}
      {partner && <p>Comparing with {partner.name}.</p>}</>}
    <button className="button button-dark" type="button" disabled={busy || (mode === "direct_pair" && !partner)}
      onClick={start}>{busy ? "Working…" : mode === "discovery" ? "Find partners" : "Compare brands"}</button>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {runs.length > 0 && <div className="preview-history"><h3>Research runs</h3>
      {runs.map((item) => <button key={item.id} type="button"
        onClick={() => loadRun(item.id).catch((failure) => setError(failure.message))}>
        {new Date(item.createdAt).toLocaleString()} · {item.status}</button>)}</div>}
    {run && <div className="preview-result"><h3>{run.kind === "discovery" ? "Partner opportunities" : "Brand comparison"}</h3>
      <p role="status">{run.status === "failed" &&
        run.errorCode === "commerce_catalog_rate_limited"
        ? "Product research could not finish after temporary storefront limits. Try again later."
        : ["queued", "running"].includes(run.status) ? run.stage : run.result?.message ?? run.stage}</p>
      {run.result?.coverage === "partial_assortment" && <p>Catalog coverage: We reviewed a limited sample of current listings. Other products or combinations may exist.</p>}
      {run.result?.coverage && run.result.coverage !== "partial_assortment" &&
        !["queued", "running"].includes(run.status) &&
        <p>{coverageMessage[run.result.coverage] ?? "Product research was incomplete. Another combination may be available."}</p>}
      {run.result?.stopReason === "candidate_cap_reached" &&
        <p>Research stopped after the planned partner sample. Other culturally connected brands may exist.</p>}
      {run.result?.stopReason === "catalog_budget_reached" &&
        <p>Research stopped at the current product review limit.</p>}
      {run.result?.stopReason === "research_time_limit_reached" &&
        <p>Research reached its time limit. Other product combinations may still exist.</p>}
      {run.result?.stopReason === "catalog_rate_limited" &&
        <p>Product research was limited by the current storefront response.</p>}
      {run.result?.stopReason === "catalog_unavailable" &&
        <p>The product store could not be reached during this review. Please retry later.</p>}
      {groupedMatches(run.matches).map((section) => <section key={section.status}>
        <h4>{title[section.status]}</h4>
        {section.partners.map((opportunities) => <div key={opportunities[0].partnerEntityId}>
          <h5>{opportunities[0].partnerName}</h5>
          <p>These pairings cover selected products from a limited review. Other products from this partner may offer a better fit.</p>
          {opportunities.map((match, index) => <article className="preview-match" key={match.id}>
        <strong>{index === 0 ? "Best reviewed combination" : "Another reviewed combination"}</strong>
        {match.score?.currentOfferReview === "changed_since_assessment" &&
          <p role="status">Current offer facts changed or could not be confirmed. This opportunity needs a new review before a proposal.</p>}
        {match.score?.currentOfferReview === "refresh_unavailable" &&
          <p role="status">Live offer refresh is temporarily unavailable. The saved assessment was {
            match.savedScore?.status?.replaceAll("_", " ") ?? "recorded"} on {
            match.savedScore?.evaluatedAt ? new Date(match.savedScore.evaluatedAt).toLocaleString()
              : "an earlier date"}; current details need a new check before a proposal.</p>}
        {match.score?.currentOfferReview === "not_checked" &&
          <p role="status">This is the saved assessment. Check these exact products for current details before using this opportunity.</p>}
        <p>Cultural connections: {match.score?.culturalRelationship === "native_recommendation_verified"
          ? "Recommended from the starting brand’s cultural profile."
          : match.score?.culturalRelationship === "direct_pair_supported" && match.score.culturalTheme
            ? `Both brands have source-backed connections to ${match.score.culturalTheme}.`
            : "The specific cultural relationship still needs verification."}</p>
        {audienceFit[`${run.id}:${match.partnerEntityId}`]?.status === "specific_patterns_observed" && <div>
            <p>Cultural audience patterns: Both brands are associated with {audienceFit[`${run.id}:${match.partnerEntityId}`].connections
                .map((item) => item.name).join(", ")} in separate cultural research. This suggests a possible shared cultural territory.</p>
            {audienceFit[`${run.id}:${match.partnerEntityId}`].demographicStatus === "observed" &&
              (audienceFit[`${run.id}:${match.partnerEntityId}`].sharedDemographicSignals?.age.length ||
                audienceFit[`${run.id}:${match.partnerEntityId}`].sharedDemographicSignals?.gender.length) ?
              <p>Aggregate preference patterns: {audienceFit[`${run.id}:${match.partnerEntityId}`].sharedDemographicSignals?.age.length
                ? `These age groups show stronger-than-average affinity with both brands: ${audienceFit[`${run.id}:${match.partnerEntityId}`].sharedDemographicSignals!.age
                  .map((age) => age.replaceAll("_", " ")).join(", ")}.` : ""}
                {audienceFit[`${run.id}:${match.partnerEntityId}`].sharedDemographicSignals?.gender.length
                  ? ` These gender groups show stronger-than-average affinity with both brands: ${audienceFit[`${run.id}:${match.partnerEntityId}`].sharedDemographicSignals!.gender.join(", ")}.`
                  : ""}</p> : null}
            <p>These are cultural preference signals, not a measure of shared customers or likely sales.</p>
        </div>}
        {match.evidence?.commerce?.culturalSourceRefs?.length ? <p>Cultural sources: {match.evidence.commerce.culturalSourceRefs.map((url, sourceIndex) =>
          <a key={url} href={url} target="_blank" rel="noopener noreferrer">Source {sourceIndex + 1} </a>)}</p> : null}
        <OfferCard label={run.seedName} offer={match.currentOffers?.seed} />
        <OfferCard label={match.partnerName + " storefront"} offer={match.currentOffers?.partner} />
        {match.score?.currentOfferReview !== "current" &&
          <button type="button" disabled={busy} onClick={() => refreshMatch(match.id)}>
            Check current products</button>}
        <p>Seller is the verified storefront; the product maker has not been separately confirmed.</p>
        {match.evidence?.commerce?.identitySourceRefs?.length ? <p>Partner identity: {match.evidence.commerce.identitySourceRefs.map((url) =>
          <a key={url} href={url} target="_blank" rel="noopener noreferrer">Official source</a>)}</p> : null}
        {match.evidence?.commerce?.externalFindings?.length ? <p>Further public context to review: {match.evidence.commerce.externalFindings.map((finding, sourceIndex) =>
          <a key={finding.url} href={finding.url} target="_blank" rel="noopener noreferrer">
            {finding.kind === "official_context" ? "Official source" : "Independent source"} {sourceIndex + 1}
            {finding.publishedAt ? ` (${new Date(finding.publishedAt).toLocaleDateString()})` : " (date unverified)"} </a>)}</p> : null}
        <p>Why together: {match.score?.productMechanism?.boundedRationale ||
          "The product relationship needs more evidence."}</p>
        {match.score?.reviewFlags?.includes("generic_co_use_only") &&
          <p>Potential challenge: The selected items may be used at the same time, but the reviewed details do not show a clear additional benefit from pairing them.</p>}
        {match.score?.reviewFlags?.includes("selected_product_compatibility_unverified") &&
          <p>Potential challenge: Check the selected product’s care instructions and confirm that the proposed treatment is suitable before using this idea.</p>}
        {match.score?.reviewFlags?.includes("selected_offer_explicit_third_party_cobrand") &&
          <p>Potential challenge: A selected product names another brand. Confirm who made it and what campaign rights would be needed; the verified store is the prospective supplier.</p>}
        {match.score?.assortmentScope && <p>Reviewed assortment: {match.score.assortmentScope.observedFamilies
          .map((family) => family.replaceAll("_", " ")).join(", ") || "Selected products only"}.
          {match.score.assortmentScope.coverage === "partial" && " This was a limited sample, not the full catalog."}
          {match.score.assortmentScope.inspectedQueries?.length ?
            ` Product searches included ${match.score.assortmentScope.inspectedQueries.join(", ")}.` : ""}</p>}
        {match.score?.rankingFeatures && <p>Why it ranks here: {
          rankingReasons(match.score.rankingFeatures)}.</p>}
        {match.score?.materialUnknowns?.length ? <p>Potential challenges: {match.score.materialUnknowns.join(", ")}.</p> : null}
        <p>Partner interest, commercial rights, pricing terms and fulfillment still need agreement.</p>
        {match.briefId ? <><h5>Proposal Studio</h5>
          <textarea aria-label={"Proposal for " + match.partnerName}
            value={proposal[match.id] ?? match.briefMarkdown ?? ""}
            onChange={(event) => setProposal((current) => ({ ...current, [match.id]: event.target.value }))} />
          <button type="button" disabled={busy} onClick={() => saveProposal(match)}>Save proposal</button>
          <button type="button" onClick={() => downloadProposal(match)}>Download draft</button></>
          : match.conceptOptions?.length ? <div><h5>Choose a product concept</h5>
            {match.conceptOptions.map((concept) => <div key={concept.id}><strong>{concept.title}</strong>
              <p>{concept.summary}</p><button type="button"
                disabled={busy || match.score?.status !== "supported" ||
                  match.score?.currentOfferReview !== "current"}
                onClick={() => createProposal(match, concept.id)}>Use this concept</button></div>)}</div>
            : <button type="button" disabled={busy || match.score?.status !== "supported" ||
                match.score?.currentOfferReview !== "current"}
              onClick={() => createProposal(match)}>Develop three concepts</button>}
        {!match.briefId && match.score?.status !== "supported" &&
          <p>The product opportunity needs further verification before concept development.</p>}
      </article>)}</div>)}</section>)}
    </div>}
  </section>;
}
