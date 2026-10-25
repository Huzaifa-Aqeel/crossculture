"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter } from "next/navigation";

type Offer = { status: string; title?: string; url?: string | null;
  price?: { amountMinor: number; currencyCode: string } | null; available?: boolean | null;
  message?: string; selectedOptions?: string[]; marketCheck?: { state: string } };
type Assessment = { policyVersion: string; status: "supported" | "needs_verification" | "unsupported";
  culturalRelationship: string; culturalExplanation: string; culturalTheme?: string | null;
  culturalThemes?: string[]; sharedAudienceTastes?: string[];
  reasonCodes: string[]; currentOfferReview?: "current" | "changed_since_assessment" | "refresh_unavailable" | "not_checked";
  materialUnknowns: string[]; dealUnknowns: string[]; reviewFlags?: string[];
  assortmentScope?: { observedFamilies: string[]; coverage: string } | null;
  rankingFeatures?: { objectiveSuitability?: string; productQuality?: string;
    culturalExplanation?: string; partnerDifferentiation?: string } | null;
  productMechanism: { boundedRationale: string; customerReason?: string; roles: { seedRole: string; partnerRole: string } } };
type Match = { id: string; partnerEntityId: string; partnerName: string; partnerDescription?: string | null; score: Assessment;
  savedScore?: Assessment & { evaluatedAt?: string }; savedAt?: string | null;
  evidence?: { commerce?: { identitySourceRefs?: string[]; culturalSourceRefs?: string[];
    externalFindings?: { kind: string; url: string; publishedAt?: string | null }[] } };
  currentOffers?: { seed: Offer; partner: Offer };
  briefId?: string | null };
type Run = { id: string; kind: string; status: string; stage: string; seedName: string;
  errorCode?: string | null; createdAt?: string;
  result?: { message?: string; coverage?: string; stopReason?: string }; matches: Match[] };
type Launch = { status: string; areas: string[] };

const STATUS = { supported: ["Recommended", "rs-pill-good"], needs_verification: ["Needs checking", "rs-pill-check"],
  unsupported: ["Not suitable", "rs-pill-no"] } as const;
const UNKNOWN_LABELS: Record<string, string> = {
  product_mechanism: "The product benefit needs more evidence from the listings.",
  objective_fit: "How well this serves your goal needs checking.",
  cultural_relationship: "The cultural link between the brands is not confirmed.",
  identity: "A store or seller detail needs confirming.",
  product_attributes: "Some product details could not be confirmed.",
  joint_use: "How the products are used together needs checking.",
  incremental_value: "The added benefit of pairing them needs checking.",
  requirement_shipping: "Shipping to your market is not confirmed.",
  requirement_seedAvailability: "Your product's availability is not confirmed.",
  requirement_partnerAvailability: "The partner product's availability is not confirmed.",
  requirement_partnerPrice: "The partner product's price is not confirmed against your limit.",
};
const RUN_NOTES: Record<string, string> = {
  no_partner_product_fit: "None of the suggested brands sell products that add value to this product for your goal. Try another product or the other goal.",
  no_verified_product_opportunity: "No opportunity could be confirmed in this review.",
  seed_storefront_unverified: "Your store could not be reached for this review.",
  seed_identity_unverified: "Your brand could not be confirmed for this review.",
  selected_seed_product_unverified: "Your chosen product could not be confirmed. Start a new search and pick it again.",
  catalog_rate_limited: "Stores were busy during this review. Please try again shortly.",
  catalog_unavailable: "A store could not be reached during this review. Please try again shortly.",
  qloo_unavailable: "Partner suggestions were unavailable. Please try again shortly.",
};

const digitsFor = (currency: string) => new Intl.NumberFormat("en", { style: "currency", currency })
  .resolvedOptions().maximumFractionDigits ?? 2;
function priceText(offer?: Offer) {
  if (!offer?.price) return null;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: offer.price.currencyCode })
    .format(offer.price.amountMinor / 10 ** digitsFor(offer.price.currencyCode));
}
function ProductTile({ label, offer, fallback, checking }: { label: string; offer?: Offer; fallback: string; checking?: boolean }) {
  const current = offer?.status === "current";
  const details = [current ? priceText(offer) : null,
    current ? offer?.available === true ? "In stock" : offer?.available === false ? "Out of stock" : null : null]
    .filter(Boolean).join(" · ");
  const name = offer?.title ?? fallback;
  return <div className="rs-product"><small>{label}</small>
    {offer?.url ? <a href={offer.url} target="_blank" rel="noopener noreferrer">{name}</a> : <strong>{name}</strong>}
    <span>{checking ? "Loading current details…" : details || (current ? "Current details checked" : "Current details not loaded")}</span></div>;
}
const listText = (items: string[]) => items.length < 2 ? items.join("")
  : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function culturalLine(score: Assessment, seedName: string, partnerName: string) {
  const themes = (score.culturalThemes?.length ? score.culturalThemes : score.culturalTheme ? [score.culturalTheme] : [])
    .map((theme) => theme.toLowerCase());
  const tastes = score.sharedAudienceTastes ?? [];
  const affinity = score.culturalRelationship === "native_recommendation_verified"
    ? `${seedName}'s customers also favor ${partnerName}.`
    : score.culturalRelationship === "direct_pair_supported"
      ? `${partnerName}'s customers also favor ${seedName}.` : "";
  if (!affinity && !themes.length) return "The cultural link between these brands is not confirmed.";
  return [affinity, themes.length ? `Both brands are known for ${listText(themes)}.` : "",
    tastes.length ? `Their audiences share a taste for ${listText(tastes)}.` : ""].filter(Boolean).join(" ");
}

// The first sentence of the partner's brand description, kept short.
function aboutLine(description?: string | null) {
  const sentence = String(description ?? "").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
}
function challenges(score: Assessment) {
  const items = new Set<string>();
  if (score.currentOfferReview === "changed_since_assessment") items.add("A product's current details changed since this review.");
  if (score.reviewFlags?.includes("selected_product_compatibility_unverified")) items.add("Check the product care instructions before suggesting the treatment.");
  if (score.reviewFlags?.includes("selected_offer_explicit_third_party_cobrand")) items.add("A product names another brand; confirm the maker and any campaign rights.");
  for (const unknown of score.materialUnknowns ?? []) if (UNKNOWN_LABELS[unknown]) items.add(UNKNOWN_LABELS[unknown]);
  return [...items];
}

const sentenceCase = (text: string) => {
  const value = text.trim();
  return value ? `${value[0].toUpperCase()}${value.slice(1)}${/[.!?]$/.test(value) ? "" : "."}` : "";
};

type Action = "check";

function Opportunity({ projectId, match, others, run, pending, launch, onShow, onCheck }: {
  projectId: string; match: Match; others: Match[]; run: Run; pending: Record<string, Action>; launch?: Launch;
  onShow: (match: Match) => void; onCheck: (match: Match) => void }) {
  const router = useRouter();
  // One partner card can hold several product combinations; the user picks which one to view.
  const combinations = [match, ...others];
  const [shownId, setShownId] = useState(match.id);
  const shown = combinations.find((item) => item.id === shownId) ?? match;
  const score = shown.score;
  const action = pending[shown.id];
  const [label, pill] = STATUS[score.status] ?? STATUS.needs_verification;
  const issues = challenges(score);
  const commerce = shown.evidence?.commerce;
  // Live product names, prices and links load as soon as a combination is shown.
  useEffect(() => { onShow(shown); }, [shown, onShow]);
  const changed = score.currentOfferReview === "changed_since_assessment";
  const checkFailed = score.currentOfferReview === "refresh_unavailable";
  const canPropose = score.status === "supported" && !changed;
  return <article className="rs-opportunity">
    <div className="rs-opp-head"><div><h3>{shown.partnerName}</h3>
      {aboutLine(shown.partnerDescription) && <p className="rs-opp-about">{aboutLine(shown.partnerDescription)}</p>}</div>
      <span className={`rs-pill ${pill}`}>{label}</span></div>
    <div className="rs-products">
      <ProductTile label="Your product" offer={shown.currentOffers?.seed} checking={action === "check"}
        fallback={score.productMechanism?.roles?.seedRole || "Your product"} />
      <span className="rs-plus" aria-hidden="true">+</span>
      <ProductTile label={shown.partnerName} offer={shown.currentOffers?.partner} checking={action === "check"}
        fallback={score.productMechanism?.roles?.partnerRole || "Partner product"} />
    </div>
    {changed && <p className="rs-note-warn">A product or price changed since this was reviewed, so a proposal can&apos;t be created from it. Start a new search for an up-to-date result.</p>}
    {checkFailed && action !== "check" && <p className="rs-note-warn">Current product details couldn&apos;t be loaded.{" "}
      <button className="rs-link" type="button" onClick={() => onCheck(shown)}>Try again</button></p>}
    <dl className="rs-facts">
      <div className="rs-fact"><dt>Why it fits</dt><dd>{score.productMechanism?.customerReason &&
        <strong className="rs-reason">{sentenceCase(score.productMechanism.customerReason)}</strong>}
        {score.productMechanism?.boundedRationale || "The product benefit needs more evidence."}</dd></div>
      <div className="rs-fact"><dt>Cultural connection</dt><dd>{culturalLine(score, run.seedName, shown.partnerName)}</dd></div>
      {launch?.areas.length ? <div className="rs-fact"><dt>Where audiences overlap</dt><dd>
        <div className="rs-tags">{launch.areas.map((area) => <span key={area}>{area}</span>)}</div>
        <span className="rs-quiet">Cities where both brands&apos; audiences are strongest. A good place to start targeted ads, local creators or a pop-up.</span></dd></div> : null}
      {issues.length ? <div className="rs-fact"><dt>Potential challenges</dt><dd><ul>{issues.map((item) => <li key={item}>{item}</li>)}</ul></dd></div> : null}
    </dl>

    {(shown.briefId || canPropose) && <div className="rs-opp-actions">
      <button className="rs-button" type="button"
        onClick={() => router.push(`/projects/${projectId}/proposal/${shown.id}?run=${run.id}`)}>
        {shown.briefId ? "Open proposal" : "Create proposal"}</button></div>}

    {others.length > 0 && <div className="rs-combos"><span className="rs-quiet">Other combinations with {shown.partnerName}</span>
      <div className="rs-combo-list">{combinations.filter((item) => item.id !== shown.id).map((item) =>
        <button type="button" className="rs-combo" key={item.id} onClick={() => setShownId(item.id)}>
          <strong>{item.currentOffers?.partner?.title ?? item.score.productMechanism?.roles?.partnerRole ?? "Partner product"}</strong>
          <span>{item.score.productMechanism?.boundedRationale || "Needs more evidence."}</span></button>)}</div></div>}

    <details className="rs-details"><summary>Details</summary><div className="rs-details-body">
      <p>Partner interest, rights, pricing and fulfilment still need to be agreed with {shown.partnerName}. The seller is the verified store; the product maker is not separately confirmed.</p>
      {score.assortmentScope?.observedFamilies?.length ? <p>Products reviewed: {score.assortmentScope.observedFamilies.map((family) => family.replaceAll("_", " ")).join(", ")}. This was a sample of the catalog, not all of it.</p> : null}
      {commerce?.identitySourceRefs?.length ? <p>Store sources: {commerce.identitySourceRefs.map((url) =>
        <a key={url} href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}</a>)}</p> : null}
      {commerce?.culturalSourceRefs?.length ? <p>Cultural sources: {commerce.culturalSourceRefs.map((url) =>
        <a key={url} href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}</a>)}</p> : null}
      {commerce?.externalFindings?.length ? <p>Public context to review: {commerce.externalFindings.map((finding) =>
        <a key={finding.url} href={finding.url} target="_blank" rel="noopener noreferrer">{new URL(finding.url).hostname}
          {finding.publishedAt ? ` (${new Date(finding.publishedAt).toLocaleDateString()})` : ""}</a>)}</p> : null}
    </div></details>
  </article>;
}

// Research the user has opened stays in memory for this browser tab, so going
// back to it is instant. Nothing is written to browser storage; running research
// and actions always fetch fresh data.
const PAGE_CACHE_MS = 30 * 60_000;
const runCache = new Map<string, { run: Run; at: number }>();
const launchCache = new Map<string, Launch>();
const checkedAt = new Map<string, number>();
const isFresh = (at?: number) => at !== undefined && Date.now() - at < PAGE_CACHE_MS;
const isRunning = (status: string) => ["queued", "running"].includes(status);
// A proposal written elsewhere changes a run; its cached copy is then dropped.
export function forgetCachedRun(id: string) { runCache.delete(id); }

function updateMatch(setRun: Dispatch<SetStateAction<Run | null>>, id: string, patch: Partial<Match>) {
  setRun((current) => current ? { ...current, matches: current.matches.map((item) =>
    item.id === id ? { ...item, ...patch } : item) } : current);
}

export function CommerceResearch({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<{ id: string; status: string; createdAt: string }[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [pending, setPending] = useState<Record<string, Action>>({});
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState("");
  const [launch, setLaunch] = useState<Record<string, Launch>>({});
  const launchRequested = useRef(new Set<string>());

  const loadRuns = useCallback(async () => {
    const response = await fetch(`/api/personal/runs?projectId=${projectId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Research history is unavailable.");
    const list = (await response.json()).runs ?? [];
    setRuns(list);
    return list as { id: string }[];
  }, [projectId]);
  const loadRun = useCallback(async (id: string, force = false) => {
    const cached = runCache.get(id);
    if (!force && cached && isFresh(cached.at) && !isRunning(cached.run.status)) { setRun(cached.run); return; }
    const response = await fetch(`/api/personal/runs/${id}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Research unavailable.");
    runCache.set(id, { run: payload.run, at: Date.now() });
    // A reload returns live details only for a few combinations; keep the
    // details already loaded for the others.
    setRun((current) => !current || current.id !== payload.run.id ? payload.run : { ...payload.run,
      matches: payload.run.matches.map((item: Match) => {
        const previous = current.matches.find((match) => match.id === item.id);
        return previous?.currentOffers && !item.currentOffers
          ? { ...item, currentOffers: previous.currentOffers, score: { ...item.score,
            currentOfferReview: previous.score.currentOfferReview } } : item;
      }) });
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("run");
    queueMicrotask(() => loadRuns().then((list) => {
      const id = requested ?? list[0]?.id;
      if (id) return loadRun(id);
    }).catch((failure) => setError(failure.message)));
  }, [loadRuns, loadRun]);
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const timer = window.setInterval(() => loadRun(run.id, true).then(() => loadRuns())
      .catch((failure) => setError(failure.message)), 2500);
    return () => window.clearInterval(timer);
  }, [run, loadRun, loadRuns]);
  // Keep the cached copy in step with details and proposals loaded on this page.
  useEffect(() => {
    if (run && !isRunning(run.status)) runCache.set(run.id, { run, at: runCache.get(run.id)?.at ?? Date.now() });
  }, [run]);
  useEffect(() => {
    if (!run || !["completed", "partial"].includes(run.status)) return;
    const firstByPartner = new Map<string, Match>();
    for (const match of run.matches) if (match.score?.status !== "unsupported" && !firstByPartner.has(match.partnerEntityId))
      firstByPartner.set(match.partnerEntityId, match);
    for (const [partnerId, match] of firstByPartner) {
      const key = `${run.id}:${partnerId}`;
      if (launchRequested.current.has(key) || launchCache.has(key)) continue;
      launchRequested.current.add(key);
      fetch(`/api/personal/matches/${match.id}/launch-areas`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => { if (payload?.launch) { launchCache.set(key, payload.launch);
          setLaunch((current) => ({ ...current, [key]: payload.launch })); } })
        .catch(() => {});
    }
  }, [run]);

  // Each action belongs to one combination: only that card shows progress.
  async function act(match: Match, action: Action, task: () => Promise<void>) {
    setPending((current) => ({ ...current, [match.id]: action })); setError("");
    try { await task(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Something went wrong."); }
    finally { setPending((current) => { const next = { ...current }; delete next[match.id]; return next; }); }
  }
  const fetchCurrent = async (match: Match) => {
    const response = await fetch(`/api/personal/matches/${match.id}/current-offers`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Current details are unavailable.");
    updateMatch(setRun, match.id, payload.match);
    return { ...match, ...payload.match } as Match;
  };
  const check = (match: Match) => act(match, "check", async () => { await fetchCurrent(match); });
  // Shown combinations load live details once, without a click.
  const show = useCallback((match: Match) => {
    if (match.score?.currentOfferReview !== "not_checked" || isFresh(checkedAt.get(match.id))) return;
    checkedAt.set(match.id, Date.now());
    queueMicrotask(() => { void check(match); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const working = run && ["queued", "running"].includes(run.status);
  const groups = (["supported", "needs_verification"] as const).map((status) => {
    const byPartner = new Map<string, Match[]>();
    for (const match of run?.matches ?? []) if (match.score?.status === status)
      byPartner.set(match.partnerEntityId, [...(byPartner.get(match.partnerEntityId) ?? []), match]);
    return { status, partners: [...byPartner.values()] };
  });
  const counts = { supported: groups[0].partners.length, checking: groups[1].partners.length };
  const note = run?.result?.coverage ? RUN_NOTES[run.result.coverage] : null;
  const failedMessage = run?.status === "failed" ? run.errorCode === "commerce_run_invalid"
    ? "This research could not start. Start a new search." : "This research could not finish. Please try again." : null;

  return <section>
    {runs.length > 1 && <div className="rs-toolbar"><span className="rs-quiet">Research history</span>
      <select value={run?.id ?? ""} disabled={loadingRun} aria-label="Research history" onChange={(event) => {
        setLoadingRun(true); setError("");
        loadRun(event.target.value).catch((failure) => setError(failure.message)).finally(() => setLoadingRun(false)); }}>
        {runs.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()}</option>)}</select></div>}

    {!run && !error && <div className="rs-empty">No research yet. Start a new search to find partners for one of your products.</div>}
    {working && <div className="rs-status"><strong>{run.kind === "discovery" ? "Finding partners" : "Comparing brands"}</strong>
      <div className="rs-progress"><i /></div>
      <p>{run.stage}. This usually takes 3–5 minutes; you can leave this page and come back.</p></div>}
    {failedMessage && <div className="rs-status"><strong>{failedMessage}</strong></div>}

    {run && !working && !failedMessage && <>
      <div className="rs-summary"><strong>{counts.supported ? `${counts.supported} recommended ${counts.supported === 1 ? "partner" : "partners"}` : "No recommended partner yet"}</strong>
        {counts.checking ? <span>{counts.checking} worth checking</span> : null}</div>
      {note && <p className="rs-quiet">{note}</p>}
      {run.result?.stopReason === "research_time_limit_reached" && counts.supported + counts.checking > 0 &&
        <p className="rs-quiet">This review covered a sample of each store. Other combinations may exist.</p>}
      {groups.map((group) => group.partners.length ? <div key={group.status}>
        <h4 className="rs-section-title">{group.status === "supported" ? "Recommended" : "Worth checking"}</h4>
        {group.partners.map((matches) => <Opportunity key={matches[0].id} projectId={projectId} match={matches[0]} others={matches.slice(1)} run={run}
          pending={pending} launch={launch[`${run.id}:${matches[0].partnerEntityId}`] ?? launchCache.get(`${run.id}:${matches[0].partnerEntityId}`)} onShow={show} onCheck={check} />)}
      </div> : null)}
    </>}
    {error && <p className="rs-error" role="alert">{error}</p>}
  </section>;
}
