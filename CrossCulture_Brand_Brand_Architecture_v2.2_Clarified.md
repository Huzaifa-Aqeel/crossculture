# CrossCulture
## Brand × Brand — Qloo + Shopify Product Blueprint

**Version:** 2.2 · **Date:** 18 October 2026  
**Status:** Final proposed product architecture for implementation; live end-to-end feasibility is still being verified. **18 October 2026 clarification:** cultural evidence gate aligned with Commerce Assessment v1.1; core architecture unchanged.  
**Replaces:** The prior Brand × Brand 2.0 architecture draft and v2.1 of this blueprint.  
**Scope:** Brand × Brand commerce only. The historical Brand × Brand and Brand × YouTube workflows, reports, and providers are retired from the final app; no compatibility path is required.

---

## 1. What CrossCulture does

**CrossCulture finds culturally relevant brands and identifies real products they could combine or recommend together.** It gives a small or growing consumer brand a shortlist of specific partnership opportunities, the evidence supporting each one, and a proposal it can edit and take to a potential partner.

The product answers three questions in order:

1. **Who might be an interesting partner?** — Qloo's cultural intelligence and brand recommendations.
2. **What could the two brands actually offer?** — Shopify's existing products, sellers, variants, prices and availability.
3. **Is this particular idea supported by evidence?** — CrossCulture's product-specific assessment, plus selective public research.

This is **partner discovery and proposal preparation**, not automatic partnership execution. Neither a Qloo relationship nor two available Shopify products proves shared customers, a signed agreement, one-cart fulfillment, profitability, sales lift, wholesale rights or partner willingness.

**Provider principle:** Qloo decides which cultural connections are worth exploring; Shopify tells us which products exist; CrossCulture evaluates whether the products support the selected partnership objective. Qwen explains evidence and develops proposals. Tavily supports selective identity research, external verification and investigation of shortlisted partners. The application worker, not Qloo, coordinates these steps.

## 2. The two partnership objectives

### A. Product Bundle Discovery

**Customer question:** “Which brand has an existing product that could form a useful or culturally coherent bundle with one of mine?”

The result must identify **a product from Brand A and a product from Brand B**, ideally with selected variants, their roles in the proposed bundle, a concrete use occasion or functional relationship, current comparable listed prices and relevant offer conditions.

Examples of acceptable mechanisms:
- **Functional:** Specialty coffee + a suitable brewing accessory.
- **Occasion:** Tea + a tea cup for a coherent gift set.
- **Cultural/occasion-led:** Two different products supporting a specific, substantiated shared experience.

A bundle is **proposed**, not already co-branded, sold as one SKU or ready for checkout. No assumption of co-packing, joint pricing or shared fulfillment.

### B. Cross-Sell Partner Discovery

**Customer question:** “Which culturally relevant brand has an existing product that would complement what my store currently offers?”

The result identifies **a partner product** and explains which observed Brand A products, functions, use cases or customer-facing occasions it complements. It may suggest assortment expansion, a stockist discussion, referral or product-sharing exploration; it **does not** assert that Brand A has permission to resell or add it to checkout.

This objective requires an **honest description of catalog coverage**. Limited storefront searches show an *observed assortment*, not the complete assortment. Do not claim an entire category is missing based on a partial search.

**Both objectives use existing products.** New-product manufacturing, generic awareness campaigns and brand repositioning are outside this MVP.

## 3. What the user enters

Keep the starting screen simple:

| Field | Required? | Notes |
|---|---|---|
| **Brand name or storefront URL** | **Yes** | Identify Brand A; verify the company and its storefront, not merely the domain's spelling. |
| **Objective: Bundle or Cross-Sell** | **Yes** | Determines which product opportunity to look for. |
| Market | Pre-filled **United States**, editable | Provides explicit context for price, currency and shipping checks. |
| **Focus on one of my products** | Optional **after product retrieval** | Show retrieved products; let the user select a hero product or continue with automatic discovery. Never call them “best sellers” without actual sales data. |
| Partner-product price range / product preferences | Optional refinement | Apply only if the user explicitly sets them; no invented universal margins or price ratios. |

In **Primary — Find Partners**, Brand B is never required. In **Secondary — Compare Two Brands**, the user also supplies Brand B (name or verified storefront).

**Do not ask for** a budget based on predicted revenue, target customer demographics inferred from a catalog, inventory quantity, AOV, COGS, margin or projected ROI. Public Shopify Catalog MCP does not provide these private business facts. No merchant Shopify Admin connection is required for this MVP.

## 4. Exactly what each provider is responsible for

| Tool | Used when | What it contributes | What it cannot prove |
|---|---|---|---|
| **Qloo Search + Insights** | Start of discovery; later cultural check | Native brand resolution, supported cultural signals, brand recommendations, query-specific relationships | Shared customers, purchase likelihood, product-level affinity for arbitrary Shopify SKUs |
| **Shopify Storefront Catalog MCP** | Investigating **one verified store**: Brand A or known Brand B | Products and selected offers **returned from that merchant** | Full inventory, revenue, best sellers, comprehensive assortment from limited searches |
| **Shopify Global Catalog MCP** | Searching **across merchants**, finding offers when a store endpoint is missing, or a separately labeled discovery fallback | Products, seller offers, variants and relevant market/price signals | Seller equals manufacturer, wholesale eligibility, a commercial agreement |
| **Official brand websites** | Checking the real business and its official domain | First-party business evidence and documented ownership when available | Product-market fit or complete company registry |
| **Verified merchant records** | Linking an official storefront to the business | Confirm the associated Shopify merchant/store and seller where available | Seller equals manufacturer or brand owner without further evidence |
| **Qwen + structured validation** | Extracting specific product-cultural references, selecting research questions, proposing product mechanisms | Source-linked descriptions, structured findings and justified hypotheses | Independent proof of facts, Qloo affinities, automatic decision authority |
| **Tavily** | Selective identity research when needed; after product shortlisting; optionally after user selects partner | Sources for identity corroboration, documented collaborations, relevant public concerns and dated seasonal/cultural hooks | A search result alone does not prove identity, absence of controversy, contractual availability or predicted results |
| **Commerce Assessment v1.1** | Once evidence for a proposed product opportunity is assembled | Transparent Supported / Needs Verification / Unsupported result | A probability of success or ROI forecast |
| **Supabase** | Throughout | User runs, permitted evidence references, assessments, editable proposals and access control | Permission to retain prohibited Shopify catalog results |

**Storefront and Global are alternatives in many situations, not two mandatory calls per brand.** See Section 7.

## 5. Primary workflow — Find Partners

### Step 1 — Resolve the initiating brand

Take the supplied brand name or URL and establish **which real business it identifies**. Run native Qloo brand resolution and official-domain/storefront verification as independent, parallelizable checks. Use Tavily selectively when identity research needs an external source, then corroborate the result against official brand websites and verified merchant records. A search result alone is not identity proof.

Keep these identities separate: **Qloo brand**, **legal/business brand**, **official site**, **Shopify merchant/store**, **product manufacturer/owner**, and **product seller**. Similar names do not establish identity.

Only request a user correction when ambiguity genuinely prevents choosing the right entity or store.

### Step 2 — Observe Brand A's real products

If a verified storefront offers Catalog MCP, use **Storefront Catalog MCP** to investigate its products. Search across relevant product families, inspect useful matches, and obtain actual products and variants. Keep a record of **what was observed and how complete the search was**. A partial search is not a full catalog.

For a verified official domain, bounded discovery may also probe its `checkout.`, `shop.` and `store.` subdomains. A name pattern alone is never merchant proof: accept an alternate only when its UCP discovery document declares the Catalog capability, a valid MCP endpoint and a Shopify shop ID associated with the official host. Other domains require a separate first-party link and identity check. Do not substitute a different shop, seller, product or variant after a failed probe.

If the Storefront MCP does not work, first check for a **verified alternate store domain**. If the same merchant is independently linked to a Shopify shop ID, Global Catalog restricted to that shop can be used. An unrelated reseller's listing **must not quietly replace Brand A's own offer**.

If no trustworthy Brand A product can be found, mark this as an incomplete commerce research path; do not pretend a verified product bundle exists.

**Why Brand A products are retrieved early:** Bundles and cross-sells ultimately require specific products. The same data can help form cultural-search hypotheses if Qloo lacks a native brand identity. Brand products are not a substitute for the brand's actual customer-taste profile.

### Step 3 — Let Qloo discover potential partners

**Main path — Native Qloo brand**

**Qloo has four distinct research operations: identify the seed, understand its cultural context, discover other brands, and investigate the evidence for shortlisted candidates.** Do not collapse them into a single unexplained recommendation.

1. **Resolve Brand A precisely.** Search for its native `urn:entity:brand` record. Reconcile Qloo's result with the verified real business; keep the exact entity ID. An ambiguous name match must not become a confirmed brand identity.
2. **Explore Brand A's cultural context.** Use Qloo tag/taste analysis anchored to the verified brand ID to inspect supported interests, where available. This helps the user understand why wider cultural directions may be relevant. **Tag analysis is optional enrichment, not a gate to native brand recommendations**: if it is unsupported or uninformative, retain the native brand signal and continue.
3. **Discover partner brands.** Query Qloo Insights with Brand A's native entity as the interest signal and **brand entities** as the output. Exclude Brand A itself. Preserve the query, output brand IDs, rankings/returned affinity fields, and explainability when Qloo provides it. The discovery list is a pool of **cultural leads**, not completed partnership opportunities.
4. **Investigate shortlisted candidates, not every candidate exhaustively.** Verify each candidate's own Qloo identity; make a candidate-specific request anchored to Brand A's signal where supported, and examine the *actual returned evidence*. Retrieve candidate tag context only if it will clarify a material cultural claim. Do **not** infer specific shared cultural interests from names, product aesthetics, or an LLM narrative.
5. **Say only what Qloo established.** A native Qloo recommendation may be described as *“Qloo recommended Brand B from Brand A's brand signal.”* Name a particular shared cultural theme **only** if traceable returned Qloo findings support that theme. A returned affinity/explainability value is **not** a measured percentage of overlapping customers; explainability can describe the influence of query inputs rather than a proven bilateral/shared interest.

#### Qloo execution reference — BAGGU example (request shapes, not live results)

Use the verified IDs returned by Qloo; the placeholders below are **not** real IDs. Encode query parameters correctly in implementation, authenticate server-side, and validate the response schema before proceeding. These request shapes follow Qloo's documented Search, Insights, Taste Analysis and candidate-result filtering options.

| Purpose | Illustrative request using real documented parameter names | Required interpretation |
|---|---|---|
| 1. Resolve BAGGU | `GET /search?query=BAGGU&types=urn:entity:brand&take=10` | Confirm the returned business and record its **actual** Qloo brand UUID. |
| 2. Explore taste tags (optional) | `GET /v2/insights?filter.type=urn:tag&signal.interests.entities={BAGGU_ID}&take=20` | Use only tags **actually returned**. No LLM-invented tag IDs; failed/empty tag results do not block Step 3. |
| 3. Discover brands | `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities={BAGGU_ID}&filter.exclude.entities={BAGGU_ID}&feature.explainability=true&take=20` | Record Qloo's returned candidate IDs and query-specific evidence. Do not fabricate a required quota of matches. |
| 4. Focus on a candidate | `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities={BAGGU_ID}&filter.results.entities={CANDIDATE_ID}&feature.explainability=true&take=20` | Confirm what the focused query **actually** says about the candidate. Do not treat a constrained result as a fresh independent discovery or evidence of reciprocal affinity. |

For a candidate-specific check, keep the originating signal and applicable parameters consistent where possible. If the focused query changes the filtering/scoring context, **do not compare scores as if they came from the same ranking**. If the endpoint does not return the candidate or explainability is missing, retain the unembellished original discovery evidence and label the finer cultural claim **unverified**. A missing focused result does not by itself prove the two brands are culturally incompatible.

**Named cultural themes require evidence:** For example, if actual Qloo tag results support a specific design-related association for both verified brands, the UI may describe those *two observed associations* with appropriate qualification. It must not silently upgrade two associations into proof of customer overlap, reciprocal preference, or product demand. If Qloo only shows the initial recommendation, say exactly that rather than inventing a theme.

**Previously reported test, not a new Qloo response:** Codex reported that BAGGU's native Qloo discovery included Cold Picnic. Treat Cold Picnic as a **candidate to investigate**, not as a hardcoded preferred partner, a confirmed bilateral cultural match or an already suitable bundle. The live worker must verify the real returned IDs and evidence in each run.

**Experimental path — Brand A not in Qloo**

1. Use verified products to identify **specific, source-backed cultural references** (e.g., a documented design tradition or named cultural entity), not merely “coffee”, “fashion” or “lifestyle”.
2. Confirm the references resolve to valid Qloo entities/tags.
3. Ask Qloo for brand recommendations **for those cultural signals**, then verify the candidate actually participates in the relevant territory.
4. Label the result **context-based / product-culture-guided**, not a native Brand A affinity or proof of shared customers.

**Decision for the hackathon:** Native Qloo discovery is the production core. The non-native path is **optional and gated on a real successful live test**. Its failure must not stop the working native path or generate fabricated affinities. If neither valid native nor verified context-based Qloo input exists, the application should explain its limit rather than silently become ordinary Shopify search.

### Step 4 — Investigate Qloo's candidates in a bounded funnel

For each Qloo candidate, prioritize cheap checks before expensive research:

1. **Verify the actual business, Qloo candidate ID and official shop.** Reject accidental matches to unrelated namesakes.
2. **Inspect the candidate's real cultural evidence when relevant to the proposed explanation.** Use the focused Qloo check from Step 3 where supported. Its purpose is to substantiate or limit the cultural rationale; it is not permission to invent a reciprocal relationship.
3. **Check whether it offers relevant existing products.** Prefer that verified merchant's Storefront MCP; use Global appropriately when unavailable.
4. **Form a small set of specific product hypotheses.** Pair Brand A and Brand B products for Bundles; connect partner products to Brand A's observed assortment for Cross-Sell.
5. **Discard invalid identities and clearly unusable offers early.** A culturally relevant brand with no accessible Shopify offer is a *coverage limitation*, not proof it is a bad cultural partner.
6. **Continue the Qloo-to-Shopify loop when a product pairing fails.** First investigate another relevant product or selected variant from the same verified candidate if that could resolve the issue; otherwise move to the next Qloo-recommended brand. Stop at a bounded research budget or when additional research would have little value. Do not rewrite cultural evidence to force a positive result.

If the native recommendation pool runs out without viable product opportunities, return the legitimate partial result and, **only when valid Qloo cultural directions exist**, consider the explicitly labeled Shopify Global discovery fallback. Never manufacture a fixed number of results. **Two well-supported opportunities beat ten unfounded suggestions.**

### Step 5 — Use Shopify for the specific product questions

For each shortlisted product hypothesis, retrieve the **actual selected offer** and check:

- Product, variant and merchant/seller identifiers and product link.
- What each product does; relevant options/materials where reliably sourced.
- Current listed price, ISO currency, selected quantity and market context.
- Selected-variant availability where reported.
- Shipping eligibility for the chosen country **only where actually reported**.
- Whether the seller is the intended Brand B, a verified authorized channel, or an unrelated third-party retailer.

**Global Catalog can group offers from multiple merchants under one product.** Never choose a different seller or a different variant without telling the user. A Shopify-inferred attribute is not the same as a verified merchant-authored product claim.

### Step 6 — Validate culture and product complementarity separately

**Qloo's cultural evidence** answers why the brand or cultural context was considered. Preserve the original Qloo brand recommendation and, for important claims, inspect the candidate-specific Qloo result and any separately observed tag context. Distinguish **“Qloo recommended this brand”** from the stronger **“Qloo returned evidence for this named cultural connection.”** When explainability is absent, warn instead of inventing a reason; when Qloo merely contributed a search direction, label the result a hypothesis. Qloo does **not** automatically “rescore” arbitrary Shopify SKUs. A second query is an evidence check, not a universal numeric rescoring step.

After a verified candidate has an assessed product opportunity, compare the two brands' separate Qloo taste-tag results for a specific, identical returned signal. If such a pattern is observed, the customer may see a qualified **cultural audience compatibility** explanation automatically. This is an inference from two brand-level signals, not shared-customer measurement or proof that the selected products appeal to the same buyers. Aggregate Qloo age/gender affinity may be inspected only for a shortlisted pair with a specific observed cultural pattern; report positive alignment as separate aggregate observations, without an overlap percentage. Missing or generic signals add no named claim and never change the product verdict. Keep the optional research owner-private and outside the assessment/ranking inputs.

**Product evidence** answers whether the proposed items work together. Qwen can propose a specific, falsifiable pairing mechanism using verified product facts:

The search worker may use bounded query hypotheses, but a fixed list of known product pairs must not be the eligibility gate. Inspect exact selected product details for any proposed combination. Pass only a bounded transient set of selected-product text to Qwen, never a stored Catalog search response or image. Validate its cited passages against the selected source fields and keep inferred Global Catalog descriptions distinct from merchant-authored Storefront detail. If the proposed common use or differentiating claim lacks source support, retain the lead as Needs Verification rather than treating the model's prose as proof.

Apply a second, isolated structured rubric to the **source-checked short passages** for semantic coherence and incremental value. Its classification can withhold support but cannot establish a product fact, seller identity, compatibility, demand or deal. A failed rubric call leaves the mechanism unverified. For Cross-Sell, a partial assortment can support a claim expressly limited to reviewed products when a selected Brand A anchor is verified; no partial search can justify an exhaustive category-absence statement.

- **Functional complement** — e.g., one product helps use the other.
- **Occasion complement** — a coherent gift, kit or shared real use occasion.
- **Assortment complement** — a partner item adds a distinct use case or function to Brand A's observed products.

Two products sharing the word “design” or belonging to the same category does not establish complementarity. Neither does category distance alone establish novelty or buyer demand.

Only accept supported attributes and a clear role for each product; a plausible story with no evidence stays **unverified**.

### Step 7 — Assess the particular opportunity

CrossCulture evaluates the **specific product combination**, not the brands in the abstract. See Section 8 for the decision rules.

### Step 8 — Vet shortlisted partners, then show the shortlist

Use Tavily **selectively**, after a promising product opportunity exists. Look for relevant prior collaborations, public brand positioning, material documented problems and conflicts that deserve review. Check dates and source quality; separate reporting from allegations. An absence of negative results is not a safety guarantee. Do not use news as an automatic brand-safety score.

Display the evaluated opportunities grouped by verified partner, with the actual products, cultural rationale, commerce checks and unresolved questions.

### Step 9 — After user selection, create the proposal

Only after the user chooses a researched product partnership (**amended 25 Oct, user decision:** the separate three-concept step is removed):

1. **Create proposal** re-checks both selected offers, then drafts the proposal directly from verified facts only: the products with links and prices, why it fits, cultural fit, where audiences overlap, what each brand brings (the assessed product roles), what to agree together and sources. Sections without evidence are left out; no model writes new product or deal facts.
2. The proposal opens on its own page (the **Proposal Studio**) for reading, editing, copying, download and save; closing it returns to the research results.
3. Save/reload/export the user-controlled proposal under the existing authentication and access rules.

Do not invent a partner's consent, shared checkout, bundle discount, manufacturing agreement, retailer permission, campaign ROI or predicted sales.

## 6. Secondary workflow — Compare Two Brands

The user supplies **Brand A and Brand B**, plus an objective. Verify both identities and observe actual products, then perform a **pair-specific Qloo cultural investigation** and the same Shopify/product/commerce research as Primary.

**Skip broad Qloo partner discovery.** Brand B need not have appeared in a previous recommendation list. The user naming Brand B does not establish cultural compatibility either.

When both brands have verified Qloo identities, investigate Brand B specifically using Brand A as the signal and `filter.results.entities={BRAND_B_ID}` where supported; optionally inspect the reverse direction or both brands' tag evidence **as separate observations**, not a symmetric score or an obligatory gate. Preserve the exact inputs and returned evidence. **A filtered candidate's mere presence is not an independent recommendation or sufficient proof of a relationship.** A documented, interpretable association or adequately corroborated candidate-specific cultural evidence may substantiate the pair, but lack of a *named theme* alone does not negate an otherwise verified association. If the pair-specific evidence remains insufficient, label the cultural relationship unresolved. When one brand is non-native, apply the same product-context limitations described in Step 3; never claim direct native Qloo pairwise affinity.

Return supported, incomplete or contradicted **product opportunities for that named pair**. Preserve the same proposal experience.

## 7. Exactly when Global versus Storefront Catalog is called

**Decision rule: Is CrossCulture investigating one verified merchant, or searching across merchants?**

| Research question | Preferred path | If unavailable / insufficient |
|---|---|---|
| “What does Brand A sell?” | **Brand A Storefront MCP** | Verified alternate store; Global restricted to verified shop when possible |
| “What does this Qloo-recommended Brand B sell?” | **Brand B Storefront MCP** | Global with verified shop filter or careful seller reconciliation |
| “Which merchants sell products for this validated cultural direction?” | **Global MCP** | Return limited discovery rather than invent sellers |
| “What is the current offer for this exact product/variant?” | Fresh `lookup_catalog` or supported `get_product` from the appropriate catalog | Mark missing fields unknown; don't substitute variants |
| “Can a product be delivered to our selected market?” | Global market/shipping filters and specific returned offer data | Unknown if not established for the selected seller/variant |

The two MCP interfaces are UCP catalogs at:

- **Storefront:** `https://{verified-store-domain}/api/ucp/mcp`
- **Global:** `https://catalog.shopify.com/api/ucp/mcp`

Use the capabilities the endpoint actually negotiates, rather than assuming all three documented catalog tools (`search_catalog`, `lookup_catalog`, `get_product`) are available for every store. Storefront-first is a **selection preference for known merchants**, not a requirement to call Storefront and Global on every candidate. Global `shops` filtering should only be used with a **verified Shopify shop ID**, not a guessed shop name.

**Shopify fallback:** If usable Qloo-recommended brand candidates are insufficient, Global may find merchants/products from **Qloo-supported cultural directions**. Show product-backed results explicitly as **Qloo-guided Shopify research leads**. They are not native Qloo recommendations. They can become a fully supported opportunity only if independent cultural evidence and all product/identity requirements subsequently pass.

**Customer result boundary:** A Qloo recommendation without a verified merchant product is an internal research attempt, not a customer-facing partner card. Continue to the next candidate and retain the failed attempt only in the private developer trace. Do not list every rejected or unreachable recommendation in the customer UI or run response. A Needs Verification opportunity with actual verified selected products remains eligible for display with its unresolved claims.

## 8. Commerce assessment: a clear decision, not an invented score

**Evaluate one opportunity at a time.** A brand may have several different product opportunities, each with a different outcome.

| Evidence area | What must be checked |
|---|---|
| **Cultural support** | Traceable **unconstrained, verified native Qloo brand recommendation**, or substantive candidate-specific Qloo association, or independently corroborated context-based Qloo relationship. A named cultural theme requires its own returned evidence; neither a missing theme nor missing explainability nullifies a verified native recommendation. A forced candidate's mere presence or search-direction use is not enough. |
| **Correct identities** | Brand A, Brand B, actual seller, selected product and variant are correctly connected. |
| **Product complementarity** | A specific functional, occasion or assortment reason supported by real product attributes. |
| **Objective fit** | Bundle: identifiable products from both brands. Cross-Sell: identifiable partner item relative to the observed Brand A assortment. |
| **Commercial constraints** | Explicit user limits, correct price/currency, availability and required-market signals where applicable. Unknown isn't a confirmed failure. |

**Cultural assessment clarification (v2.2; Commerce Assessment v1.1):** Record **relationship evidence** independently of **explanation specificity**. A correctly identified Brand B returned from an unconstrained, Brand-A-anchored native Qloo recommendation is sufficient cultural *relationship* support for assessment even if there is no defensible named shared theme; it is **not sufficient to approve the product opportunity on its own**. For user-specified/direct pairs, a query constrained to Brand B does not pass this gate by mere inclusion: require interpretable Qloo evidence beyond forced inclusion or separately corroborated cultural findings. Context-guided Shopify candidates remain research leads until candidate-specific cultural support is established. Treat unknown evidence as unknown, not as contradiction. Full rules: **Brand × Brand Commerce Assessment v1.1**.

### Three outcomes

**Supported Opportunity** — The cultural case, product combination and required factual checks are defensible, and no verified user constraint is contradicted. This means **worth discussing**, not a deal ready to launch.

**Needs Verification** — A credible lead exists but a material relationship, identity, selected-offer fact or user-required condition remains unknown. A Qloo-guided Shopify result with only a search-direction connection stays here as a research lead.

**Unsupported** — Verified facts contradict an essential requirement, or the asserted relationship/product mechanism is demonstrably misattributed or incompatible. Not finding enough search results is normally **unknown**, not proof a brand is unsuitable.

**Deal unknowns do not automatically block Supported:** Partner willingness, wholesale/resale rights, negotiated prices, margins, exclusivity, joint fulfillment and launch operations are separate matters to confirm. None may be claimed as established.

### Ranking without a 0–100 number

Group by decision outcome first. Among **Supported Opportunities**, prioritize actual objective suitability, the quality of the specific product-combination mechanism, cultural evidence specificity, evidenced partner differentiation, the user's explicit preferences, and completeness/currentness of the facts—then show **the best distinct product combinations grouped by verified partner**. A merchant must not win merely because it has more catalog listings, or because Qloo scores from incompatible queries were compared. Ties should be stable and explainable.

## 9. How to present a result

Each partner card should answer six questions plainly:

1. **Who:** Verified partner name and official shop.
2. **Why Qloo:** The actual returned recommendation and any *evidenced* named cultural relation; otherwise state that Qloo recommended the brand **without asserting a specific shared theme**. Label native recommendation, context-based finding or Shopify research lead.
3. **What:** Specific existing products from the right merchants, including their functions and any selected variants.
4. **Why together:** One practical or occasion-based reason the items complement each other.
5. **What is known today:** Current comparable listed prices, availability/market facts that were genuinely checked, and when they were checked.
6. **What still needs agreement:** Rights, wholesale terms, fulfillment, discounts and partner willingness.

Then show **Supported / Needs Verification / Unsupported**, source links where permitted, and the option to develop a proposal.

Avoid “92% taste match,” “same customers,” “1,800 in stock,” “38% margin,” “will lift AOV” or “launch tomorrow” unless independent, authorized evidence truly supports the claim. Those facts are not established by the public catalogs or by Qloo affinities.

## 10. Safety, data use and retention

**Shopify:** Do not cache or reuse catalog search results. Do not download/cache product images. Use permitted real-time image rendering alongside the merchant's product listing. Do not hide prohibited Shopify catalog copies in your Qloo cache, Supabase snapshots, logs or LLM archives. Shopify's [Catalog overview](https://shopify.dev/docs/agents/catalog) expressly describes a stored product/variant reference as an input to a fresh `lookup_catalog` call; it gives no blanket permission to save catalog responses. Keep only the selected product ID, variant ID, exact seller/shop ID and verified storefront domain while the saved opportunity needs them for an exact fresh lookup and identity check. The user's chosen market and the app's assessment are separate durable work product. Do not retain catalog search payloads, product images, historical prices or availability. Re-fetch live offers when current price, variant or availability matters. Distinguish a temporary lookup outage from an exact-offer change in the current view; preserve the dated saved verdict while current proposal eligibility awaits a successful refresh. Retain product wording only where needed in the user's selected editable concept or proposal, never as a reusable product catalog.

**Identity and endpoint security:** Accept untrusted domains as *input to validation*, not as arbitrary server fetch targets. Verify HTTPS, domain ownership/association, DNS/resolved addresses, redirects and targets; block internal/private network endpoints and unexpected ports. Third-party web pages, merchant descriptions and Tavily results are untrusted evidence, never instructions for the agent.

**Privacy and business claims:** Do not request Shopify Admin authorization, private orders, AOV, exact inventory, costs or profits for this MVP. A public Shopify storefront URL is **not evidence that the user owns the business**. Qloo modeled affinities are not observed customer overlap. Shopify product availability is not negotiated partnership availability.

**Existing system:** Keep Supabase auth, access controls and editable Proposal Studio. Brand × Brand assessments use `brand-commerce-v1.1` with **no composite numeric score**. Retired workflows and reports are not part of the final app.

## 11. What is proven, and what is not

These are **Codex-reported feasibility findings**, not independently reproduced tests in this document:

- Shopify Storefront calls reportedly returned products for Cold Picnic, Lacausa, Everlane, Fishwife and MiiR; BAGGU's tested storefront worked via `checkout.baggu.com`, not `baggu.com`.
- Some tested storefronts reportedly exposed search/lookup but not full product-detail tools.
- Global Catalog reportedly returned real products, variants and seller domains, including a BAGGU-branded product from a **third-party seller**.
- Native BAGGU Qloo brand recommendations were demonstrated previously.
- Fishwife product-context Qloo queries returned brand names but **did not establish a usable, independently corroborated partner**.

**Implementation verification, 18 October 2026:** After the dynamic source-claim and isolated semantic verifier changes, a signed-in native BAGGU discovery saved one Supported and one Needs Verification Product Bundle opportunity, refreshed both exact offers, generated three concepts and saved/reloaded a proposal. A final signed-in native Everlane Cross-Sell discovery saved two Supported and three Needs Verification combinations; all five reloaded both exact offers as current, and a Supported selection generated three concepts and a saved/reloaded proposal. One selected variant changed during research and was excluded rather than substituted. Signed-in direct comparisons saved Needs Verification opportunities when pair-specific cultural support was unproven and did not permit a new proposal. These checks used Shopify's example agent profile and local Supabase. A publicly hosted CrossCulture profile, hosted acceptance and non-native Qloo discovery remain unverified. The saved-reference field audit uses Shopify's documented fresh lookup pattern and a necessity rule; it does not permit broader Catalog retention. Product-family exploration is bounded and does not establish full assortment coverage.

## 12. Delivery order and acceptance standard

**First deliver a native-Qloo Product Bundle journey.** Prove every link in the chain with current, genuine results—including seed resolution, the actual recommendation response, focused cultural claims where made, real selected products and an honest assessment. Do not allow the experimental Fishwife/non-native path to block that work. Then complete Cross-Sell and direct comparison using shared research components; add non-native discovery only when its own live proof succeeds.

A completed experience must demonstrate:

1. **Qloo-originated partner discovery** with the actual verified seed ID, real candidate IDs, query parameters, returned results and bounded, honest cultural explainability—not a predetermined match.
2. **Correct merchant identity** and two actual, verified selected products or a cross-sell partner product.
3. **A specific objective-appropriate pairing**, with real offer facts and honest missingness.
4. **A product-opportunity outcome** that correctly handles supported, unknown and contradicted evidence.
5. **Selective Tavily identity research, external verification and shortlist findings**, without inventing brand-safety guarantees.
6. **A fact-grounded, saved and editable proposal** (no separate concept step, amended 25 Oct), while respecting Shopify's catalog rules.
7. **No retired Brand × Brand or Brand × YouTube workflow or reports in the final app**.

Also test the failure cases: ambiguous name, wrong seller/retailer, variant substitution, missing prices, currency mismatch, unverified US shipping, incomplete assortment, broad generic Qloo tags, Shopify direction-only leads, and partner without accessible products. For Qloo specifically: nonexistent/ambiguous brand ID; tag analysis unavailable but native recommendations still working; recommendations with no explainability; candidate-specific check absent/empty/changed-context; no named theme support; changed discovery ranks across queries; and an attractive Qloo candidate whose Shopify product pairing fails. **Verify that the worker continues to another Qloo candidate without inventing results.**

**The final quality check:** Compare Qloo-led discovery with an ordinary product-category search for the same initiating brand. If Qloo contributes no defensible, distinctive cultural connections, investigate the discovery strategy; don't manufacture a success story.

---

## One-sentence product description

**CrossCulture uses Qloo to discover culturally connected brands and Shopify to identify the existing products that could make a real partnership worth exploring.**

### Official references

- Shopify, **About Catalogs** (Storefront versus Global, tools, caching, images and inferred fields): https://shopify.dev/docs/agents/catalog
- Shopify, **Global Catalog MCP** (multi-merchant offers, seller IDs, filters and variants): https://shopify.dev/docs/agents/catalog/global-catalog
- Shopify, **Storefront Catalog MCP** (single-store search and product detail): https://shopify.dev/docs/agents/catalog/storefront-catalog
- Qloo, **Insights API** (entity/tag interests, returned recommendations and query-specific evidence): https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md
- Qloo, **Taste Analysis** (`urn:tag` with entity interest signals): https://github.com/qloo/docs-public/blob/main/reference/taste-analysis.md
- Qloo, **API Overview** (entity search, tags search, and Insights roles): https://github.com/qloo/docs-public/blob/main/reference/api-overview.md

**Review note (v2.2):** The Qloo examples show documented request shapes, not live test results; the candidate-specific check is an optional corroborating query rather than proof of bilateral overlap. The native path works without a successful tag-enrichment call, and a failed product pairing returns to the Qloo candidate pool. No new user inputs, providers or authentication requirements were introduced. **Cultural-gate clarification dated 18 October 2026:** native recommendation evidence and named-theme explainability are evaluated separately; Commerce Assessment v1.1 specifies the revised decision/ranking policy. The discovery and commerce architecture remain v2.2.

*The product and technical decisions above synthesize the supplied Brand × Brand 2.0 proposal, the prior commerce-assessment specification, the Codex feasibility report shared in conversation, and the linked provider documentation. No live project calls were made to verify Codex's implementation claims.*
