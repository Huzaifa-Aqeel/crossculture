# CrossCulture — Functional Requirements v1.7

**Status:** Updated implementation-ready product and architecture requirements; reconcile against live repository and the adopted v4 scorer before applying migrations
**Date:** 14 October 2026
**Audience:** Codex / implementation team
**Product scope:** Brand × Brand and Brand × YouTube Creator
**Companion files:** `CrossCulture_Scoring_Engine_v4.md` (sole scoring authority; the adopted repository version, not an older proposal), `BUILD_PLAN.md`, `progress.md` (implementation truth), existing Supabase migrations

> **Implementation mandate.** This document is the governing specification for product workflows, data providers, intelligence extraction, persistence, and proposal creation. **Remove Apify entirely from runtime, dependencies, configuration, jobs, routes, cache tables and active tests.** Replace it with the official YouTube Data API v3 for public channel/video metadata; use `youtube-transcript` selectively for available subtitles; use Qloo as the cultural intelligence engine; and retain Wikidata plus targeted web research for business evidence. Do not reintroduce Instagram scraping. Preserve working code that complies with this FR; migrate, do not rebuild blindly.
>
> **Scoring boundary.** `CrossCulture_Scoring_Engine_v4.md` exclusively defines the single Collaboration Opportunity Score, its Cultural Connection / Content-Business Relevance / Goal Fit ratings, eligibility, confidence, ranking, and objective behavior. This FR specifies *which evidence is acquired and when*, **not** another scoring formula. Preserve historical assessment snapshots during migration.
>
> **Product decision.** Collaboration concepts can be AI-suggested **after the user selects a researched pair**; the final partnership **proposal is an editable, research-assisted template that the user authors**. Assessments must never automatically create concept rows or briefs. Do not automatically produce an entire proposal or invent commercial terms.
>
> **2026-10-14 workflow decisions.** For Brand × YouTube, collect and extract one predeclared representative metadata sample **during discovery for every retained candidate**, reuse that evidence after shortlisting, and perform **adaptive, question-driven transcript enrichment** across strong and culturally interesting uncertain candidates; do not impose a fixed per-creator transcript count or a mandatory two-round process. For Brand × Brand, Qloo remains the sole candidate-discovery engine; official brand YouTube materials are an **optional, identity-verified corroborating source** for selected pairs, never a prerequisite or second discovery mechanism. All YouTube retrieval stays with YouTube Data API v3 and `youtube-transcript` npm.

## 1. Product and scope

**CrossCulture** helps a brand discover and evaluate unexpected, culturally credible collaboration partners—**other brands or YouTube creators**—then turn verified research into an editable partnership proposal.

**Product promise:** *Discover partners beyond obvious category matches; show the cultural bridge, evidence, feasibility, and unknowns; help the user make a credible proposal.*

- **Brand × Brand:** Co-branding, co-marketing, joint products, experiences, distribution/content partnerships where plausible.
- **Brand × YouTube Creator:** Creator-led videos, sponsorships, demonstrations, educational content, cultural crossover series, or co-creation.
- The **initiating entity is always a brand**. Both types support **Find Collaborators** (primary: automatically discover partners) and **Compare Specific Partners** (secondary: evaluate a user-specified pair using the same research and assessment components). Brand × Brand discovery gets candidate brands from Qloo; the user does not need to name a second brand. Brand × YouTube discovery uses Qloo-grounded search directions and actual creators found by YouTube Data API v3.
- No additional social platforms, creator × creator, podcast, Instagram discovery, outreach automation, creator-contact harvesting, campaign attribution, contract signing, or predictive sales model in MVP.
- Intended first market: **United States**, with market/language as explicit inputs, not fabricated demographic guarantees.
- **New MVP analyses:** Brand × Brand offers `co_created_product`, `content_collaboration`, and `repositioning`; Brand × YouTube offers `content_collaboration` and `sponsorship`. For a new Brand × Brand `repositioning` run, the user must state the desired cultural positioning direction. Validate these choices when a new run starts in either discovery or direct comparison. The scorer and database retain all six canonical objective IDs (`awareness`, `new_audience`, `repositioning`, `co_created_product`, `content_collaboration`, `sponsorship`) so historical projects, runs, assessments, concepts, and proposals remain readable; earlier goals cannot start new analyses. Event/experience, series, single video and limited product are **format preferences**, not extra objective IDs.
- Required analysis inputs: initiating brand, pairing mode, supported objective and target market; Brand × Brand repositioning also requires desired cultural positioning direction. Optional: official brand URL for disambiguation, language, named competitor exclusions, desired format, campaign budget, community hypothesis and notes. Missing optional values remain unknown.
- Users: brand partnerships/marketing teams and small agencies/strategists. Authentication: Supabase email/password with self-sign-up, email confirmation, sign-out and password reset; direct user ownership, no organizations/workspaces in MVP.

### 1.1 Core promise limitations

- A Qloo cultural affinity is **not** a direct probability of conversion or guaranteed audience overlap.
- A creator's published topics are **not** verified interests, location, income, purchasing intention, or demographics of their viewers.
- Public YouTube views are **not** deduplicated human reach or US audience counts.
- A previous sponsor or brand mention does **not** establish current exclusivity, available budget, creator availability, rates, partnership satisfaction, or campaign ROI.
- Missing provider data means `unknown`, `unavailable`, or `insufficient_evidence`, never a silent zero or invented fact.
- Source/claim confidence must not be confused with the cultural connection, relevance and goal-fit findings behind the opportunity score.

### 1.2 Required outcomes

A user can: (1) resolve a real initiating brand, (2) choose pairing and objective, (3) discover Qloo-grounded partner candidates or get an honest sparse result, (4) inspect source-backed cultural and commercial intelligence, (5) view the v4 Collaboration Opportunity assessment for either pairing type when its evidence gates are met, (6) examine collaboration histories and unknowns, (7) save/reject/compare options, (8) consider three source-grounded creative directions, (9) build their **own** proposal in a research-backed template and export it, (10) revisit saved work without provider refetch on every page load.

## 2. Fixed stack and division of responsibility

| Component | Technology | Sole responsibility |
|---|---|---|
| Web product | Next.js, TypeScript, Tailwind, shadcn/ui | Authentication screens, discovery, comparisons, research evidence, concept selection, proposal editor |
| Persistent API + worker | Node.js 22.19+ in container/VM | Resumable bounded workflow, provider orchestration, quota enforcement, Qloo MCP process |
| Identity/data | Supabase Auth + PostgreSQL + RLS | Session ownership, saved work, safe provider caches and evidence versions |
| Cultural discovery | **Qloo via the existing persistent MCP harness** | Brand cultural affinities, brand candidate discovery, supported cultural entity resolution and bridges |
| Brand facts | **Wikidata Action API**, selective bounded SPARQL | Brand identity/disambiguation, industry, website, ownership where available |
| YouTube metadata | **Official YouTube Data API v3**, server-only API key | Sole YouTube metadata source: creator search/discovery; optional verified official-brand channel/video evidence for Brand × Brand |
| Optional video text | **`youtube-transcript` npm** | Sole selected-video subtitle retriever for creator research and optional verified official-brand videos; text used in memory only |
| Commercial context | Selective Tavily Search/Extract when configured, with shared bounded web research | Current campaigns, brand capabilities, publicly documented partnerships and potential conflicts |
| Interpretation/writing help | Existing LLM + Zod schemas | Evidence-grounded cultural extraction, sponsorship classification, concept hypotheses, optional user-invoked writing assistance |
| Decision engine | Pure TypeScript implementation of `CrossCulture_Scoring_Engine_v4.md` | Deterministic assessments from frozen evidence only |

**Do not add Gemini video understanding, Apify, Redis, another YouTube scraper, transcript retriever, video-analysis provider, or separate transcript SaaS.** This YouTube-only restriction does not change Qloo cultural intelligence/brand discovery, Wikidata business facts, selective web research for official campaigns/collaborations/commercial evidence, or the existing LLM for structured extraction and concept generation. Captions provide spoken/text context, **not** visual understanding. The base system functions without captions.

**Provider identity:** Preserve Qloo entity IDs, Wikidata Q-IDs and YouTube channel IDs as **distinct typed identifiers**. Never map identifiers from name similarity alone or assume a YouTube channel is a native Qloo entity.

## 3. Authoritative source map

| Question | Authority | Interpretation boundary |
|---|---|---|
| Which brand is this? | Qloo entity result + Wikidata/official domain corroboration | Identity collisions require selection |
| What cultural territory is associated with this brand? | Qloo results for exact query context | No extrapolated Qloo affinities |
| Which other brands might connect culturally? | Qloo brand discovery + eligibility filtering | Validate real business identity and feasibility afterward |
| Which YouTube creators publish related material? | YouTube `search.list` using Qloo-grounded search directions | Search ranking is not partnership fit |
| What did a creator publish? | YouTube channel/video metadata | No claim about watched content beyond observed text |
| What did a creator say? | Successfully retrieved selected subtitles | No visual or undocumented claims; unavailable captions stay unavailable |
| What recurring topics/entities are evidenced? | Validated LLM extraction from identified videos | Multiple mentions in one video are not independent observations |
| What connects creator and brand culturally? | Qloo-supported entity/interest relationships + creator source evidence | Avoid labeling LLM analogy a Qloo bridge |
| Which sponsors/collaborations are documented? | Explicit creator video/title/description/transcript disclosures; verified official brand YouTube videos (optional); official news/brand pages | Ordinary mentions, reviews and affiliate links are separate classifications; brand channel ownership must be verified |
| What practical risks/capabilities exist? | Observed creator formats, official business evidence (including optional verified official brand videos), supported constraints | Don't infer exclusivity, pricing, willingness or verified audience |
| Is this a worthwhile partnership? | `CrossCulture_Scoring_Engine_v4.md` on frozen evidence | Never LLM-generated compatibility percentages |
| What should the proposal say? | **User-authored template** informed by selected verified research | No automatic full-proposal generation or commitments |

## 4. Canonical backend intelligence pipeline

### 4.1 Common entry — brand resolution and cultural DNA

**Input contract** (values from scorer-approved enums; optional fields nullable):

```json
{
  "initiatingBrand": { "name": "Nike", "officialUrl": null },
  "pairing": "youtube_creator",
  "mode": "discovery",
  "objective": "content_collaboration",
  "market": "US",
  "language": "en",
  "constraints": { "budget": null, "excludeBrands": [], "desiredFormat": null }
}
```

1. Create signed-in `analysis_runs` (or isolated bounded demo run); validate input, identity, ownership and idempotency.
2. Query **Qloo brand search** and **Wikidata `wbsearchentities`** concurrently. Neither service assumes the other's IDs; a partial Wikidata outage doesn't invalidate good Qloo evidence.
3. Verify identity against official URLs, entity labels, descriptions, regional/parent-company differences; request disambiguation if needed.
4. Save canonical brand identity, identifiers, timestamps, resolution status. Entity identifiers can be shared without sharing user-private Qloo responses.
5. Using the chosen Qloo ID, request supported brand insights/relationships, preserving each operation's query parameters, signals, Qloo entity IDs, score semantics, timestamps, coverage and response references.
6. Produce a **Brand Cultural DNA evidence object**, not a bag of generic LLM-generated interest labels. Keep named Qloo entities/tags and any supported category-level connections. Use an LLM to summarize returned evidence only; it cannot manufacture provider affinities.
7. Merge factual business context from Wikidata (official website, industry, country, owner/parent where present), without turning a missing property into a negative conclusion.

**Output:** `CanonicalBrand`, `BrandCulturalEvidence`, `BusinessFacts`, `sourceRefs`, `coverage/unknowns`.

### 4.2 Brand × YouTube — discovery workflow (required)

**Primary — Find Creators.** User supplies **one initiating brand + objective**; Qloo guides discovery but YouTube Data API v3 returns real channels. **Secondary — Compare Specific Creator** skips broad search and runs the identical metadata sampling, optional transcripts, cultural-bridge and v4 assessment pipeline for the supplied channel (§4.5). Both use Qloo, Wikidata for seed identity, and the LLM; no extra YouTube data provider is introduced.

```text
Resolved seed brand + objective
  → Qloo + Wikidata concurrently verify seed identity
  → Qloo brand cultural DNA with exact supporting entity/tag IDs
  → LLM generates diverse Qloo-grounded YouTube search queries
  → YouTube search.list (video leads) → deduplicate canonical channel IDs
  → YouTube channels.list + uploads playlistItems.list + batched videos.list
  → for every retained channel, freeze up to 20 latest accessible uploads as the v4 metadata scoring sample
  → LLM extracts source-grounded metadata observations ONCE during discovery
  → preliminary candidate pool: strong matches + promising ambiguous/cross-category leads
  → adaptive transcript exploration/enrichment where material uncertainty remains
  → reuse metadata observations; no second mandatory metadata pass
  → Qloo resolves creator-observed entities, validates pair-specific named bridges
  → selective official web checks for material sponsorship/capability/conflicts
  → freeze candidate evidence → ONLY adopted v4 scorer determines C/R/G, eligibility and confidence
  → separately grouped eligible / conditional / insufficient-evidence recommendations
  → on user selection: three concepts → user-authored Proposal Studio
```

#### YT-1 — Qloo + LLM search-direction planning

- Get *real* cultural entities, tags, supported associations and query context from Qloo's brand cultural DNA. **The existing LLM translates Qloo evidence into useful search directions**; Qloo does not itself supply a ready-made list of optimally formulated YouTube queries.
- Generate a diverse, bounded set of directions (illustrative **3–5**, constrained by the existing search-call quota), including direct, adjacent and credible cross-category creator opportunities. Avoid reducing everything to `best [brand] influencers`.
- Each proposed `q` includes contributing Qloo signal IDs, rationale, market/language parameter values, planner version and the initiating objective. Reject unsupported invented themes; validate and deduplicate queries before calling YouTube.
- Search directions are **hypotheses for retrieval**, not verified cultural bridges, rankings or statements about creator audiences. Selected `regionCode`/`relevanceLanguage` do not establish US audience demographics.

#### YT-2 — Discover and canonicalize actual YouTube creator channels

- Use YouTube Data API v3 `search.list` (`part=snippet`, `type=video`) with bounded, supported parameters. **Video search hits are leads, not evaluated creators.** Record every search direction and originating video ID.
- Group/deduplicate by stable `channelId`; verify with `channels.list`. For a user-specified creator `@handle`, use documented `channels.list(forHandle=...)` when applicable. Never merge channels from name similarity alone.
- The example discovery budget is **3–5 search directions**, **15–30 unique channel leads** before screening. These are adjustable performance targets, not quotas to fill. Reuse valid cached search/channel/video results and report partial results when quotas fail.
- A **retained channel** is a deduplicated, canonically resolved public channel that passes identity checks and explicit user exclusions. Do not use preliminary topic relevance, popularity or a prospective score to decide whether that channel receives the representative metadata sample. If its uploads cannot be retrieved, record the coverage failure and keep an honest partial/insufficient-evidence lead rather than silently dropping it.
- Preserve search-hit videos separately from representative latest uploads. A surfaced video may be older than the scoring sample; it is still a discovery/research reference, **not automatically part of the denominator** used to establish recurring creator interests.

#### YT-3 — Collect the representative metadata sample DURING discovery

- For **every retained, eligible-to-screen channel discovered**, retrieve once through the existing official API adapter: `channels.list` (canonical ID, channel description, uploads playlist, available public stats); `playlistItems.list` from the uploads playlist (most recent accessible uploads); and batched `videos.list` for available titles, descriptions, tags, dates, formats, duration and public counts.
- **Predeclare and freeze each channel's representative sample as up to the latest 20 accessible uploads before computing content relevance, following the adopted v4 §6.1.** Record collection time, video IDs, publication dates, completeness, excluded/unavailable records and source/hash dependencies. A channel with fewer than 20 accessible uploads uses the actual count; do not pad with discovered search hits or choose only brand-relevant videos.
- Run a bounded LLM extraction **during discovery** over this sample for every retained candidate (structured per channel/batch); use lightweight/prompt-efficient processing where practical. Persist validated, source-linked metadata observations and coverage. The initial discovery UI can stream partial results while other channels are processed.
- Separately retain search-hit metadata and any additionally inspected relevant video **as targeted research evidence**, with `sourceRole='discovery_hit' | 'targeted_research'` distinct from `sourceRole='representative_sample'`. Targeted evidence can substantiate a specific fact or Qloo bridge; it **cannot increase the sample's independent-video frequency denominator or numerator merely because it was selectively chosen**.
- When a creator enters deeper research, **reuse the original metadata sample and extracted observations** without a mandatory second `channels.list`/`playlistItems.list`/`videos.list`/LLM analysis pass. Refetch/re-extract only for missing, expired, changed or invalidated evidence and version it instead of silently rewriting prior assessments.
- YouTube stats, view counts, subscribers and Shorts-vs-long-form are descriptive context, not inferred audience overlap, buyer propensity or a ranking proxy. No comments fetch or video-frame understanding in MVP.

#### YT-4 — LLM metadata intelligence and uncertainty-aware preliminary selection

- The existing LLM extracts from normalized **channel and sample video metadata**, never invented captions, and validates outputs through Zod. Record: `culturalSignals[]` (specific named entities/tags, central/substantive/incidental/critical/unknown context, distinct supporting video IDs), `demonstratedFormats[]`, `collaborationObservations[]`, `sourceCoverage` and contradictions/unknowns. Repeated terms in one video constitute one independent source.
- Each observation retains its exact video/source IDs, text-field basis, normalized entity/alias, extraction/model/schema version and `sourceRole`. Do not present an LLM topic inference as an observed fact or a Qloo-proven affinity; don't treat a mention or affiliate code as a documented paid sponsorship.
- Use a **preliminary evidence screen, not a separate compatibility score**, to identify plausible creator leads. Assess (a) culturally relevant material, (b) demonstrated formats and business clues, (c) evidence coverage and (d) uncertainty or promising cross-category adjacency.
- Avoid **metadata-only winner's bias**: include a limited, diverse exploration pool of *strong matches* **and** *ambiguous but potentially meaningful creators* instead of selecting transcripts only for the most obvious keyword matches. Targets such as 15–30 discovered leads and 5–10 eventual recommendations are illustrative, not mandatory pool sizes.
- A promising creator **does not need a transcript to be assessed** if admissible metadata and Qloo evidence already suffice under v4. Metadata alone also must not be called sufficient when the named relationship or required capability remains unknown.

#### YT-5 — Adaptive, question-driven transcript discovery and enrichment

**Product principle:** Transcribe **only the distinct videos that can materially resolve an outstanding cultural, partnership or evidence-coverage question**, choosing creators and videos dynamically. **There is no fixed per-creator transcript quota, mandatory number of transcript rounds, or hardcoded 3–5-creator cutoff.** Some creators need no transcript; others justify several. Use the existing `youtube-transcript` npm adapter exclusively.

- **Exploration before final shortlisting:** Evaluate both strong metadata matches and promising uncertain/cross-category leads. Select transcript opportunities across this diversity (not only the current top-ranked creators) so that hidden cultural connections absent from metadata can emerge. The exploratory stage may involve one video from several channels, **but is not a mandatory one-per-creator pass**.
- **Further enrichment after each finding:** Use the existing LLM as a *research planner* to select the next **unprocessed** relevant video from the representative sample, an already identified discovery hit, or separately documented targeted research; require `researchQuestion`, `whyThisVideo`, `predictedDecisionImpact` and source IDs. It cannot claim to know spoken content before retrieval. Don't choose solely by popularity, age or engagement.
- After each successful extraction, recompute which **material uncertainty** remains: Qloo-related cultural specificity; substantive vs incidental or critical treatment; confirmed vs alleged partnership; whether independent videos corroborate or contradict; or feasibility for the user's specific objective. Optionally attempt Qloo resolution on newly observed references before choosing another transcript.
- **Stop the per-creator loop** when additional transcripts are unlikely to change an admissible Qloo bridge, v4 evidence finding or material risk; when evidence clearly supports a low/poor fit; when results are repetitive; when suitable captioned videos are exhausted; or when the shared run budget/time limit is reached. Stop for evidence sufficiency, **not** because a fixed count was reached or to seek a higher score. Record the stop reason, attempted/available coverage and unresolved questions.
- **Global operational safeguards still apply**: bounded provider calls and LLM tokens per run, deadline/timeouts, retry limits, concurrent worker leases, error tracking, duplicate-video avoidance, and fair allocation across creators. A budget-limited run reports `partial` rather than falsely declaring exhaustive transcript research. These are **run-level cost/reliability bounds, not per-creator product requirements**.
- The existing adapter has single-attempt timed retrieval today; it may gain bounded retries for transient failures without changing providers. Distinguish `available`, `no_captions`, `blocked`, `transient_error`, `unsupported`, `not_attempted`; after an unavailable transcript optionally try the next justified video, then continue metadata-only if no usable captions exist.
- Parse successful captions **in process memory**, chunk for bounded LLM extraction, derive structured observations with source video ID, offset/time range, normalized cultural entities, contextual stance, demonstrated expertise and explicit sponsorship/affiliate mentions. Validate with Zod; preserve contradiction and video/source identity. **Never store raw transcript text, transcript segments, transcript excerpts, transcript-bearing LLM prompts, or transcript content in logs/traces/exports/cache/snapshots.** Discard raw text immediately after extraction. Store only short structured paraphrased findings, timestamps, provenance, extraction version and status.
- Persist structured transcript-derived observations in the **existing** evidence/intelligence architecture with an absolute expiry of **at most 15 days from extraction**; enforce lifecycle in copied references/snapshots as well. If observations expire, re-extract from a fresh permitted retrieval when necessary or mark dependent research for review. Missing captions must never automatically force `unscored` if other source-backed evidence satisfies v4.
- **Scoring bias safeguard:** Predeclared latest-upload metadata sample stays unchanged. Transcript observations from a video *inside* that sample can confirm, upgrade or refute **that same video's** relevance classification, never count the video twice; a transcript from a discovery/targeted video *outside* the sample may support a distinct qualitative claim or bridge but must not be added to the representative sample's topic-frequency numerator or denominator. Apply the adopted v4 relevance rubric exactly.

#### YT-6 — Qloo creator cultural entity resolution and admissible bridge evidence

- Retain separate `creatorObservedSignals` from the LLM and `qlooResolvedSignals` from actual supported Qloo MCP operations. A YouTube channel is **not** presumed to be a native Qloo creator entity. Resolve specific creator-observed artists, books, films, games, cuisine, places, brands or supported tags via the real available tool contracts; don't force generic words into fabricated Qloo entities.
- Preserve the exact Qloo request context, resolved typed IDs, relations, independent creator evidence and failures/ambiguities; deduplicate aliases and avoid misattributing similarly named entities. Preserve substantive versus critical context. Return source-linked `direct`, `cross_category`, `complementary_hypothesis`, or `unsupported` using the *same enum* as §5.2 and the adopted v4 contract; only v4-admissible bridges may affect Cultural Connection.
- Qloo is used **twice**: first for seed-brand cultural DNA and the LLM search planner, then for actual supported pair-specific connections with *observed* creator cultural entities. Mere search-result overlap or a plausible LLM analogy is not a scored bridge.
- Qloo resolution and transcript selection can interleave when a new finding raises or resolves a research question; finalize all eligible evidence before the v4 scorer is called. Absence of a Qloo bridge produces an `unsupported`/`insufficient_evidence` state where the adopted v4 requires it, never an invented weak numeric rating.

#### YT-7 — Freeze, verify, assess, and group final recommendations

- For promising creators only, use **selective official web research** where it materially corroborates a sponsorship, prior collaboration, conflict, availability-related unknown or demonstrated capability. Web research is not an alternative YouTube scraper.
- Freeze one versioned, immutable *pair/objective* assessment input with representative sample ID/list, all cited channel/video IDs, discovery/targeted-vs-sample `sourceRole`, retrieved/extracted versions, transcript-observation references (not raw text), Qloo IDs/query context, goal-related capabilities, constraints, missingness and expiry dependencies.
- Score using **only** the adopted `CrossCulture_Scoring_Engine_v4.md` implementation. Produce its single score, C/R/G explanations, admissibility, separate coverage/confidence, and no unsupported reach/ROI estimates. Generate no detailed concepts before a user selects a researched pair.
- **Final recommendation groups must follow adopted v4 §9:** (1) eligible scored and ranked; (2) **scored conditional opportunities ranked separately** with stated qualifications; (3) unscored insufficient-evidence/research leads, never silently intermingled in one score leaderboard. Different objectives/markets/versions aren't blindly compared.
- Only real results are shown; an evidence-poor run can produce fewer than the illustrative **5–10** recommendations. The transcript enrichment pool need not equal final shortlist size; some creators qualify without any transcripts, and exploratory creators may be removed after evidence conflicts emerge.
- Research/proposal loading must not automatically refetch all providers. Refreshing/scoring again creates a new source/version/assessment and marks old claims for review when evidence expires; do not rewrite user-authored proposals.

**Verified implementation boundary (15 October 2026).** The local signed-in worker supports Qloo/LLM-planned creator discovery and specified-channel comparison through official video search, canonical channel screening, up-to-20 latest-upload samples, validated source-linked metadata observations, optional question-driven subtitles, Qloo tag and named-entity resolution, immutable evidence and the adopted v4 scorer. Valid unchanged metadata observations are reused privately; structured caption findings stay on existing video source records for no more than 15 days, with dependent assessments redacted on expiry. Local fixtures verify retention, isolation, no raw caption persistence, and honest insufficient-evidence outcomes. A real selected-video caption fetch succeeded separately. The latest bounded live Qwen3 Next Patagonia run reached a saved insufficient-evidence assessment, but its sampled creator was outside the required US market, one of four metadata batches failed validation, and no Qloo bridge or eligible score was found. Full live transcript enrichment, complete source-grounded extraction and a US creator scored shortlist remain unverified. This status does not narrow the required workflow above.

### 4.3 Brand × Brand — Qloo-led discovery and optional official brand YouTube evidence

**Primary — Find Collaborators** (one initiating brand + objective, no second brand required): Qloo discovers candidate *brand entities*. **Secondary — Compare Specific Partners** (two user-supplied brands): bypass broad discovery and reuse identity, business research, bridge validation, v4 assessment and optional official-brand video corroboration.

```text
Resolved seed brand + objective
  → Qloo and Wikidata independently resolve initiating brand
  → Qloo cultural DNA → Qloo-supported candidate BRAND discovery (not YouTube)
  → deduplicate/self-exclude, preserve originating Qloo evidence
  → preliminary named cultural relationships and candidate pool
  → Wikidata confirms candidate identity, ownership, category and facts
  → selective official websites, products, campaigns and reputable press
  → OPTIONAL, only when materially valuable: verified official brand YouTube channel/video metadata
       (and a particular official video transcript only if an important claim needs its spoken text)
  → source-backed business activity and objective-specific capability evidence
  → supported Qloo candidate/pair bridge verification
  → frozen evidence → adopted v4 C/R/G assessment → eligible/conditional/unscored groups
  → user selects pair → concepts and user-authored proposal
```

- **Qloo remains the brand discovery authority**, not Wikidata, a YouTube search, the LLM or a keyword match. Wikidata is used **in parallel for seed identity** and **after Qloo for candidate verification**; it does not prefilter for same-industry brands or automatically exclude different headquarters countries. Exclude only on verified identity/ownership/conflict facts and actual user constraints; keep missing facts as unknown.
- Use Wikidata/official-domain corroboration to resolve and distinguish candidate brands and ownership. Business relevance and Goal Fit draw on observed products, collaborations, formats and practical capabilities from actual official websites, credible press and selective web research; industry classification alone does not prove execution capability or add a numeric novelty score.
- After identity checks, reuse fresh attributed official evidence, then ask only the missing activity and objective-specific capability questions. Tavily Search may locate relevant pages and Tavily Extract may inspect a selected page when its search body is insufficient; neither supplies brand candidates or Qloo cultural bridges. Share the existing web request budget across Search and Extract, preserve publisher URLs and provenance, and distinguish research not performed, inconclusive retrieved evidence, and explicit sourced contradictions.
- **Optional official-brand YouTube corroboration, not a required new workflow:** If a shortlisted brand has a clearly **verified official YouTube channel** linked through its official website, reliable Wikidata identifier or corroborated first-party source, the existing YouTube Data API v3 adapter may retrieve a *small, question-driven selection* of official videos about launches, campaigns, brand storytelling or documented joint projects. Record canonical channel/video IDs, metadata, dates and claim-specific sources. Never infer a channel is official solely from a matching display name or a fan repost. If the official channel is ambiguous/unavailable or metadata adds no material evidence, skip it without blocking Qloo discovery or v4 eligibility.
- **Optional official-brand transcript:** Only if a material claim depends on spoken details of a verified official brand video, reuse the **same** `youtube-transcript` npm adapter and in-memory LLM extraction; no raw transcript persistence, maximum 15-day structured-observation lifetime. No blanket brand-channel transcripts or creator-style 20-upload scoring samples: the v4 creator representative-sampling rule applies to **YouTube creators**, not automatically to official corporate channels. Official-brand videos are **targeted documentary business evidence**, not a cultural-recommendation input or substitute for Qloo bridges.
- All official-brand YouTube metadata follows the existing **30-day maximum** lifecycle and YouTube quota/cache ledger. Video/press claims need source dates and context; a brand publishing a video does not establish a legal partnership or the other party's intent without explicit supporting evidence. Sources must remain attributable to the verified brand/channel.
- The Brand × Brand flow **still works in full without YouTube**. It must not spend YouTube search quota merely to find brand candidates. No new provider, database table, discovery score, Surprise metric or weighting is introduced. Wikidata category distance may be shown descriptively when supported, never as an independent scoring bonus.
- An explicit user-specified Brand × Brand pair bypasses broad Qloo candidate discovery but still receives Qloo identity/cultural research, Wikidata verification, selective source collection, evidence freeze and the adopted v4 scorer.

### 4.4 Observed collaboration / sponsorship intelligence (both pair types)

This is **observed, incomplete history**, not a definitive sponsor registry.

**Capture for each documented item:** `partner/sponsor`, `candidate`, `relationshipKind`, `sourceId`, `sourceUrl`, `videoId?`, `publicationDate`, `evidenceExcerpt`, `format`, `claimStatus`, `verificationStatus`, `sourceType`, `extractedAt`.

For transcript-derived items, record the structured observation and video/timestamp/source reference in place of `evidenceExcerpt`; do not store spoken text.

**Disclose distinct relationship classifications:**

| Classification | Criterion |
|---|---|
| `explicit_sponsorship_disclosure` | Clear creator/brand statement such as “sponsored by X”, linked to source/time |
| `official_collaboration_announcement` | Official company/creator page documenting partnership |
| `repeated_collaboration` | Multiple **documented** distinct items with same partner |
| `affiliate_reference` | Affiliate link/code, **not** automatically a formal sponsorship |
| `product_review_or_mention` | Brand/product discussed without evidence of paid partnership |
| `possible_conflict_for_review` | Recent documented competitor relationship or other material conflict; **not** proven exclusivity |
| `unknown` | No usable/confirmed evidence |

- Extract disclosure candidates from video **titles/descriptions** in metadata pass; extract spoken disclosures from available **transcripts**; use web research only for high-impact verification. Do not assume `paidProductPlacementDetails` is universally available in public API-key reads or treat an absent flag as no sponsorship.
- Normalize sponsor business identity where reliable; avoid matching a word such as “Apple” to the wrong entity.
- Provide observed sponsorship dates, documented formats, partner categories, repeated public relationships, demonstrated execution capability, and potential conflict questions.
- **Do not** assign automatic authenticity penalties to sponsorship count or reward creators merely for never having a visible sponsor. No invented deal terms, fees, campaign sales, exclusivity, availability or satisfaction.
- For Brand × Brand, the same evidence model covers co-marketing campaigns, joint products and announced partnerships from verified official web/press sources **and, where applicable, independently verified official-brand YouTube video metadata or selectively extracted official-video observations**. Do not turn a product appearance, repost or fan video into a formal collaboration claim.
- The v4 scorer consumes eligible, source-backed observations for both pairing types under its existing criteria. Creator sponsorship evidence informs capability, goal fit or risk only where v4 permits; this FR adds **no new numeric scoring dimension**.

### 4.5 Direct comparison (both types)

- Input is brand + specified brand name/URL or specified YouTube channel URL/handle/ID. Confirm canonical entity/channel; never merge on fuzzy name alone.
- **Skip broad partner discovery** and request only the evidence needed for that pair.
- Reuse the same relevant Qloo/Wikidata, metadata/transcript, official-web, LLM-extraction, evidence and v4-scorer components as primary discovery. Direct Brand × Creator analysis samples the specified creator’s **up to 20 latest accessible uploads before scoring**; it does not need broad `search.list` and can still work if discovery search quota is depleted but other allowed API operations remain. Missing captions do not block a metadata-based eligible assessment. Direct Brand × Brand may use optional verified official-channel evidence under §4.3 without requiring YouTube discovery.
- A forced pair can be a poor match; report a weak/unsupported bridge or insufficient evidence honestly.

## 5. Evidence, lineage and judgment boundaries

### 5.1 Normalized evidence records

Create a single Zod-validated **evidence contract** independent of provider-specific payload shape. Minimum fields:

```ts
interface EvidenceRecord {
  id: string;
  subjectEntityId: string;
  sourceType: 'qloo' | 'wikidata' | 'youtube_metadata' |
              'youtube_transcript' | 'official_web' | 'news_web' | 'user_input';
  sourceUrl?: string;
  sourceExternalId?: string;          // e.g. YouTube video ID or Wikidata Q-ID
  sourceRole?: 'representative_sample' | 'discovery_hit' |
               'targeted_research' | 'official_brand_video';
  sampleFrameId?: string;             // stable ID for frozen latest-upload sample, if included
  observedAt?: string;               // publication or valid event date, if known
  collectedAt: string;
  claimType: string;
  claim: unknown;                     // schema-validated, not arbitrary AI prose
  evidenceExcerpt?: string;          // short source-grounded quote only; omit for transcript-derived records
  context?: string;
  status: 'observed' | 'inferred' | 'verified' | 'disputed' | 'unknown';
  provenanceRefs: string[];          // parent record/Qloo query identifiers
  permissionsScope: 'shared' | 'user_private';
  retainUntil?: string;
  extractorVersion?: string;
}
```

Adapt this interface to the actual repository types. Provider-level payloads remain server-only. Claims cannot cite invented record IDs. Evidence normalization/extraction should be schema-validated and emit coverage even if signals are empty.

### 5.2 Cultural bridge object

Each reported bridge needs:

- Seed brand reference and Qloo evidence; creator/partner source references.
- Named entities/tags and actual Qloo relationship/projection that supports the proposed bridge; preserve query context, operation, units/range and limitations.
- Bridge class (`direct`, `cross_category`, `complementary_hypothesis`, `unsupported`) and concise non-technical explanation.
- Independent source-item count, contradictory evidence, stale/ambiguous state and unknowns.
- No direct comparison of Qloo numeric results across different incompatible queries unless `CrossCulture_Scoring_Engine_v4.md` explicitly defines a justified normalization.

### 5.3 Source integrity and LLM use

- Only the server retrieves data; the LLM receives selected, bounded, sanitized source content.
- Require Zod-valid named entities, cited source IDs, **short excerpts from non-transcript sources only**, structured paraphrased observations (not verbatim text) for transcript-derived findings, context, classification and confidence/coverage *metadata* (not invented success probabilities).
- Deduplicate synonyms and repeated references within the same video; distinguish repeated independent sources from repeated mentions.
- Maintain observation vs hypothesis boundaries. A source may be used to support a creator's skill/capability; it cannot prove a brand's intention to sponsor.
- Changes to source content or extraction prompt/version invalidate dependent re-analysis as appropriate. Do not silently rewrite a historical user proposal.

## 6. Scoring boundary and product states

- `CrossCulture_Scoring_Engine_v4.md` is authoritative for all scorer logic, enums and thresholds. **Do not implement any alternative scoring model with invented ROI, income-proxy signals, authenticity multipliers or YouTube view-to-customer conversions.**
- The scored result is a **single Collaboration Opportunity Score** explained by Cultural Connection, Content/Business Relevance and Goal Fit findings, not a predicted collaboration success percentage. Preserve eligibility/conditional outcomes and **separate** evidence confidence/coverage.
- Build one immutable `AssessmentInput` from normalized frozen evidence. Store snapshot hash, scorer version, objective, relevant source IDs and representative creator sample IDs, Qloo lineage, score outputs, explicit unknowns and references to permitted lifecycle-managed observations. **No generated concept is required before assessment**; user-selected concepts are linked afterward, not created as part of scoring. Historical v1 snapshots remain intact.
- Derive source-backed creator categories and cultural signals from identified YouTube metadata and optional selected transcripts; resolve observed cultural entities and bridges through Qloo, then submit validated frozen candidate evidence to the existing v4 scorer. Return eligible assessments and separately grouped conditional scored opportunities where v4 permits, with source links, coverage and separate confidence. No application-level approval flag, alternate scorer or synthetic-evidence shortcut controls this workflow. Withhold the score for `insufficient_evidence` or `excluded` outcomes and explain the reason.
- Scores appear only when there is sufficient real evidence and a validated scorer implementation. The LLM cannot manufacture numerical scores or select its own ranking thresholds.
- Rescoring after changed objective/evidence/config creates a **new** snapshot; existing proposals remain attached to the original one until user explicitly updates references.

## 7. Concepts and user-built Proposal Studio

### 7.1 Concept hypotheses

- On **user-selected researched pairs**, provide **three distinct evidence-grounded concept directions** (not three minor word variants): e.g., practical/low-lift, culturally exploratory/cross-category, and community/content-oriented where justified.
- Each concept: title, one-paragraph hook, actual deliverable hypothesis, cultural bridge references, demonstrated partner capability references, potential value for each side, major assumptions/risks, tentative format, feasible short pilot and **measurement suggestions**.
- Generate only for a selected pair; the v4 scorer never requires a concept hypothesis for eligibility. Avoid expensive three-concept generation for every rejected discovery candidate.
- Concept text is explicitly *editable* and saved separately from immutable source evidence.

### 7.2 Proposal Studio — research-first, user-authored (mandatory)

**Do not auto-generate a complete final proposal.** When the user opens a selected match:

1. Load a **Proposal Research Package** from the existing assessment/creator and brand evidence. **No automatic provider refetch** on opening an editor. Concepts and proposal briefs must not be automatically created during worker assessment; a brief begins only after the user explicitly starts authoring.
2. Open a structured **editable template**; prepopulate only verified factual fields (both partner names/identities, objective, supporting links) and clearly separate research cards from editable proposal language.
3. Allow the user to choose **Insert finding** on individual research cards (Qloo bridges, observed creator themes and videos, sponsorship/co-branding history, capabilities, conflicts, unknowns, selected concept). Insert concise cited text and a source reference without overwriting the user's words.
4. Let the user write/modify partnership strategy, proposed benefit to each side, creative scope, deliverables, roles, budget, timeline, metrics, rights/approvals and next steps. Do **not** fill unavailable fee, exclusivity, conversion, partner acceptance or license details with guesses.
5. Optional **explicitly user-triggered** “Draft this section from selected evidence” / “Improve writing”; use only chosen evidence; label generated wording as draft; no automatic full-document generation.
6. Autosave user edits and selected evidence references to `public.briefs`; retain concept ID and immutable assessment/source lineage; support revision/save and Markdown/print-ready PDF export.
7. Provide a simple readiness checklist, e.g., `supported cultural rationale`, `chosen concept`, `deliverables defined`, `budget unspecified`, `rights/availability unconfirmed`. This is **not** a new numeric score.

**Default template sections:** (1) partnership overview, (2) opportunity/executive summary, (3) why this pair culturally fits, (4) partner intelligence and documented previous collaborations, (5) value proposition for each partner, (6) selected creative concept, (7) deliverables and partner responsibilities, (8) proposed schedule/pilot, (9) measurement plan, (10) budget/terms/open questions/next steps. Hide irrelevant items per pairing; do not require artificial detail.

**Proposal research package schema** (conceptual):

```json
{
  "matchId": "uuid",
  "assessmentSnapshotId": "uuid",
  "seedBrand": { "id": "uuid", "name": "..." },
  "partner": { "id": "uuid", "type": "youtube_creator" },
  "selectedConceptId": null,
  "culturalBridges": [{ "evidenceIds": [], "qlooResponseIds": [] }],
  "observedTopics": [],
  "observedCollaborationHistory": [],
  "demonstratedCapabilities": [],
  "risksAndUnknowns": [],
  "sourceReferences": []
}
```

The actual schema must use validated types and same-owner references, not blindly trust these client-visible fields. An optional short outreach draft can be **user-invoked later**, not a prerequisite or sending integration.

### 7.3 Saved work and feedback

- Save, reject, compare (up to three), mark too obvious/not feasible/poor fit/already contacted, edit interpretation, undo rejection and trigger a refresh that respects feedback.
- Persist explicit user preferences with feedback; no claim that Qloo itself was retrained. User corrections are distinct from immutable provider facts.
- Research is versioned: **refresh creates new evidence/assessment versions**, not destructive replacement of user-authored documents. Show stale/invalid source links when applicable.

## 8. Minimal caching and persistence architecture

**Three data reuse mechanisms, not one table per integration:**

1. **Private per-user Qloo response cache** — keep `private.qloo_responses`.
2. **One general restricted provider payload cache** — keep/use `private.provider_cache` as the shared internal cache for permitted YouTube `search`, `channel` and `video` metadata (**creator channels and optional verified official-brand channels alike**; web retrieval only if useful/allowed). Preserve the existing `private.youtube_api_requests` ledger for durable quota reservations and request deduplication; avoid duplicating payloads without a migration plan. Never cache raw transcripts.
3. **Wikidata identity/fact reuse through existing catalog** — `catalog.entities`, `catalog.entity_identifiers`. No separate Wikidata cache table.

**This is the selected MVP design. No Redis, transcript-specific DB table, per-provider cache tables or elaborate global intelligence warehouse.** Structured transcript-derived observations use existing evidence/source records or snapshots only, with a 15-day maximum and dependency-aware expiry. Reusable derived creator observations can use the existing catalog intelligence table *only when the underlying source permits shared derivative use*; otherwise store user-private observations inside the existing evidence architecture.

### 8.1 Data reuse matrix

| Record | Storage | Scope | Refresh principle |
|---|---|---|---|
| Exact Qloo request/response | `private.qloo_responses` | **User-private** | Cache by `(owner_user_id, operation, full normalized request hash, adapter/schema version)` |
| YouTube search result | `private.provider_cache` | Restricted shared internal service cache where permitted | Short freshness; maximum 30-day retention from retrieval |
| YouTube channel | `private.provider_cache` + canonical identity projection in catalog | Restricted shared where permitted | Canonical channel ID; mutable API fields maximum 30 days from retrieval |
| YouTube video metadata (creator or verified official brand) | `private.provider_cache`; referenced evidence in existing source records when reusable | Restricted shared where permitted | Video ID; API fields maximum 30 days from retrieval |
| Selected transcript | In memory only; no persistent/cache entry | Temporary server processing | Discard raw text immediately after structured extraction; never log/export |
| Structured transcript-derived observation | Existing evidence/source records or snapshots, no new table | Shared only when permitted; otherwise user-private | Video ID, timestamp and source reference; maximum 15-day retention |
| Wikidata Q-ID and facts | `catalog.entity_identifiers` / `catalog.entities` | Shared | Stable ID + periodically re-verify mutable facts |
| LLM-extracted metadata themes/sponsorship observations | `catalog.cultural_intelligence` when shareable, otherwise own evidence snapshot | Shareable generic source intelligence vs user-private Qloo-influenced findings | Underlying YouTube-dependent observations expire/invalidate no later than their 30-day source lifetime; extractor/source hash and version |
| Pair-specific cultural bridges | User-owned evidence/assessment | **Private** | Qloo response dependency; objective and context specific |
| Scores | `public.assessment_snapshots` | **Private, durable** | Frozen evidence + scorer version; not a provider cache |
| Concepts / proposals | `public.concepts`, `public.briefs` | **Private, durable** | User-authored versions, never TTL cache |

### 8.2 General cache contract

Minimum columns for new `private.provider_cache`:

`id`, `provider`, `resource_type`, `resource_key`, `request_hash`, `scope` (`shared`/`user_private`), `owner_user_id` (nullable only for shared), `payload_json` or restricted object pointer, `payload_hash`, `fetched_at`, `fresh_until`, `retain_until`, `last_status`, `created_at`, `updated_at`.

Requirements:

- Normalized **unique scoped keys**. For Postgres, nullable `owner_user_id` requires explicit partial unique indexes or `NULLS NOT DISTINCT` behavior; do not accidentally allow duplicate shared entries.
- A **freshness deadline** and a separate **retention deadline**; stale evidence may be displayed as historical if allowed, but expired-retention payloads must be refreshed/deleted, with dependent claims invalidated/redacted when required.
- YouTube search, channel and video metadata have a **maximum 30-day retention** from retrieval across the shared cache, request ledger payloads, source/evidence records and snapshots. Use shorter app freshness for fast-changing search results/counts. Cache reads do not extend the original retention deadline; refreshed data gets a new collection time/version.
- Structured transcript-derived observations have a **maximum 15-day retention** from extraction across evidence records, derived intelligence and snapshots. On expiry, remove or invalidate the observations and dependent claims, and mark affected research/assessments/proposal citations as needing review where appropriate while preserving user-authored writing. Stable source identifiers and redaction/review markers may remain without expired YouTube content. **Expiring data must be excluded from normal reads even when deletion is delayed**; schedule deletion independently of the persistent worker where available (e.g., existing Supabase Cron/pg_cron) and retain startup/worker cleanup as defense in depth. No new application table is required.
- Suggested *initial* app freshness, adjustable via config: YouTube search 1–3 days; channel/video metadata 1–7 days depending on mutable fields; Wikidata brand business facts 7–30 days; Qloo exact-context responses according to applicable Qloo requirements and product freshness target. **Suggested freshness is not an assertion of permission to retain data.**
- Cache hits must preserve original `fetched_at`; never make stale records appear live.
- Deduplicate concurrent identical fetches with a DB-level lock/lease or atomic upsert/single-flight for the persistent worker; bounded retry; distinguish absent items from transient failures; short negative-cache TTL.
- Only cache provider data necessary for product behavior. Bound transcript processing in memory; never persist, cache, log or export raw transcript text, including through errors or developer traces. Never serve raw caches to the browser.
- Purge discontinued provider entries/tables and dependencies when safe; retain user work and verify live migration contents before deletion.

### 8.3 YouTube search quota and execution budget

The YouTube Data API has a distinct `search.list` request allowance (documented default **100 calls/day**) and a separate quota-unit allowance for other endpoints; **read/configure project-specific limits from Google Cloud Console** and reconcile them with provider responses. The YouTube API key by itself does not furnish an automatic runtime quota-discovery interface. Each requested search page consumes a search request. Discovery-time metadata sampling must use batched `channels.list`/`videos.list` plus per-channel uploads `playlistItems.list` efficiently; use existing request ledger and valid cache to avoid repeated calls.

- All YouTube calls go through the single worker-side adapter and central budget guard; bounded search directions, cache and in-flight dedup first.
- Use `channels.list`, `playlistItems.list`, `videos.list` efficiently and batch video lookups. No routine channel-wide `search.list` for most recent uploads.
- Put per-run/per-demo request caps, retries, timeouts, and clear quota partial states. Disable unbounded anonymous querying.
- Keep the existing durable `private.youtube_api_requests` quota reservation and cross-process deduplication ledger; use it with the worker-side budget guard. Do **not** create one table per endpoint.

## 9. Supabase logical schema (minimal change)

The verified local baseline has **20 application tables** across eleven migrations: five shared catalog, seven restricted provider, and eight user-owned. Preserve the distinct YouTube request ledger and private user evidence table.

### 9.1 Keep the five shared catalog tables

| Table | Role |
|---|---|
| `catalog.entities` | Canonical brand/creator identities and selected verified Wikidata facts |
| `catalog.entity_identifiers` | Typed Qloo/Wikidata IDs with provenance and verified/candidate status |
| `catalog.social_accounts` | Canonical YouTube channel ID + mutable handle/URL; don't build Instagram ingestion |
| `catalog.source_items` | Reusable **permitted** YouTube/web/structured evidence references with lifecycle |
| `catalog.cultural_intelligence` | Reusable permitted creator/brand **generic** source-grounded extraction; not private Qloo pairing results |

### 9.2 Restricted operational data

| Table | Role |
|---|---|
| `private.qloo_responses` | Keep exact-context per-user Qloo cache |
| `private.provider_cache` **(new)** | Shared permitted YouTube search/channel/video metadata (and optional bounded web results); no raw transcripts |
| `private.youtube_api_requests` | Existing durable YouTube quota reservation and cross-process request deduplication ledger |

**Remove the five discontinued Apify-specific tables** after verifying dependencies and migration contents:
`private.apify_cache_requests`, `private.apify_cache_snapshots`, `private.apify_budget_periods`, `private.apify_refresh_authorizations`, `private.apify_purge_log`.

**Target = 16 application tables** (5 catalog + 3 restricted + 8 user-owned): 20 actual tables − 5 Apify tables + 1 general provider cache. Verify the resulting local schema and migration data before claiming completion.

### 9.3 Keep eight user-owned tables

| Table | Role |
|---|---|
| `public.projects` | User-owned research group and editable project notes |
| `public.analysis_runs` | Validated request, goal, objective/constraints, stage/progress, attempt/lease, provider refs, coverage, worker idempotency |
| `public.matches` | Candidate pair identity, save/reject/compare state and user note |
| `public.assessment_snapshots` | Immutable pair/objective/concept evidence hash, Qloo lineage, scorer version/results, allowed source refs |
| `public.concepts` | Three research-grounded alternatives, selected concept and user edits |
| `public.feedback` | Save/reject/too obvious/not feasible/correction/undo events and preference adjustments |
| `public.briefs` | **User-authored proposal template**, section JSON, selected research citations, versions/export state |
| `public.source_items` | Existing private, user-owned source observations and dependency-aware retention |

No new proposals table or new sponsorship table in MVP. Store sponsor/collaboration observations as structured source-grounded intelligence with references; if performance later justifies normalized relations, migrate then.

### 9.4 RLS and catalog boundaries

- Every user-owned row has non-null `user_id` linked to `auth.users.id`; same-owner child FKs and server-side checks prevent cross-user references.
- Authenticate on every user API request; derive owner ID from Supabase session, never arbitrary submitted `user_id`.
- Provider caches and raw Qloo results are server-only. Shared catalog data is **not automatically exposed to `anon`**; serve sanitized validated projections through backend.
- The backend service role must scope all privileged queries explicitly. Demo state is isolated and ephemeral, not masquerading as a Supabase user.
- Keep secrets, raw prompts, sensitive source text and full provider responses out of exports/debug interfaces.
- Evidence dependency deletion/redaction invalidates associated source-derived claims and marks saved assessments/proposals as needing review; preserve the user's original writing where possible.

## 10. Runtime orchestration (one persistent worker)

### 10.1 Lifecycle

1. Start run with verified identity/goal/constraints and idempotency key; return run ID promptly.
2. Worker atomically leases a run (one active lease per run), tracks attempts/heartbeats and supports restart recovery.
3. Execute bounded stages with provider-specific retries, cache lookup and honest partial errors; persist progress **after each significant stage**, not on every video.
4. **Brand × YouTube:** Qloo/Wikidata seed → Qloo + LLM search planning → YouTube discovery → representative metadata sampling **and LLM extraction during discovery** → preliminary diverse creator pool → adaptive transcript exploration/enrichment where useful → Qloo creator entity/bridge checks → feasibility → evidence freeze → v4 → separately grouped recommendations. Reuse metadata and observations rather than repeating them after shortlisting. **Brand × Brand:** Qloo brand discovery → Wikidata + official web enrichment → optional verified official-brand YouTube evidence only if helpful → Qloo bridges → same v4 scorer. Concepts and proposal creation are **user-triggered after** research, not worker stages.
5. Direct pair skips discovery; common evidence and assessment components are reused.
6. Serve run progress by SSE/realtime if simple, otherwise client polls **only its own run** with backoff. No background polling of catalog/participants/provider tables.
7. Cancel/refresh creates a new run or terminates active work, without corrupting the original snapshot. Respect an in-flight lease and provider quota.

Suggested states (adapt to existing code):
`queued → resolving_brand → building_cultural_dna → discovering → collecting_metadata → extracting → exploratory_enrichment → resolving_bridges → verifying_feasibility → assessing → completed`, plus `partial`, `failed`, `cancelled`. `exploratory_enrichment` is **adaptive and skippable**; transcript/Qloo checks may interleave and emit per-creator progress. For Brand × Brand use `enriching_web` with optional `enriching_official_brand_video` only when justified; for either direct comparison skip broad `discovering`. Concepts and proposal editing are separate user-triggered tasks.

### 10.2 Bounded operation budgets

- **Illustrative discovery budgets, not mandated pool sizes:** 3–5 Qloo-grounded YouTube searches; 15–30 canonical creator leads; **up to 20 latest accessible videos as the predeclared v4 representative sample per retained candidate, fetched during discovery**; preliminary diversity-aware screening; adaptive transcripts for whichever creators/video questions warrant it; 5–10 final results when evidence exists. No fixed per-creator transcript count or mandatory 3–5 transcript-channel cutoff. Optional verified Brand × Brand official-video research remains bounded and selective, not a full creator-style sample.
- One **configurable global** cap per provider/run and demo tier (YouTube API calls, transcript attempts, LLM time/tokens), timeouts, rate limits, bounded retry on 429/5xx with `Retry-After`, terminal partial results. Stop per creator based on evidence sufficiency/diminishing returns instead of a fixed video count. Never infinite agent loops or forced transcript completion.
- During discovery, run **bounded metadata extraction over the frozen up-to-20-video samples** for retained canonical channels; do not spend a full deep-research/long-form analysis call on each raw search hit, or rerun the same source extraction simply because a candidate advances. Do not generate three concepts per candidate during broad discovery.
- The single persistent worker hosts Qloo's MCP process. The serverless web host does not spawn MCP/long-running analysis on each request.

## 11. Public API surface (logical)

Retain existing compatible endpoints; extend them rather than making a second API tree.

| Endpoint | Purpose |
|---|---|
| `POST /api/entities/resolve` | Qloo + Wikidata independent brand resolution; or verified YouTube channel resolution |
| `GET /api/entities/:id/profile` | Sanitized source-backed identity and cultural evidence |
| `POST /api/discovery-runs` | Start either partner discovery mode |
| `POST /api/pairs/analyze` | Direct pair analysis; no broad discovery |
| `GET /api/analysis-runs/:id` | Own run status, partial results, coverage |
| `POST /api/analysis-runs/:id/cancel` | Stop own run safely |
| `POST /api/analysis-runs/:id/refresh` | New run/version and explicit feedback application |
| `GET /api/matches/:id` | Two profiles, bridge evidence, practicality, scorer output when available |
| `POST /api/matches/:id/concepts` | Generate/revise three grounded concept alternatives on demand |
| `POST /api/matches/:id/feedback` | Save/reject/too obvious/correct/undo |
| `POST /api/briefs` | Create user-owned **blank template + selected research references** |
| `GET /api/briefs/:id` | Load saved draft and cited frozen evidence |
| `PATCH /api/briefs/:id` | Save edits, selected evidence, section state/version |
| `POST /api/briefs/:id/export` | Markdown or print-ready PDF of the **user's** proposal |
| `POST /api/shortlists`, `POST /api/shortlists/:id/items` | If named-shortlist feature exists; add table only once needed |
| `POST /api/demo/discovery-runs`, `POST /api/demo/pairs/analyze` | Bounded curated anonymous demo |
| `GET /api/demo/analysis-runs/:id` | Isolated temporary demo results |
| `GET /api/internal/runs/:id/trace` | Restricted operator-only provenance and failure diagnostics |

No discontinued scraper webhook or scraper-trigger routes. Validate URLs against SSRF/identity confusion, and never trust client-provided source claims, scores, entity ownership or proposal evidence IDs.

## 12. Product behavior and information architecture

- Preserve the existing calm/editorial design (`#F7F7F5` background, dark text, restrained accent), accessible controls, keyboard navigation, useful empty states and clear sources.
- Core surfaces: Home; New Discovery/Direct Compare; Entity Confirmation; Cultural DNA; Shortlist; Match Lab; three Concept Directions; **Proposal Studio**; Saved Projects/Research/Proposals.
- Each Brand × Brand candidate: confirmed identity, supported cultural bridges, observed business evidence (including optional verified official-brand video evidence when used), notable unknowns, evidence links, conditional/scored status where qualified. Concepts are not created until a user chooses a researched pair. Creator candidates show canonical channel identity, observed topics/formats and collaboration history, supported cultural bridges, evidence links, coverage, feasibility questions, and v4 score/eligibility/confidence where qualified. Sparse candidates remain labeled with the reason an assessment is withheld.
- Match Lab: source-backed cultural rationale, recurring creator topics and content formats, **Observed Collaboration History**, category/competitor considerations, Qloo bridge links, feasibility and explicitly unknown information.
- Proposal Studio: split **research panel + editable template**, individual **Insert finding** actions, source links, autosave, optionally chosen concept; full proposal is user-authored, not generated on page load.
- Customer UI uses plain terms (“Why this partner,” “Evidence,” “Past collaborations,” “Questions to confirm”), not raw Qloo IDs, worker traces or backend terminology.
- Support sparse candidates, transcript-unavailable creators, Wikidata gaps, unavailable/unverified official brand YouTube channels, and brand weak-Qloo-coverage cases as useful partial experiences instead of error modals or invented content. A creator need not have a transcript to qualify; a brand need not have an official YouTube channel.

## 13. Acceptance tests — must pass for both pairing modes

| ID | Test | Acceptance |
|---|---|---|
| A01 | Canonical brand identity | Qloo/Wikidata independent; similarly named businesses not merged; correct URLs/IDs |
| A02 | Brand × Brand live discovery | Actual Qloo brand candidates → dedup → relevant Wikidata/web facts → sourced bridges/unknowns |
| A03 | Brand × YouTube live discovery | Qloo cultural DNA → **LLM provenance-linked search planner** → real YouTube `search.list` → canonical channel IDs → **up-to-20 latest-video metadata sample and LLM observations collected during discovery for each retained candidate** → diverse preliminary pool → adaptive enrichment/Qloo bridges → eligible/conditional/unscored v4 groups; sparse candidates explained |
| A04 | Direct pair | Known brand/creator or brand/brand bypasses broad search; shared identity/research/assessment components and v4 eligibility for both types; creator direct comparison works without search quota when other API operations remain available |
| A05 | Transcript success and adaptivity | An informative selected video yields timestamped structured observations while raw text never persists; the next video is chosen only for a documented open evidence question, not a fixed per-creator transcript quota; sufficient evidence can stop enrichment after zero or several transcripts |
| A06 | Transcript unavailable and stop | Missing/blocked captions are logged as statuses only; a justified alternative video may be tried within global budgets; metadata-based creator intelligence and v4 assessment continue when evidence suffices; no fabricated speech, automatic score suppression or endless retries |
| A07 | Sponsorship classification | Explicit disclosure, affiliate reference and ordinary product mention remain distinct; partner history incomplete label |
| A08 | Qloo bridge | Generic topic without supported Qloo resolution isn't falsely marked verified; exact query context retained |
| A09 | Representative sample and independent evidence | Creator sample IDs are frozen from up to 20 latest accessible uploads **before scoring**; a discovery-hit/targeted transcript video outside that frame cannot inflate recurring-topic counts; a transcript from inside the frame can revise only that same video; opposing/critical mentions remain visible |
| A10 | Source/claim lineage | Every displayed historical claim, Qloo bridge and content observation has a valid supporting source ID |
| A11 | Scoring | Only the `CrossCulture_Scoring_Engine_v4.md` implementation calculates scores from immutable, versioned input; no second score/ROI model |
| A12 | Provider cache and retention | Same request hits valid Qloo **per-user** cache; shared creator cache reuses eligible YouTube metadata for no more than 30 days; structured transcript observations expire within 15 days across records/snapshots, invalidate dependent research, and raw transcripts never persist/cache/log/export |
| A13 | Quota exhaustion | Search call cap leads to partial discovery, not unbounded retries or fake candidates; direct pair can still function |
| A14 | Proposal authoring | Blank structured template opens with selectable saved research; user edits, citations, autosave and PDF/Markdown export persist |
| A15 | Proposal immutability | Research refresh does not silently change saved user-authored proposal; original snapshot link survives or is marked redacted |
| A16 | Cross-user security | User B cannot read User A's Qloo responses, runs, scores, feedback, briefs, private structured transcript observations or cached private evidence |
| A17 | Recovery | Worker restart and duplicate request don't duplicate whole runs or provider work; retry returns honest partial errors |
| A18 | Creator intelligence and v4 assessment | Real source-linked creator categories, supported Qloo bridges and admissible evidence reach the sole v4 scorer; eligible pairs receive the single score/C/R/G/confidence, **conditional scored opportunities rank separately**, insufficient-evidence pairs remain unscored. No application-level approval flag, alternate score or synthetic claim is used |
| A19 | Anonymous demo | Both pairing modes run with real, bounded Qloo influence for curated inputs; scoped ephemeral data and rate limits |
| A20 | Provider removal | No scraper runtime imports, actor config, run/webhook routes, paid actor calls or Apify-specific tables after migration |
| A21 | Qloo ablation | Compare same fixed examples with and without Qloo contributions; report measured differences, not invented gains |
| A22 | Scorer unit tests | All required fixture/property/objective tests from `CrossCulture_Scoring_Engine_v4.md` pass without changing its formulas in FR |
| A23 | Exploration without metadata bias | A promising but ambiguous cross-category creator can be selected for a question-driven transcript despite lower metadata relevance; only useful unseen videos are selected; reasons and stop conditions are persisted, and repeat work is deduplicated |
| A24 | Optional official-brand video corroboration | Brand × Brand Qloo discovers candidates without YouTube; a verified official channel can contribute explicitly sourced business video evidence when useful, but ambiguous/unavailable channels never block assessment or create false attribution; no creator-style sample is imposed |
| A25 | Discovery-time evidence reuse | A shortlisted creator reuses frozen discovery-time metadata + LLM observations with no mandatory second fetch/extraction; only missing/stale/changed sources trigger versioned refresh; direct compare uses the same v4 metadata sampling process |

**Current acceptance status (verified locally, 15 October 2026; recheck hosted migrations):** A03/A04/A18 are wired through the signed-in worker and frozen v4.0.1 assessment. Real US Hipcamp × Through My Lens **direct comparison and autonomous primary discovery** each saved an eligible 50/100 result (C=.75, R=.25, G=.75) from an official-title-grounded, Qloo-supported Half Dome bridge. The corrected normal discovery used four Qloo-grounded directions, returned 46 distinct channels, selected Through My Lens fifth overall without a supplied candidate, analyzed its 20/20 latest-upload sample, froze the Half Dome source, and saved one eligible and four insufficient-evidence results. Its search-hit video was already in the representative sample and was not counted twice. The complete lineage and provider usage are recorded in `api/reports/hipcamp-creator-ordering-e2e-2026-10-15.md`; earlier unscored discovery probes remain historical diagnostics. Real selected captions, autonomous multi-video enrichment, metadata reuse and local expiry/redaction have separate live/fixture evidence; hosted expiry, conclusive commercial attribution and broader recommendation-quality evaluation remain open. The scorer, source limits and product workflow are unchanged.

**Earlier acceptance checkpoint (historical):** A Patagonia discovery searched five Qloo-grounded directions, retained six distinct channel leads, assessed one US-channel lead with 20/20 validated metadata videos, and saved one insufficient-evidence v4.0.1 result. The earlier Darwin direct run saved timestamped selected-caption observations but analyzed only 5/20 metadata videos before the bounded Qwen output-cap repair. Appalachian Trail resolved to a Qloo place without a supported Patagonia pair relationship. A live official-site commercial search was inconclusive. Brand × Brand A02 remains a required primary workflow with a live scored discovery shortlist still unverified.

## 14. Implementation order for Codex (minimal, incremental)

**Phase 0 — Inspect before changing:**

- Read actual repo, `CrossCulture_Scoring_Engine_v4.md`, `progress.md`, `BUILD_PLAN.md`, current routes/YouTube integration, tables and migrations.
- Record working vs pending code; prior progress indicates anonymous YouTube search/direct comparison may already exist but the signed-in deep pipeline, quota/cache and content analysis are incomplete. **Verify actual status rather than declaring complete.**
- Capture current schema and backup any populated data. Build 1–2 representative fixture examples per provider. Identify all discontinued-provider dependencies.

**Phase 1 — Provider correction and caches:**

- Remove discontinued provider integration and code path dependencies, safely migrate its five tables, remove env/config/docs references.
- Make official YouTube API adapter canonical; validate search → channels → uploads → videos, with batching, exact IDs, quota guard and cached results.
- Keep private Qloo cache and Wikidata catalog reuse. Add just **one** general provider-cache table; don't add Redis.

**Phase 2 — Intelligence pipeline:**

- Implement Qloo seed → **LLM-grounded YouTube query planning** → signed-in creator discovery → **up-to-20 latest-video samples and LLM metadata observations during discovery** → uncertainty/diversity-aware candidate screening → **adaptive, no-fixed-per-creator-count transcript exploration** → Qloo resolution/bridges → frozen source-backed v4 inputs. Reuse metadata in shortlisted analysis; preserve honest unknowns and metadata-only paths when captions are unavailable.
- Implement Brand × Brand **Qloo-only candidate discovery** → Wikidata → selective official/web research, with **optional, strictly official-identity-verified YouTube video corroboration only for materially useful business questions**. Do not make YouTube mandatory for Brand × Brand or allow it to generate brand candidates.
- Add observed sponsorship/collaboration-history classification to the **same** extraction pipeline; no sponsor service or table.
- Freeze evidence with provenance/unknowns; output honest metadata-only results when subtitles unavailable.

**Phase 3 — Scoring and decisions:**

- Reconcile the actual `CrossCulture_Scoring_Engine_v4.md` contract for both pairing types; wire objective/eligibility/confidence/ranking using immutable snapshots, with C/R/G evidence ratings behind the single opportunity score and no numeric novelty bonus. Extend the sole scorer to creator pairs after admissible creator evidence and validation are in place; do not add a flag or competing score.
- Integrate feedback and saved comparisons without scoring in the LLM or adding new weights. **Remove the existing assessment-transaction coupling to automatic concept/brief creation**; concepts and proposal templates must be created only on user actions while historical snapshots remain intact.

**Phase 4 — Research-backed proposal template:**

- Generate three bounded concept directions on selected pair; build Research Package → template editor → Insert Finding → autosave → history → Markdown/PDF export.
- Add readiness checklist, factual-claim citation validation, stale source states and user-vs-provider attribution.

**Phase 5 — Demo and tests:**

- Validate **both primary discovery modes and both direct modes** with real examples and source links. Test discovery-time sample freezing/reuse, adaptive exploratory transcript selection, stopping behavior, availability failures, v4 eligible/conditional/unscored groups, optional official-brand video verification, Qloo lineage, privacy, quota, retention and restart paths.
- Perform limited same-pool Qloo ablation, update repo `progress.md` and `BUILD_PLAN.md` with measured capabilities and known gaps.

Do not mark completion merely because UI screens render; confirm actual live provider provenance and at least one real end-to-end persisted evidence snapshot for each mode.

### 14.1 Scope, dependency and authority guardrails

- This FR defines **what to implement**; it does not claim new features are already deployed. The 14 October 2026 implementation status above is a report, not proof of current hosted state. Recheck migrations, worker and browser paths before marking acceptance tests passed.
- The **adopted repository `CrossCulture_Scoring_Engine_v4.md`** is the sole authority for sample admissibility, C/R/G evidence anchors, eligible/conditional grouping, numerical formula and scoring tests. This FR defines evidence acquisition/selection and the provenance needed to supply those rules. Where any wording differs from the adopted scorer, reconcile *this FR and tests*, not the v4 mathematics.
- Preserve existing Qloo/Wikidata/YouTube/LLM/worker/Supabase architecture; do not add transcript/brand-channel databases, alternative YouTube providers, new discovery or surprise scores, or automatic proposal generation.
- Before substantial code changes, use the existing Graphify graph when current, verify dependencies against source, implement the smallest testable vertical slice, update `progress.md`, and refresh the graph only after substantive milestones.

## 15. Environment variables and references

### 15.1 Required server configuration

```dotenv
# Existing Supabase keys (use project-supported naming)
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server only

# Cultural intelligence, YouTube, LLM (server only)
QLOO_API_KEY=...               # persistent worker/Qloo MCP, server only
YOUTUBE_API_KEY=...            # server only, public metadata API
LLM_PROVIDER=bedrock           # or openai for the configured compatible endpoint
AWS_PROFILE=pet-care           # local named profile; deployed workers may use an IAM role
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=qwen.qwen3-next-80b-a3b
LLM_FALLBACK_PROVIDER=openai   # optional Bedrock failure fallback
LLM_API_URL=...                # compatible endpoint, required when selected/fallback enabled
LLM_API_KEY=...                # compatible endpoint credential, server only
LLM_MODEL=...                  # compatible endpoint model

# Anonymous demo
DEMO_SESSION_SECRET=...        # server only

# Wikidata requires an identifying contact, not OAuth
WIKIDATA_USER_AGENT="CrossCulture/1.7 (https://your-valid-domain.example/contact)"

# Optional execution controls
YOUTUBE_TRANSCRIPTS_ENABLED=true
YT_DISCOVERY_MAX_SEARCHES_PER_RUN=4
YT_DISCOVERY_MAX_CHANNEL_LEADS=30
YT_METADATA_SAMPLE_MAX_VIDEOS=20  # v4 representative sample; up to latest accessible uploads
YT_TRANSCRIPT_RUN_MAX_ATTEMPTS=20  # adjustable GLOBAL safety budget, NOT per-creator quota
YT_TRANSCRIPT_RUN_MAX_SECONDS=180  # adjustable GLOBAL deadline; report partial when reached
```

**Configuration migration:** Remove/reconcile the older `YT_METADATA_DEEP_VIDEOS_PER_CHANNEL`, `YT_TRANSCRIPT_MAX_CHANNELS`, and `YT_TRANSCRIPT_MAX_VIDEOS_PER_CHANNEL` runtime reads when the new workflow is deployed. Do not silently keep old fixed per-creator limits under another name. Use the adopted v4 sample contract if the repository scorer specifies a more precise accessible-upload definition.

**Not required:** Google OAuth for reading public YouTube metadata, Wikidata OAuth, Gemini API/billing, Instagram scraping credentials, separate transcript-service credentials, or a second LLM scoring service. Use real domains/contacts in deployed configuration; sample placeholders are not valid production values.

### 15.2 Official and package references

- Qloo API docs: https://docs.qloo.com/ — inspect the actual authorized MCP tools rather than invent operations or affine score interpretation.
- YouTube Data API overview: https://developers.google.com/youtube/v3/getting-started
- YouTube search: https://developers.google.com/youtube/v3/docs/search/list
- YouTube channels: https://developers.google.com/youtube/v3/docs/channels/list
- YouTube upload playlists: https://developers.google.com/youtube/v3/docs/playlistItems/list
- YouTube video metadata: https://developers.google.com/youtube/v3/docs/videos/list
- YouTube quota calculator: https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube developer policies: https://developers.google.com/youtube/terms/developer-policies
- Transcript package: https://www.npmjs.com/package/youtube-transcript — unofficial, fallible retrieval; behind optional adapter.
- Wikidata Action API: https://www.wikidata.org/w/api.php
- Wikidata data access: https://www.wikidata.org/wiki/Help:Data_access
- Wikimedia API etiquette: https://www.mediawiki.org/wiki/API:Etiquette
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Hackathon: https://qloo.devpost.com/

### 15.3 Definition of done

- [ ] No discontinued provider dependency or active code path remains; migrations reviewed for data safety.
- [ ] Qloo + Wikidata independent canonical brand resolution works.
- [ ] Brand × Brand finds real Qloo candidates and validates material business evidence via Wikidata/web. **Optional verified official-brand YouTube evidence**, when used, is attributable and never blocks Qloo-only assessment.
- [ ] Brand × YouTube uses Qloo + **LLM search planning**, discovers canonical channels via official YouTube search, and **fetches/validates up-to-20 latest-upload metadata samples for retained discovery candidates before shortlisting**; downstream research reuses that evidence.
- [ ] Metadata intelligence works without captions; **adaptive transcript selection intentionally explores both strong and uncertain/cross-category candidates**, enriches only when a real research question remains, stops on evidence sufficiency/diminishing returns and never applies a fixed per-creator transcript quota.
- [ ] Qloo-resolved creator signals produce verifiable bridge evidence or explicit unsupported/unknown states.
- [ ] Sponsorship/collaboration-history extraction distinguishes disclosure, affiliate, review/mention and unknowns.
- [ ] Private per-user Qloo cache, one general provider cache, Wikidata catalog reuse and quota guard work.
- [ ] The actual `CrossCulture_Scoring_Engine_v4.md` drives all scored results; representative sample rules and **separate eligible/conditional/unscored groups** are respected, frozen snapshots and source lineage persist.
- [ ] Users can create, edit, save and export **their own** partnership proposal using individual selectable cited findings.
- [ ] Both signed-in pairing modes and bounded anonymous demo work end to end; failures and limited evidence are truthful.
- [ ] RLS, per-user source privacy, concurrent request deduplication, **independently scheduled expiry cleanup** enforcing maximum 30-day metadata / 15-day observation retention (e.g., Supabase Cron/pg_cron, in addition to deny-expired reads and worker cleanup), and worker restart tests pass.
- [ ] `progress.md`/`BUILD_PLAN.md` reflect implemented status, remaining issues and real contract tests.

---

**README-ready summary:** CrossCulture uses Qloo cultural intelligence to discover unexpected Brand × Brand partners, with Wikidata and selective official web research confirming real business evidence; verified official brand YouTube videos can optionally corroborate specific claims. For Brand × YouTube, the LLM turns Qloo signals into search directions; the official YouTube Data API v3 discovers creator channels and supplies one reusable latest-upload metadata sample during discovery. Adaptive, selectively available subtitles deepen culturally uncertain leads, Qloo validates named bridges, and the adopted v4 scorer evaluates eligible partnerships while preserving separately labeled conditional and unscored results. Users turn selected source-grounded opportunities into their own editable partnership proposals.
