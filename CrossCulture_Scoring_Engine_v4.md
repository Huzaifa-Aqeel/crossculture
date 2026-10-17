# CrossCulture — Scoring Engine v4.0 (Simplified, Evidence-Led)

**Status:** Approved scoring authority. Sole definition of CrossCulture scoring. Pilot policy, **not empirically calibrated**.  
**Prepared:** 13 October 2026  
**Audience:** Codex / engineering / reviewers  
**Companions:** `CrossCulture_Functional_Requirements_v1.7.md`, `AGENTS.md`, `BUILD_PLAN.md`, `progress.md`.  
**Coverage:** Brand × Brand and Brand × YouTube Creator; discovery and direct-pair analysis.

**Current runtime status (14 October 2026):** Both pairing workers invoke this scorer locally. Brand × YouTube live eligible recommendations remain unverified. The corrected evidence-rule implementation is version `4.0.1`; its formula and rating anchors are unchanged, and historical `4.0.0` snapshots remain immutable. There is no application-level approval flag or alternate scorer.

> **Decision (13 October 2026):** CrossCulture scoring is **one Collaboration Opportunity Score**, explained by **three source-backed measurements**: Cultural Connection (C), Content/Business Relevance (R), and Goal Fit (G). Eligibility, evidence coverage/confidence, risks, novelty *labels*, and source lineage stay **separate from the score**. The pure TypeScript scorer is implemented per `BUILD_PLAN.md` stage 3. Historical assessment snapshots keep their recorded versions and are never rewritten.

## 1. What the score is

The question: **“Given the observed research, how promising is this specific brand–partner pairing for the initiating brand's chosen objective?”**

It is a **relative, evidence-grounded decision index**; **not** a probability of agreement, campaign success, ROI, conversion, audience overlap, or a measurement of creator quality. It is suitable for comparing *eligible candidates for the same initiating brand, objective, market, pairing type, source protocol, and scorer version*. Comparisons across dissimilar runs are diagnostic at most.

| Input | Question | Evidence available in CrossCulture | Avoid interpreting as |
|---|---|---|---|
| **C — Cultural Connection** | Does a **specific relationship** genuinely appear in Qloo results for this brand and the partner's observed cultural references? | Exact Qloo request/result, verified IDs and supported named bridges; creator references resolved from content | Cross-user-universal affinity, buyer probability, follower interests |
| **R — Content/Business Relevance** | Is the bridged culture **actually material to the partner's observed work or business**? | Creator video metadata, optional transcripts; company products/campaign pages and independent reports | Personal preferences, follower demographics, brand intentions |
| **G — Goal Fit** | Is there a **concrete, evidence-backed way** the partner could support the selected goal? | User goal/constraints and partner's observed formats, products, collaborations, capabilities | Availability, rates, real sales lift, successful agreement |

**One headline number**: `opportunityScore` (0–100) **only when inputs are sufficient**. The three components are displayed as short plain-language findings with source links. UI may show 5-point-rounded score (e.g. 80/100) to avoid false precision. The engine preserves unrounded numeric value internally for audit; do not advertise 1-point differences as meaningful.

Cultural connection is surfaced through the C and R findings; neither is published as a separate 0–100 score. No numeric novelty bonus. No concept-quality dimension. Users build their own proposals using the evidence; scoring must not depend on generated prose.

## 2. Design rationale

1. Qloo says affinities and rankings are **query-dependent**; numerical values from different query shapes cannot be converted into a globally calibrated conversion-propensity score. Its explainability, when available, can support claims about input contributions, not customer purchases [1, 2].
2. Meta-analyses find that creator/content characteristics, credibility, fit and effectiveness vary with context and goals; they do **not** yield universal formula coefficients for this product [3–5].
3. YouTube public views represent platform-defined play starts (including changes in 2026), not de-botted reach, unique viewers, purchaser income or incremental customers [6].
4. Sponsorship disclosures have context-dependent effects; sponsorship count is neither an automatic authenticity penalty nor an automatic bonus [7].
5. More elaborate dimensions (ROI forecast, inferred audience quality, generic engagement tier, brand safety as a numerical multiplier) would make the score **less defensible with the present sources**, not more.
6. Evidence quality, uncertainty, verified exclusions and commercial unknowns are important **metadata**, but should not be forced into arbitrary additive score terms.

**Research establishes why these constructs matter; it does not validate the 0.25/0.5/0.75/1.0 anchors or harmonic mean.** The following are an explicit *pilot scoring policy*, subject to a blinded human benchmark and later calibration, not evidence of predictive validity.

## 3. Score math: a two-stage harmonic mean

Let C, R, G be **evidence-based ratings** on the discrete scale `{0.25, 0.50, 0.75, 1.00}`, or `null` if insufficient. `0` is permitted **only for an explicitly demonstrated complete mismatch**, not for missing evidence. These are **utility anchors**, not calibrated probabilities or cardinal measurements of Qloo affinity.

Harmonic mean:

```
H(a, b) = 2ab / (a+b)   when a+b>0
H(0, 0) = 0
```

First assess cultural relevance:

```
Culture = H(C, R)
```

Then calculate the partnership index:

```
Opportunity = 100 × H(Culture, G)
```

**Why harmonic rather than additive?** Cultural connection with no evidence that the partner operates there is weak; a culturally credible match with no plausible path to the user's goal is also weak. Harmonic means discourage high scores driven by one component compensating for another. Both stages treat their two requirements symmetrically, without tuning five undocumented weights. This is a deliberately non-compensatory **product preference**, not a theorem that it predicts business performance.

*Example* (all hypothetical): `C=1, R=.75, G=.75` gives `Culture=.8571`, `Opportunity=80.0`; if only G falls to `.25`, Opportunity falls to `38.6` despite the same cultural link.

**Null handling:** if any of C/R/G is null, `opportunityScore=null` and state `insufficient_evidence`, with the missing reason. Never substitute zero, `.5`, or an LLM estimate. Even a hard negative (`0`) must have a source and reason code; usually it is better represented by `excluded` if a verified hard constraint is violated.

**Rounding:** internally store at least six decimals; display `round(score/5) × 5` (nearest five), with label **“Evidence-based opportunity index”**. Scores inside the same five-point display band are effectively tied.

## 4. Evidence protocol, before any ratings

The scorer is a **pure deterministic TypeScript function**. Before calling it, the existing worker creates one **immutable snapshot** with:

- Canonical seed-brand and partner identities (YouTube channel ID for creators); match type and one of the six supported goals; market and constraints; as-of timestamp.
- **Qloo record IDs**, exact operation and normalized parameters, result items, partner or cultural entity IDs, evidence of every named bridge, response status and query context. Do not average raw affinities from different queries.
- **Partner source records** with stable IDs, original links, dates, source type, content summary, observed/uncertain interpretation, relevant named culture IDs, and whether the observation is central/substantive/incidental.
- **Creator observations:** an objective sampling frame (e.g., latest 20 accessible uploads, chosen before scoring), titles/descriptions/tags, formats, dates; optional question-driven transcripts from selected videos with timestamped observations and explicit indication of selection bias. There is no fixed per-creator transcript count; global run budgets and evidence sufficiency govern enrichment. Sampling sizes must be reported, never quietly padded. Repeat mentions in one video count as **one independent video source**.
- **Brand observations:** actual products, official pages, documented campaigns/collaborations, business activities, Wikidata facts. Reposts and syndicated copies of the same announcement are **one underlying source**, not independent corroborations.
- **Goal evidence:** objective ID, minimal proposed *activation mechanism* (one sentence, not three generated concepts), required capabilities and actual sources supporting them; constraints/verified blockers and unknowns.
- Evidence/extraction version, scorer version, all source hashes, provider accessibility and missingness. Validate all referenced evidence IDs against the snapshot.

Only permitted server-side inputs can mark facts `verified`; user corrections are labeled user assertions until corroborated. Negative/critical commentary is **not an endorsement** or purchase intent.

### 4.1 Culture bridge admissibility

A score-bearing bridge requires **both**: (a) a traceable Qloo result connecting the starting brand with a specific cultural entity/tag or candidate brand under the submitted query, and (b) observed evidence associating the **candidate partner** with that entity, cultural territory or a Qloo-supported specific related entity. Qloo only returning a broad cultural interest to the seed brand is **not enough**.

For Brand × YouTube, the channel **is not assumed to be a Qloo entity**; use its validated content-derived resolved entities/tags. For Brand × Brand, use actual candidate Qloo identity and Qloo-grounded association plus verified business activity. A plausible LLM narrative, similar business category, shared name, unverified tag, or multi-hop story **without returned Qloo support** cannot be a scored bridge.

A candidate discovered through Qloo **is not automatically given a high C rating**. Inspect the returned relation and partner evidence. If the source lacks enough data for a specific supported bridge, set C to null, not `.5`.

## 5. C: Cultural Connection rating — supported relationship, not Qloo %

**Same rubric for both pairing types.** Only validated `qlooBridge` records count, deduplicated by canonical cultural entity ID and distinct supporting relationship; aliases, synonyms and copies of the same result do not create more bridges.

For `C=1.00`, the two named bridges may be selected from a larger set: another valid bridge in either family cannot reduce the rating. The explainability alternative remains separate.

| C | Operational anchor | Examples / exclusions |
|---|---|---|
| **null** | No demonstrable Qloo-supported *pair* bridge, invalid/missing Qloo result, or ambiguous Qloo resolution | A seed-brand affinity list alone; theme invented by LLM; inaccessible Qloo |
| **0.50** | At least one confirmed **broad but meaningful** Qloo category/tag bridge supported on both sides | Recognized cultural tag but no named specific entity; reject empty labels like “lifestyle” |
| **0.75** | At least one confirmed **specific named** entity or direct, traceable cross-category bridge, with a source-backed partner connection | Qloo-supported film/artist/game/design entity also genuinely material to partner work |
| **1.00** | A specific supported bridge with a second **distinct, corroborating** named bridge from another cultural entity/topic family (not a synonym), or one direct named bridge substantiated by returned Qloo explainability and separately verified contextual relationship | Strong documented link; does not require scraping additional platforms |

`C=0.25` is reserved for a **weak/indirect diagnostic** and **must not generate a full scored recommendation**. A broad generic “fashion” label is not automatically meaningful; reviewers may reject it as ungrounded. Cross-category is a **descriptive label**, not a multiplier. A single excellent focused bridge can still give `C=.75` and a strong overall result.

**Qloo raw-affinity handling:** Retain provider affinity and rank as provenance. Within one **identically shaped** query/reference set, Qloo relative rank can serve as a displayed diagnostic or conservative tie-break *if the cohort is fixed*. **It is not the C rating**, and cross-query ranks never get merged into a single normalized number. Missing explainability alone does not invalidate a directly observed Qloo result.

## 6. R: Content / Business Relevance rating — observed activity

Question: **Is the bridged cultural territory a meaningful part of the potential partner's actually observed work?** Evaluate what has been published or documented, not whether a partner has enough followers or a creator's audience will buy.

### 6.1 Creator: YouTube records + optional transcript evidence

Use a **predeclared sample**, typically up to 20 latest accessible uploads, not only search hits or selectively transcribed videos. Every observation must identify whether the subject was `central`, `substantive`, `incidental`, `contradictory`, or `unknown`. Do not infer centrality merely from a passing keyword in the description. Where titles/metadata cannot substantiate centrality, choose `substantive` or `unknown` conservatively. A transcript can upgrade or refute classification for its sampled video; transcripts from videos outside the frame may support a distinct claim or bridge but cannot inflate representative-sample topic-frequency counts.

| R | Creator-specific evidence anchor |
|---|---|
| **null** | No reliable video evidence; sample inaccessible; cultural reference cannot be tied to observed content |
| **0.25** | Only one isolated, incidental or very weakly evidenced reference; little indication that this is a real content subject |
| **0.50** | At least one video centrally covers the supported culture **or** two distinct videos discuss it substantively |
| **0.75** | At least two distinct videos centrally cover the culture **or** at least three independent videos address it substantively |
| **1.00** | At least four distinct videos centrally cover the culture, distributed across more than one publication date, with no substantive contradictory evidence about current topical relevance |

Counts are **pilot evidence anchors**, not statistically inferred confidence or proof that `4/20` predicts performance. If the channel has only two accessible videos, `.75` can be defensible when both are centrally relevant, but evidence confidence is lower. Do not use optional transcript selection to inflate the denominator or count multiple statements from one video as multiple independent observations. Material topic reversals/criticisms must remain visible and trigger review; criticizing a topic does not automatically mean having no relevant expertise.

### 6.2 Brand: products, services and documented activity

Unlike creators, brands may have relatively few long-lived authoritative product pages. **Do not impose a four-video rule on brands.** Use the same R semantic range but source-appropriate anchors.

| R | Brand-specific evidence anchor |
|---|---|
| **null** | No credible source shows what the partner actually sells/creates/does in the relevant cultural territory |
| **0.25** | An incidental third-party mention without first-party confirmation of meaningful activity |
| **0.50** | One reliable, explicit source shows a relevant product, campaign, capability or cultural project, but limited scope/ongoing presence |
| **0.75** | The partner's official product/service/campaign material establishes the culture as a substantial part of actual activity |
| **1.00** | Sustained/central activity documented by multiple substantively distinct official projects or official material plus credible independent corroboration |

Avoid multiplying syndicated article copies. A fact from Wikidata can support identity/ownership, but a generic industry tag alone does not prove an observed cultural positioning. A Qloo returned brand recommendation by itself does not prove the candidate has actually run a campaign.

Count distinct underlying documents and substantive projects, not extraction rows or syndicated copies. Independent reporting may corroborate a project; coverage of the same project does not create an additional project. The existing `.50/.75/1.00` anchors still govern the rating.

## 7. G: Goal Fit rating — a testable path, not a generated proposal

Question: **Is there a *source-backed plausible mechanism* by which this partner could support the *chosen* objective?** The assessment is concept-light: 1–2 sentences describing **a possible format/activity**, not a fully generated collaboration and not a commitment by either party. Score first; offer richer concepts and the user-built Proposal Studio later.

| G | Evidence standard |
|---|---|
| **null** | Objective missing/unsupported; no credible proposed mechanism; crucial required capability unknown |
| **0** | An explicit, documented mismatch means the particular goal cannot be served by the evaluated mechanism (but no hard exclusion) |
| **0.25** | Speculative generic route with no demonstrated format/capability; kept as low-confidence only when a *specific* mechanism is stated and some evidence exists |
| **0.50** | Specific plausible route; partner has transferable experience, but the needed format or capability is not directly demonstrated |
| **0.75** | Specific route aligns with directly demonstrated partner activity, format or offering; material commercial terms remain unknown |
| **1.00** | Directly demonstrated *relevant capability* and a well-grounded route matched to the objective; no known conflict with explicit hard constraints. Still **not** a claim about audience reach, deal terms or success |

**Six objective mappings; use existing partner evidence only:**

| Objective | What must be supported to grade G | Do not assert |
|---|---|---|
| `awareness` | A credible activation/distribution format shown in partner's publishing, retail, campaigns or channels | Forecast reach / new unique users |
| `new_audience` | Partner operates in a distinct Qloo-grounded cultural territory, with a plausible way to introduce the brand through a demonstrated format | Actual audience overlap, new-customer count, audience income |
| `repositioning` | Partner's actual cultural work and format plausibly communicate the desired association | Guaranteed change in brand perception |
| `co_created_product` | Documented design/making/product collaboration capacity, or realistic complementary product capability demonstrated by one/both sides | Manufacturing capacity, budget agreement, technical rights if unknown |
| `content_collaboration` | Demonstrated formats/creative skills suited to joint output; partner roles can be described without invention | Guaranteed content production agreement |
| `sponsorship` | A natural format for integrating the brand into authentic content/activation; previous paid collaborations can support experience but **are not mandatory** | Sponsor availability, creator price, guaranteed views |

**Deterministic implementation boundary:** The LLM may extract `activationMechanism` and **candidate evidence flags** as validated JSON, but must not supply arbitrary G numbers or final score. A versioned rule table checks objective, required capability evidence IDs and structured classifications. When evidence doesn't fit a rule, return `G=null` and `needs_review`, or route for explicit human adjudication. Do not secretly ask the LLM “rate partnership fit from 1–100”.

**Concrete G assignment rule (pilot):**

1. Before grading, map the chosen objective and partner type to a **fixed allowed mechanism family** (e.g. creator `content_collaboration` → interview, documentary, joint video, tutorial, or another observed compatible format; brand `co_created_product` → complementary documented making/product capabilities). The user may propose a different specific mechanism, but it must be source-checked against the same requirements.
2. Verify whether an actual observed project, product or video demonstrates the **needed capability**. Annotate each capability as `direct`, `transferable`, `unsupported`, or `contradicted`, and attach its factual source IDs. `direct` does **not** require previous paid sponsorship.
3. Assign **G=1.00** when the specific mechanism is backed by directly demonstrated and repeated/clearly central required capability with no verified user-constraint conflict; **G=.75** for a specific mechanism supported by at least one directly demonstrated required capability; **G=.50** for a specific mechanism supported by transferable but not direct experience; **G=.25** for a specific but weakly evidenced proposed route; **G=0** for documented inability/mismatch with the selected route; **G=null** when mechanism or capability evidence is absent/ambiguous. A known hard constraint is handled by `excluded`, not by manipulating G.
4. **Prevent goal gaming:** The planner may not reduce an objective to an easy token capability (e.g. “has a YouTube channel” as sufficient proof for `co_created_product`). Objective-specific required capabilities must be versioned in a fixed allowlist, and factual claims must retain their source IDs. Where external expertise is needed to determine necessity/transferability, mark `needs_review`; do not have the LLM invent a perfect fit.

Each required capability must have source-backed evidence before assigning numeric G. For `new_audience`, this includes both distinct cultural-territory participation and an activation route. Missing mandatory evidence yields `G=null`; weak source-backed support may yield `.25`, and transferable support `.50` under the existing anchors.

**Example objective-to-capability allowlist (initial, editable by version):**

| Objective | Creator case: demonstrated capability relevant to mechanism | Brand case: demonstrated capability relevant to mechanism |
|---|---|---|
| `awareness` | Actual publishing/distribution in the proposed format | Actual product/campaign/marketing distribution activity |
| `new_audience` | Regular content about distinct target cultural territory + credible publication route | Actual participation in a distinct relevant cultural/business territory + activation channel |
| `repositioning` | Demonstrated cultural storytelling/creative subject expertise relevant to the desired association | Established relevant cultural projects/products and believable co-brand communication route |
| `co_created_product` | Demonstrated design, making, product input, or directly relevant co-creation experience | Complementary products, design/production or delivery capabilities; at least one partner can actually make/deliver the output |
| `content_collaboration` | Demonstrated content genre/production format (paid history optional) | Demonstrated content/campaign creation or creative assets fitting the proposed output |
| `sponsorship` | Demonstrated brand-compatible content format and publishing ability; paid sponsor history is a bonus *fact*, not a prerequisite | Documented sponsor/integration format or an actual owned channel/activation capability |

These descriptions specify **source evidence needed to justify a mechanism**, not presumed audience behavior or a minimum subscriber tier. A 100 Goal Fit is the maximum strength of **demonstrated feasibility evidence for that mechanism**, not a promise the partner will participate.

**No duplicate evidence trick:** A creator's documentary upload can substantiate an observed cultural topic (R) and prove a *different* factual claim—documentary production experience—for goal fit (G). Store distinct claim IDs. Repeating one unsupported assertion three times cannot satisfy C, R and G.

## 8. Eligibility, missing evidence, confidence, and conflicts

Before scoring, evaluate separately:

- `excluded`: verified self-match, explicit excluded competitor/entity, verified hard constraint conflict (e.g., required territory proven unavailable), or confirmed prohibited constraint.
- `insufficient_evidence`: unresolved identity, absent admissible Qloo connection, missing source-backed partner activity, or unsupported G. **No score**.
- `conditional`: score supported on available sources, but meaningful due-diligence item remains (e.g., competitor sponsorship requires discussion). **May retain a score**, but must not appear as a confirmed, execution-ready match.
- `eligible`: all three required measurement types supported and no known blocker; ordinary negotiation unknowns can still exist.

Do not label a creator ineligible because no sponsorship was found. A documented competitor campaign is **not** proof of contractual exclusivity. No evidence of conflict does **not** establish absence of conflict.

**Confidence is a separate `high|medium|low` evidence-coverage label, not a probability:**

- `high`: explicit Qloo lineage, reliable partner identity, repeatedly/source-diversely observed relevant work (or an authoritative company fact corroborated as needed), goal mechanism directly supported, current sources and no material unresolved interpretation.
- `medium`: credible Qloo and substantive partner evidence, but limited independent corroboration, narrow content sample, older or unverified details, or some material assumptions.
- `low`: thin, stale, selectively sampled or ambiguous evidence; source gaps; competing interpretations. If a required input cannot be supported, return `insufficient_evidence` instead of merely displaying `low` with a score.

Missing transcripts lower **transcript coverage**, not automatically R, G or the opportunity score. No observed sponsorship leaves sponsorship experience **unknown**, not a negative. Unknown budget/rates/availability remain visible as proposal checklist items rather than hidden scoring penalties. More views or subscribers **never** increase C/R/G just because the channel is large. Public view counts can appear as plainly labeled supporting metadata only.

## 9. Rank and explain without fake precision

1. Group results by `eligible`, `conditional`, `insufficient_evidence`, `excluded` (latter two unranked).
2. For scored candidates *within the same comparable run*, rank by `round(rawOpportunity/5)*5` descending, then `confidence` high→low, then stable canonical partner ID. This reflects deliberately coarse evidence anchors. **Do not claim raw 81 vs 82 is a meaningful quality difference**.
3. Preserve `rawOpportunity`, displayed 5-point band, `C/R/G` ratings, direct evidence links, source coverage, unknowns and `reasonCodes` in the immutable snapshot.
4. `direct` vs `cross_category` is a **descriptive cultural bridge type**; not a novelty multiplier. If diversity is desired, show a separate cross-category subgroup rather than secretly changing the index.
5. A Qloo within-query rank may be displayed as contextual evidence, **never** used to break ties across incompatible queries.

**Example explanations:**

- “Cultural connection: Specific Qloo-supported relation to independent Japanese design.”
- “Partner relevance: Three videos centrally discuss that cultural territory.”
- “Goal fit: Documentary-style videos demonstrate a plausible content collaboration format.”
- “Open question: Sponsorship availability and licensing terms are not known.”

Each explanatory statement references actual source IDs, never a fabricated SHAP allocation or implied causal percentage contribution.

## 10. Minimal TypeScript contract

```ts
type PairType = 'brand_brand' | 'brand_youtube';
type Objective = 'awareness' | 'new_audience' | 'repositioning' |
                 'co_created_product' | 'content_collaboration' | 'sponsorship';
type Rating = 0 | 0.25 | 0.5 | 0.75 | 1 | null;

type AssessedSignal = {
  rating: Rating;
  evidenceIds: string[];         // references validated against frozen snapshot
  reasonCode: string;            // selected from finite versioned rubric
  notes?: string;                // short, source-grounded
};

type ScoringInput = {
  snapshotId: string;
  snapshotHash: string;
  scorerVersion: '4.0.1';
  pairType: PairType;
  objective: Objective;
  brandId: string;
  partnerId: string;
  sourceIds: string[];
  culturalConnection: AssessedSignal;  // C; must refer to Qloo query/result
  contentRelevance: AssessedSignal;    // R
  goalFit: AssessedSignal;            // G
  qlooLineageVerified: boolean;
  identityVerified: boolean;
  hardExclusion: boolean;
  hardExclusionEvidenceIds: string[];
  reviewFlags: string[];
  confidence: 'high' | 'medium' | 'low'; // independently adjudicated coverage
};

type ScoringOutput = {
  opportunityScore: number | null;     // full precision internally
  displayScore: number | null;         // nearest 5
  culturalRelevance: number | null;   // internal, not a second public index
  status: 'eligible' | 'conditional' | 'insufficient_evidence' | 'excluded';
  confidence: 'high' | 'medium' | 'low';
  ratings: { C: Rating; R: Rating; G: Rating };
  reasonCodes: string[];
  evidenceIds: string[];
  scorerVersion: '4.0.1';
  inputHash: string;
};
```

The worker **not the model** constructs these assessed signals from validated evidence and rule anchors. See the accompanying pure TS reference. The reference assumes upstream classification has already been audited; upstream extraction/bridge-validation is mandatory in production. Numeric ratings supplied directly by the browser are not trusted.

## 11. Worked, synthetic comparison

For illustration only—not live Qloo results, not actual creator profiles:

| Candidate scenario | C | R | G | Cultural Relevance `H(C,R)` | Opportunity `100×H(H(C,R),G)` |
|---|---:|---:|---:|---:|---:|
| Strong cultural bridge, demonstrated format | 1.00 | .75 | 1.00 | .857 | **92.3** |
| Excellent culture, weak goal mechanism | 1.00 | 1.00 | .25 | 1.000 | **40.0** |
| Weak cultural tag, otherwise good fit | .50 | .75 | 1.00 | .600 | **75.0** |
| Specific bridge, one substantive source | .75 | .50 | .75 | .600 | **66.7** |
| Balanced evidence, directly relevant route | .75 | .75 | .75 | .750 | **75.0** |

A weak `C=.25` example could mathematically give ~57/100, but it **must be unscored by the admissibility gate**. A strong partner can score lower if the user changes from `content_collaboration` to `co_created_product` and no product-making capability is documented. The same facts can generate different Goal Fit ratings by objective; `C` and `R` should not change without changed source or Qloo evidence.

**Calculation check:** `.75,.5,.75` → H=.600; Opportunity=`100×H(.600,.750)=66.67`. The calculations in this section are backed by accompanying unit tests.

## 12. Model evaluation before calling it production-grade

**Phase 0 — Functional correctness.** Fixtures for both match types; all six goals; unsupported Qloo; empty videos; only one substantive video; one excellent focused bridge; repeated keywords in one video; metadata-only vs transcript-enriched; mismatched Qloo IDs; negative/critical mentions; known exclusion; uncertain competitor history; objective changes; source deletion; older/stale content; narrow creator samples; unauthorized user; missing numeric values. Pure-score tests should assert bounds, monotonicity and repeatability.

**Phase 1 — Human quality benchmark.** Assemble **at least 60–100 anonymized/fixed** pair-and-objective evidence packets (including intentionally surprising good/poor pairs, brand-brand and brand-youtube, multiple creator sizes). At least two independent reviewers grade the same 3 anchored observations **without seeing the algorithm score**, then independently judge which partnerships are worth investigating. Include disagreements/uncertainties rather than replacing them silently with the model's answer. Adjust rubric and formula only on a development set; hold out test cases.

**Measure:** assessor inter-rater agreement (weighted Cohen's kappa or equivalent); pairwise ranking agreement on identical-objective comparisons; NDCG@5 or Precision@5 for labeled shortlist relevance; false-positive rate for unsupported Qloo bridges; score stability when irrelevant videos are added; and whether small creators are disadvantaged by evidence volume. These are **evaluation tools**, not claims of measured performance.

**Phase 2 — Real outcomes when available.** If actual deal decisions/campaign outcomes are volunteered by users with relevant rights, investigate whether the index predicts their *chosen* objectives, while accounting for selection bias. No conversion or ROI assertions before this calibration. Be willing to drop the number and use evidence-led categories if human assessment agreement is poor.

**Pilot calibration policy:** anchors, duplicate rules and any cutoffs are explicit starting choices, not mathematically deduced from research. Version changes are observable; historical `assessment_snapshots` are immutable and never rewritten.

## 13. Implementation and FR v1.7 reconciliation

1. This document defines the product scoring decision: one public score, no concept-score dependency, simpler source-derived measurements. FR v1.7 §6, the concept/scoring sequencing, acceptance tests, `BUILD_PLAN.md` and `AGENTS.md` reflect this design; the result UI follows the FR.
2. Keep Qloo+Wikidata, Qloo-led Brand × Brand discovery; Qloo-led YouTube Data API creator discovery, bounded metadata, *optional* npm transcripts, Qloo creator-cultural-entity resolution, sponsored-collaboration observations, and user-built Proposal Studio.
3. No additional database or cache tables. Keep scoring results under existing `public.assessment_snapshots`; `private.qloo_responses` remains per-user; shared permitted YouTube cache; Wikidata identity catalog. Snapshot records include three rating sources and version.
4. Implement the creator rubric as part of the approved Brand × YouTube path: source-backed creator observations and supported Qloo bridges enter frozen v4 inputs; eligible and qualifying conditional creator pairs receive the single v4 score, C/R/G explanations and separate confidence, ranked within their separate v4 groups. Current creator research remains factual and unscored until that implementation is validated. Do not add an application-level approval flag or alternate scoring route.
5. No Apify/Instagram actor, no separate engagement index, influencer income proxy, automatic authenticity decay, “real reach” or ROI estimator. No thumbnail/frame/video visual-analysis assumptions.
6. New assessments use scorer version `4.0.1` for the corrected evidence rules. Historical `4.0.0` assessment snapshots keep their recorded version and are never rewritten or compared across versions.

## 14. Source notes (current as of 13 Oct 2026)

Research sources justify the *scope and caution* of the model; **none provides its numeric anchors or formula**.

[1] Qloo, **Interpreting Affinity Scores**: https://github.com/qloo/docs-public/blob/main/docs/interpreting-affinity-scores.md (query dependence, relative ranks, small differences).  
[2] Qloo, **Insights API deep dive**: https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md (`feature.explainability`, signal/result meaning; inspect actual MCP tool output).  
[3] Pan et al. (2025), **Influencer marketing effectiveness: A meta-analytic review**, 251 papers: https://link.springer.com/article/10.1007/s11747-024-01052-7 .  
[4] Barari et al. (2026), **A meta-analysis of the effectiveness of social media influencers: Mechanisms and moderation**, 71 papers: https://link.springer.com/article/10.1007/s11747-025-01107-3 .  
[5] Rasul et al. (2026), **When Social Media Influencers Work: A Meta-Analysis of Brand Engagement, Behavioral Intention, and Boundary Conditions**, 97 studies; use as context, not universal weights: https://onlinelibrary.wiley.com/doi/10.1002/cb.70246 .  
[6] YouTube Data API, **Video resource** (Aug 24 2026 view semantics): https://developers.google.com/youtube/v3/docs/videos .  
[7] Liu & Zhao (2025), **Sponsorship disclosure meta-analysis**, 37 studies: https://research.rug.nl/en/publications/a-meta-analysis-of-the-effects-of-sponsorship-disclosure-in-influ/ .  
[8] YouTube, **Additional derived metrics**, and **Developer Policy guide** (updated Sep 14 2026): https://developers.google.com/youtube/terms/derived-metrics-policy and https://developers.google.com/youtube/terms/developer-policies-guide .  
[9] 2026 study on unconventional brand collaborations and novelty/fit (directional, not a validated scoring formula): https://www.sciencedirect.com/science/article/abs/pii/S0969698926000275 .  
[10] NIST, **AI RMF 1.0** (measurement validity, reliability, evaluation discipline): https://www.nist.gov/itl/ai-risk-management-framework .

---

**Decision summary:** one headline score, three source-grounded ratings, two-stage harmonic mean, separate evidence/eligibility, no numerical novelty bonus, no dependent concept generation, no new scoring provider or database table.
