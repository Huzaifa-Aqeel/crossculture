# CrossCulture — Brand × Brand Commerce Assessment v1.1

**Version:** 1.1 · **Date:** 18 October 2026  
**Status:** Proposed implementable specification; **not** calibrated or validated on a live end-to-end Qloo × Shopify benchmark.  
**Authority:** New Brand × Brand decisions only (`policyVersion: brand-commerce-v1.1`). Compatible with **Brand × Brand Architecture v2.2 (cultural-gate clarification)**.  
**Scope:** Primary **Find Partners** and Secondary **Compare Two Brands**; objectives `product_bundle` and `cross_sell`. Keep Supabase authentication and editable Proposal Studio. Historical Brand × Brand and Brand × YouTube workflows and reports are retired from the final app; no compatibility path is required.

> **Decision in one sentence:** Determine whether a **specific existing-product opportunity** involving correctly identified businesses is culturally grounded and sufficiently defensible to **discuss**, then rank defensible opportunities transparently. Do not predict sales, ROI or a probability of a successful partnership.

## 0. What changed from v1.0 — and what did not

| Area | v1.1 decision |
|---|---|
| Architecture | **Retain v2.2.** No new provider or workflow. **Amended 24 Oct (user decision):** every run starts from one user-chosen starting product (Find Partners and Compare Two Brands); research without a chosen product is removed. |
| Cultural gate | Separate **verified relationship** from **specificity of its explanation**. Verified native Qloo recommendation does **not** need a shared tag. A focused/forced result's mere presence **never** counts as independent proof. |
| Mechanism | Require cited product attributes, distinct roles, specific joint-use coherence and a plausible incremental benefit; no generic LLM storytelling. |
| Ranking | Evaluate **user objective first**, then product-combination quality, cultural evidence, partner differentiation, explicit preferences, evidence coverage and stable IDs. No summed or weighted score. |
| Market and commerce | Distinguish **default market context** from **explicit delivery/availability requirements**. Missing is not contradicted. |
| Contracts | Separate proposals from validated observations and authoritative assessments; align pseudocode with output types. |
| Search | Bounded, diversity-aware Qloo → Shopify candidate research. No fixed result quota or exhaustive-catalog claim. |
| Legacy removal | New policy key `brand-commerce-v1.1`; historical Brand × Brand runs and reports are not exposed in the final app. |

**Non-goals:** Predicted commercial success, customer-overlap percentages, conversion/AOV lift, inferred margins, signed rights, wholesale eligibility, automatic checkout, generic rebranding, new-product manufacturing, or a composite `0–100` score.

---

## 1. Assessment unit and objectives

Assess an **Opportunity**: an initiating Brand A, verified prospective Brand B/counterparty, evidence trail, actual product/offer references and a particular proposed mechanism, under one user objective and market context.

- **Bundle (`product_bundle`):** At least **one specific Brand A product** and **one specific Brand B product**, with selected variants where material, and a coherent functional or occasion-based combined use. The proposed kit is **not** asserted to be a presently purchasable cross-merchant SKU.
- **Cross-Sell (`cross_sell`):** At least **one specific Brand B product** and a documented sample of Brand A's actual products/categories/use cases, ideally anchored to cited Brand A product(s); identify an **addition** or complementary function, not simply a competitor or duplicate. It does **not** grant the initiating business resale rights.

One Brand B can have several independently assessed opportunities. Display by **verified prospective counterparty**, not by the count of Shopify search hits or Universal Product IDs (UPIDs).

### Three outward outcomes

1. **`supported` — Supported Opportunity:** Verified identities and cultural relationship, evidence-backed product mechanism and objective fit, and no contradiction or unresolved mandatory commercial check. **Worth exploring**, not execution-ready.
2. **`needs_verification` — Needs Verification:** Credible lead without a verified hard conflict, but one or more required facts/relationships or essential product claims are unknown. Mark `researchLead: true` for direction-only discoveries.
3. **`unsupported` — Unsupported:** A *verified* hard contradiction invalidates the specified opportunity, such as wrong brand, wrong seller/variant, genuine product incompatibility, or a confirmed violation of an explicitly required constraint. **Not finding evidence is not a contradiction.**

A rejected *claim* does not automatically invalidate a different legitimate claim. Example: a fabricated “shared design audience” is removed; if an independently valid native recommendation and valid product pairing remain, reassess without the false explanation. If the only underlying cultural relationship was a misidentified entity, that **opportunity** is unsupported.

---

## 2. Source-of-truth and claim rules

| Source | Permitted evidence | Not proved by that source |
|---|---|---|
| **Qloo Search/Insights** | Actual resolved entity IDs; native brand recommendation returned by a **seed-anchored, unconstrained brand discovery query**; candidate-specific returned signals; actual tag/entity findings where supported. | Percent customer overlap, mutual preference, SKU-level affinity, predicted sales. |
| **Qloo context-derived Insights** | Brand recommendations arising from product-derived, verified Qloo entities/tags. | Native affinity for an initiating brand Qloo does not represent. |
| **Shopify Storefront Catalog MCP** | Observed products/offers of the **verified merchant**; attributes and selected variants actually returned. | Full assortment from limited searches, sales history, wholesale approval. |
| **Shopify Global Catalog MCP** | Products, individual **seller offers**, selected variants, appropriate price/availability/market filters. | Seller = manufacturer/brand owner, partnership consent, merged checkout. |
| **Official brand sites / verified merchant records** | Corroborated business identity, official domain and associated storefront. | Exhaustive commercial registry or product fit. |
| **Tavily / official public sources** | Selective identity research and external verification; documented historical collaborations, dated signals and material review flags. | A search result alone does not prove identity, absence of risk or controversy, contractual authorization or future impact. |
| **Qwen** | Proposed falsifiable mechanisms, extracted source-linked attributes and explanations. | Authoritative facts, raw affinity values, final verdict, invented certainty or confidence scores. |

Each material claim is an independently validated observation with stable `claimId`, precise subject, source/operation reference, observed time, basis (`qloo_result`, `merchant_authored`, `shopify_inferred`, `official_corroboration`, `llm_hypothesis`), and its applicable seller, variant, country and currency context. An LLM hypothesis **cannot** serve as factual corroboration for itself.

**Persistence scope for the MVP (amended 24 Oct):** the app records evidence at the decision level, not as a separate per-claim ledger: each saved assessment keeps its reason codes, the permitted source references (identity, cultural, external), the Qloo response IDs and the exact selected product/variant/seller references. Claim-level IDs remain a later audit enhancement.

All admissible findings use `supported | unknown | contradicted` and carry reason codes/source references. Material Qloo cultural-relationship claims must be validated from original returned Qloo data, not a Qwen paraphrase. **Two citations to copies of one provider assertion are still one source.**

For unavailable/stale data, record **unknown**, not `false`, `0`, or presumed unavailable. If there is no verified Brand A offer or assortment, do not fabricate one.

---

## 3. Cultural evaluation — two independent axes

### 3.1 Discovery provenance (where the lead came from)

`discoveryBasis` is one of:

- `qloo_native_brand`: Brand A has an unambiguous, verified Qloo `urn:entity:brand` ID and Brand B came from the **unconstrained native brand-recommendation response**.
- `qloo_category_brand` (amended 27 Oct): Brand A's verified Qloo brand ID is the **only** signal of a brand recommendation limited (`filter.tags`) to one Qloo brand category (`urn:tag:genre:brand:*`) that fits the chosen product. See §3.2 "Category recommendation".
- `qloo_context_brand`: Brand A has no usable native Qloo brand signal. Verified product/context references resolve to supported Qloo entities/tags, which drive Qloo brand recommendations.
- `shopify_qloo_guided`: Shopify search used a real Qloo-derived direction; a Shopify merchant match is **not** itself a Qloo recommendation.
- `user_specified`: User named Brand B in direct comparison; the selection does **not** establish cultural fit.

**Provenance is not a score, confidence level, or automatic ranking bonus.** Preserve the query ID, relevant parameters, exact returned candidate IDs, and what was actually found. Never mix numerical affinities from incomparable Qloo query contexts.

### 3.2 Relationship evidence — *is this candidate culturally supported?*

`culturalRelationship` is one of:

| State | Required validation | Gate behavior |
|---|---|---|
| **`native_recommendation_verified`** | Exact Brand A and Brand B IDs reconciled with real businesses; Brand B **actually appears** in the original Brand-A-anchored, **unconstrained** Qloo `urn:entity:brand` recommendation result. | **Pass** cultural relationship gate. No named tag or explainability required. |
| **`category_recommendation_verified`** (amended 27 Oct) | Brand B appears in a Brand-A-only-signal Qloo brand recommendation limited to exactly one Qloo product category chosen for the selected product. | **Pass** cultural relationship gate, labeled within that category. |
| **`direct_pair_supported`** | For `user_specified` or an independently investigated pair: candidate-specific returned Qloo association has **documented interpretable meaning beyond forced membership**, with traceable seed/candidate IDs **or** separately verified Qloo observations substantiate a meaningful candidate-specific shared cultural territory. Never claim this is an unconstrained recommendation unless one occurred. | **Pass** if the actual relationship/territory evidence is sufficiently grounded; otherwise `unknown`. |
| **`context_relationship_corroborated`** | Product-derived culturally specific source facts → valid Qloo entity/tag IDs → returned brand candidate, **plus** independent evidence linking the actual candidate/products to that specific cultural territory. | **Pass** as *context-based*, not native Brand A affinity. |
| **`direction_only`** | Qloo supplied only a seed/context/search direction; no verified connection to the particular merchant beyond search retrieval. | **Fail to `needs_verification`**, mark research lead. |
| **`unknown`** | Resolution/query evidence absent, ambiguous, unusable, or candidate-specific evidence inadequate. | **Fail to `needs_verification`** unless a separate hard contradiction exists. |
| **`contradicted`** | Claimed foundational cultural identity/relationship demonstrably misattributed to a different entity or falsified. | **`unsupported` for the invalid asserted opportunity**; a new evidenced hypothesis may be assessed separately. |

**Critical rules:**

1. **Valid native recommendation ≠ validated shared theme.** Missing explainability/tag enrichment does not erase valid, unforced Qloo discovery.
2. **`filter.results.entities={B_ID}` is a focused test, not independent discovery.** B's mere appearance, a trivially forced result, or explainability that only says which input signal was supplied is **insufficient by itself** to establish direct-pair support. Where a documented returned affinity/association is usable, explain exactly what it means *in that request context* and why the evidence is substantive. Without such evidence, require separately corroborated candidate cultural observations or mark unknown.
3. If candidate-specific queries change filters or ranking context, **do not compare their raw Qloo numbers against discovery rankings** or derive a reciprocal/average/harmonic “overlap.”
4. When a focused call is absent/empty but an original valid unforced native recommendation exists, **retain** `native_recommendation_verified`. Do not downgrade the *relationship* merely because optional corroboration failed.
5. Do not upgrade context-derived Qloo discovery or Shopify fallback to a native Brand A recommendation. For `shopify_qloo_guided`, independent candidate verification can establish a legitimately supported cultural case, but the provenance remains Shopify-guided.
6. Generic tags (“lifestyle”, “design”, “coffee”) or common category keywords alone do not constitute meaningful candidate cultural corroboration; the cultural context must be specific and relevant to the actual opportunity.

**Secondary direct comparison:** `user_specified` starts with no discovery proof. A focused Qloo filter **alone** is not a pass. Separately evidenced associations of both verified brands with a meaningful cultural territory, or a materially interpretable candidate-specific association, may establish `direct_pair_supported`; **two associations are not proof of shared customers or reciprocal preference**. Otherwise retain `unknown` and show the product opportunity as Needs Verification; a missing result is not evidence of incompatibility.

**Category recommendation (amended 27 Oct):** the brand-only list is the same for every product of Brand A, so a product whose complements sit outside it (a coffee maker for a cookware brand) found no partner. Discovery therefore also asks Qloo, with Brand A as the only signal, for brands inside at most two Qloo brand categories chosen for the selected product from a closed list of product categories (the model picks; only real Qloo category tags are accepted). Brand B passes as **`category_recommendation_verified`** only when it appears in that response, Qloo's explainability shows Brand A as the request's only input signal, and the request was limited to exactly that one category. The category is a product filter, not cultural evidence (rule 6 still holds); the cultural relationship is Qloo's Brand-A-anchored ranking inside it. It is shown as "Among {category} brands, people who like A tend to like B", never as the unconstrained recommendation, and its affinities are not compared with the brand-only list. A partner in both lists keeps the brand-only proof. Both lists are researched as one queue ordered by the product-fit hint, with the same time and Catalog budget.

**Native check for a user-chosen partner (amended 24 Oct):** if the chosen partner appears in Brand A's own unconstrained brand recommendation, read up to the provider maximum of 20 results, the relationship is `native_recommendation_verified`. This is the same proof as discovery, read deeper; it is not a forced or filtered result.

**Reverse check for a user-chosen partner (amended 24 Oct):** if Brand A appears in the chosen partner's own unconstrained brand recommendation (top 20), and Qloo's returned explainability shows the partner as that request's only input signal, the pair is `direct_pair_supported`: a candidate-specific association Qloo actually returned, not forced membership. It is labeled as a recommendation from the partner's cultural profile, never as Brand A native discovery or shared customers, and carries `no_named_theme`.

**Current reproducible direct-pair rule:** Require a returned finite-affinity result for Brand B in the focused Qloo query, the same specific non-generic Qloo tag ID in both brands' tag responses, and inspected first-party pages for both verified official domains that explicitly describe that named theme. The result supports only two documented associations with that theme. A forced result, an arbitrary count of broad tags, or an uninspected page cannot pass. Pairs without this proof remain Needs Verification even if their products fit.

### 3.3 Explanation specificity — *what can we responsibly say?*

`culturalExplanation` is **separate** from the relationship state:

| Value | Allowed display |
|---|---|
| `specific_theme` | A named, substantive cultural association backed by actual returned Qloo findings and relevant corroboration. Cite the observations and qualify what they show. |
| `broad_theme` | A broad **but meaningful** culturally grounded territory, clearly labeled broad. |
| `no_named_theme` | Only accurately describe the verified **recommendation/association** without alleging a shared theme. |

A `native_recommendation_verified` relationship can coexist with `no_named_theme` and still pass the cultural gate. For a context-based case whose validation depends on a named cultural territory, do not assign `no_named_theme` as a substitute for missing necessary corroboration. **No level of explanation establishes customer overlap, willingness or sales lift.**

Optional post-shortlist cultural audience research may show that two verified brands have the same specific Qloo taste tag, and may show separately observed positive aggregate demographic affinities when investigated for that pair. Those observations can improve the customer's explanation but **do not revise this assessment, create a new mandatory gate, or add a ranking criterion**. A demographic resemblance alone does not establish a named cultural theme or shared customers.

**Shared audience appeal (amended 26 Oct):** near-universal Qloo tags say nothing about a pair. Shared music, film and dining genres are not shown: across 11 brands in five categories the shared ones were carried by 9–11 of them (folk music by 12 of 16 in an earlier check; rhythm & blues, popularity 0.98, by all 11), so Qloo popularity does not separate them. Audience tags are pair-specific (most shared ones were carried by only the two brands), and a tag whose Qloo popularity is 0.9995 or higher, or has none, is still excluded. Each brand's lifestyle and audience tags (lifestyle, customer identity, customer segment, influencer appeal) are requested separately. The claim is brand level, since Qloo describes brands, not products: a tag is shown as "Both brands resonate with …" (people tags) or "associated with …" (lifestyle tags) when both brands carry it, it is below that popularity, and it is in the top half of each brand's list, so it is core to both. Up to two are shown, ordered by the weaker of the two positions; one the selected products' own text mentions goes first, but product text never hides a tag. Products are never sent to Qloo, so they cannot create a tag. A segment naming children (toddlers, infants) means their parents and is never presented as the audience. This is explanation only, as above.

**Examples of acceptable UI copy** (illustrative, not live evidence):

- Native, theme absent: **“Qloo recommended Brand B using Brand A as its brand signal. No specific shared theme was verified.”**
- Context-based: **“Brand B was recommended using verified cultural references from Brand A's observed products; this is not native Brand A affinity.”**
- Direction-only: **“Qloo informed this product search. The specific Brand B cultural relationship remains unverified.”**
- User direct pair: **“This pair was selected by the user; the filtered result alone does not independently establish a cultural relationship.”**

---

## 4. Product mechanism validation — prevent plausible-sounding nonsense

The **LLM proposes** a short product hypothesis. The **server verifies** evidence and applies a documented qualitative rubric. A coherent narrative is *not* evidence of compatibility or customer demand.

### Mechanism families

- `functional_complement`: Product B directly helps use, prepare, store, protect, maintain or extend Product A (or vice versa); check any material technical/size/ingredient compatibility.
- `occasion_complement`: Both products have **distinct** roles in a **named and specific** plausible gift, kit or real use occasion. An unbounded “lifestyle” or “morning routine” narrative is insufficient by itself.
- `assortment_complement`: Cross-Sell only. The partner product contributes a meaningful function, use case or independently supported cultural niche relative to the **observed** Brand A assortment.
- `duplicate_or_substitute`: Primarily alternatives; normally cannot support Bundle or Cross-Sell without a **specific** user-approved variety-bundle mechanism.
- `incompatible`: Reliable product facts conflict with the proposed mechanism, selected variants or applicable safety requirements.
- `unproven`: Generic story or insufficient product evidence.

### Three required checks

| Check | `supported` requires | `unknown` examples | `contradicted` requires |
|---|---|---|---|
| **`attributeEvidence`** | Real, source-linked attributes sufficient to support each product's relevant role; where material, exact variant. | Missing material, size, usage, ingredients or unreliable inferred attribute. | Verified description/variant materially conflicts with the asserted attribute. |
| **`jointUseCoherence`** | Named functional operation, specific shared occasion, or meaningful assortment contribution; distinct roles in this objective. | Vague co-design story or invented occasion. | Verified technical/use conflict makes proposed joint use impossible or inappropriate. |
| **`incrementalValue`** | Articulate a specific **practical or experiential benefit** from offering the items together/recommending the partner item, beyond merely placing two unrelated listings together. It is a *defensible hypothesis*, not sales evidence. | “Both are lifestyle products” / “customers will love this” without concrete benefit. | Verified facts show the claimed increment is impossible for this proposal (not merely unattractive). |

`productCompatibility` is `supported` **only when all three required checks are supported** and no material counterevidence exists; `contradicted` only with an actual hard factual conflict; otherwise `unknown`.

Ordinary co-presence is not incremental value: two items merely worn, carried or displayed together remain `unknown` without a distinct joint benefit. Category-level complements can pass when cited functions solve different parts of one concrete task; they need not be unique within their categories. Item-specific details are required for the higher `distinct_concrete_joint_value` label.

**Implementation rule:** A closed table of product types or pairs cannot decide eligibility. Retrieval queries may be bounded hints; any selected products may be investigated. Qwen may propose a mechanism from transient selected-product facts, but its proposal is not evidence. The server validates cited passages against exact selected details, distinct roles and claim limits. A passage appearing on a product page may describe the brand's wider catalog; it does not establish that the **selected item** has that other product's role. Verify each proposed role against the selected item itself before accepting the joint use. The isolated rubric then judges whether those facts support a specific joint use and incremental benefit. Exact occasion-word overlap is useful evidence for a higher quality label, not a universal eligibility requirement: a defensible occasion can follow from two different sourced product roles. A generic story or model-invented product attribute remains `needs_verification`; it is not an `unsupported` product category. Treat descriptions from Global Catalog as potentially inferred unless their merchant-authored basis is established; they cannot alone earn stronger product or partner-specific labels. An explicit merchant-authored statement that the selected products are incompatible can establish a contradiction when it names the exact counterparty product; broad warnings remain unresolved.

**Implemented Bundle links (amended 24 Oct, from live false positives):** without a direct function (one item prepares, uses, holds, attaches to, protects or maintains the other), a Bundle needs both items to handle the same thing in the task (pasta cooked in the pan and served in the bowl) or both items' own text to name the same activity, verified against the page text. A shared meal, party, room or outing is not enough. Two apparel or personal-accessory items need a direct function; they remain eligible as Cross-Sell. When one item is a care or treatment product for the other, its trusted text must name the other item's type or material, and a restrictive care instruction on either page (dry clean only, professional cleaning only, do not use…) requires an exact merchant-authored compatibility statement. A fit claim is confirmed when a trusted page names the other item's type or exact title. These rules are stricter than a bare "defensible occasion"; they trade some recall (for example a picnic blanket and a cooler, or a camp chair and a blanket) for fewer invented occasion stories. **Separate users (amended 27 Oct):** two items that serve different people, pets or things are not a Bundle unless one acts on the other, even when both pages name the same activity (a blanket for you and a first-aid kit for your dog, both "for camping"). On the labelled benchmark this changed no good or bad result on the original 72 pairs and rejected the real dog-kit pair in 3 of 3 runs. **Format mismatch (amended 27 Oct):** a partner item that only works with a format, machine, size or system the starting item's text does not show it uses (pods or capsules, a cartridge, a filter, part or refill for one model), or that needs nothing the starting item does (instant coffee for a coffee maker), is not a Bundle or Cross-Sell, whatever the verdict (live: coffee pods and instant sticks for a 10-cup drip coffee maker). Because the judge's answer varied between runs, the server also rejects a partner title naming pods, capsules, K-Cups, cartridges, refills or an instant drink unless the starting item's own text names that format (not as "no pods"). **Competitor brands (amended 27 Oct):** a discovered partner whose observed broad sample (at least 8 items) is a quarter or more in the starting product's category range is a competitor for that product and is not researched for it (Great Jones cookware for a Caraway pan); a few such items in a wider range do not count, and a user-chosen partner is never dropped.

**Wearer (amended 25 Oct, user decision):** when the starting product is made for men or for women (its own address, title, tags or collections say so; when it carries no label, its brand's agreeing Qloo description and homepage; a unisex label means no wearer constraint), a partner product a person wears or carries — Shopify taxonomy Clothing (`aa-1`), Clothing Accessories (`aa-2`), Handbag & Wallet Accessories (`aa-4`), Handbags, Wallets & Cases (`aa-5`), Jewelry (`aa-6`) or Shoes (`aa-8`) — must be confirmed for the same wearer or labelled unisex. Its wearer comes from its own labels, else from the partner brand (Qloo description and the brand's own homepage title/description, used only when they agree). A different wearer or an unconfirmed one removes the product before assessment; it is never shown, not even as Needs Verification. A product's own label outranks the brand's. Other categories and starting products with no stated wearer are unaffected.

**Fit sizes in a Bundle (amended 25 Oct, user decision):** a two-brand Bundle never contains an item sold in fit sizes: a worn or carried item (categories above) whose size option offers two or more sizes other than one size. Such products are not offered as a Bundle starting product, and such partner items are removed from Bundle research. Cross-Sell is unaffected. One-size items and size options outside worn categories (a pan's diameter, a candle's volume) do not count.

**Cross-Sell and the starting brand's own range (amended 25 Oct):** a Cross-Sell partner item in a category the starting brand already sells competes with that brand's own range and is removed before assessment. The check searches the starting store once per partner category name (Shopify taxonomy) and compares categories by their first three levels; everyday bags in the Handbags and Luggage & Bags branches count as one kind. Observing such a product is enough; a search that finds none is not a claim that the category is absent, and the pair is simply assessed. Bundles are unaffected.

**Semantic verification boundary:** Source matching, selected-variant identity, distinct-role text, and disallowed unsupported claims are deterministic checks. A second, separately prompted structured Qwen classification may judge whether the already checked short passages and proposed roles describe a coherent joint use, incremental benefit and distinctive value. It is a necessary rubric check, not independent factual evidence or permission to set the outcome. If it fails or is unavailable, the product gate remains unknown. The server retains the source and hard-constraint veto. Zero temperature does not guarantee identical judgments; assess stability against labeled fixtures and keep ambiguous cases for review.

A useful **occasion** can equal or outperform a **functional** bundle in ranking; the mechanism category alone must never determine quality.

#### Objective-specific examples (hypothetical)

- **Coffee + compatible brewer:** Functional relationship; the brewer prepares the actual coffee. Can pass with real details and no contradictory variant/market requirement.
- **Tea + suitable cup for a named tea-gifting kit:** Occasion or functional relationship; specify both items' roles. Can pass without a prior collaboration.
- **Candle + guided reflection journal:** Potentially credible *specific evening-reflection kit* if both products' roles are evidenced. The occasion is a hypothesis, not proof of demand.
- **Socks + coffee = “morning lifestyle”:** Usually `unknown`/unproven joint value, **not a factual hard contradiction**.
- **Bag + rug = “shared design lovers”:** Generic design association alone is not enough; a real named occasion and distinct roles are needed, otherwise `unknown`.

### Scope limits

For `cross_sell`, record what products/categories were **actually reviewed** and any relevant cited anchors. Say “not observed in the reviewed assortment”; do not say “Brand A does not sell this category” unless an independently legitimate exhaustive source supports it. Do not require fabricated SKU counts or pretend an unverified collection is comprehensive.

For a Supported Cross-Sell, `AssortmentScope.coverage` must be `partial` or `adequate_for_claim`, the reviewed Brand A anchor must have at least one verified selected-product claim reference, and the rationale must not assert exhaustive category absence from a partial search. `unknown` coverage, a missing anchor, or an unsupported absence claim leaves objective fit unknown. Partial coverage may pass when the claim is expressly limited to the reviewed assortment.

**Do not score subjective resonance with an LLM 0–10, 0–100, confidence percentage or embedding similarity threshold.** The bounded human-interpretable mechanism judgment is explicit; it can be measured later against human labels.

---

## 5. Identity, objective and commercial gates

### 5.1 Always check identity

- Resolve the **real initiating brand**, Qloo entity (when available), official domain, verified Shopify merchant, product brand/manufacturer and **selected seller** separately.
- Use Tavily selectively when external identity research is needed, then corroborate the result against official brand sites and verified merchant records. A search result alone is not identity proof.
- Confirm the **prospective counterparty's role** (brand owner, merchant or other documented commercial party). An unrelated multi-brand reseller is not silently Brand B.
- Confirm individual selected product/offers and **requested** variants; never accept relaxed substitutions as an exact option.
- Wrong/misattributed entity or offer is `contradicted`. An ambiguous **required** counterparty or seller association is `unknown`, **not** proof that the brand is fraudulent or unsuitable. A verified merchant may offer a third-party manufacturer's product when the opportunity accurately names the merchant as the counterparty and supplier. Manufacturer/brand ownership need not equal seller identity; an unverified maker blocks Supported only when the proposal calls the item Brand B's own product, the user requires that maker, or ownership is material to the proposed mechanism or rights claim. Never silently describe a reseller's item as made by the prospective partner.
- An explicit co-brand in a selected offer's title is a cue to distinguish the verified seller from the named other brand. Keep the seller's offer eligible for an exploratory opportunity when its role is described accurately; expose maker and campaign-rights questions. If the proposed mechanism says the seller made, owns, or designed that product without proof, the material identity check is `unknown` until verified.
- Verify Shopify shop IDs before applying Global Catalog shop filters. Check URL/DNS and prohibit private/internal-network server fetches.

### 5.2 Bundle objective

Required for Supported:

1. Distinct verified counterparties appropriate to the proposed deal.
2. At least one observed identifiable **seed** offer and one **partner** offer, from accurately described merchants/brands.
3. Supported `functional_complement` or `occasion_complement` (or tightly defined user-requested variety mechanism).
4. Material variant compatibility, cultural relationship support and applicable hard constraints.

No requirement for an existing joint SKU, agreed discount, signed co-branding rights, stock quantities, wholesale contract, same-cart shipping or predicted margin. List them under `dealUnknowns`.

If comparable selected prices are actually available in the **same currency, market, quantities and units**, the UI *may* calculate a **sum of separate list prices**; explicitly label that sum **not** a negotiated bundle price. Otherwise show separate prices. Do not silently convert currencies or infer taxes/shipping.

### 5.3 Cross-Sell objective

Required for Supported:

1. Verified Brand A storefront **and honest observed assortment scope** (at least a relevant reviewed group/anchor, not an assertion of full inventory).
2. Specific verified partner offer and accurately described prospective counterparty.
3. Supported `assortment_complement`: distinct function/use case/culturally evidenced niche relative to the **reviewed** seed assortment; no unsupported claim of total category absence.
4. Cultural relationship support and applicable hard constraints.

An assortment contribution can be specific without a physical joint-use occasion. Validate the cited seed anchor, distinct partner function and incremental Cross-Sell rationale; do not demand an occasion phrase that appears in both product descriptions.

No requirement for resale permission, Shopify Collective enrollment, affiliate integration, supplier agreement or already listing Brand B's item. Those remain possible **negotiation routes**, not established facts.

### 5.4 Context is not a hard user requirement

The app pre-fills **US market context**. It helps scope prices/search results. **That pre-fill alone does not mandate verified delivery to every US address.**

Keep separately:

- `marketContext`: locale/country and preferred display currency for searching/interpreting offers.
- `hardConstraints`: only requirements explicitly selected or expressed by the user, including `mustShipToMarket`, `mustBeAvailableNow`, price ceiling/range, selected size/variant, and material requirements. If the UI offers a specific toggle, its affirmative setting can be a hard constraint.
- `softPreferences`: optional preferred materials, product roles, aesthetic fit or price positioning. Unspecified preferences are **neutral**, not negative.

| Field | Mandatory for Supported when | `unknown` | `contradicted` |
|---|---|---|---|
| Counterparty and offer identity | **Always** | Required counterparty/seller association missing; manufacturer unknown when an ownership or maker claim matters | Verified wrong namesake, seller attribution, unrelated product or false maker claim |
| Product attributes and selected variants | Material to the proposed mechanism or requested option | Required variant/attribute unavailable or returned only as unverified inference | Verified product/option incompatible or wrong substituted variant |
| Listed price | A price is asserted in UI or an explicit price constraint must be evaluated | Price missing, wrong context, different currency/quantity without valid comparison | **Explicit hard price limit** violated with comparable observed offer facts |
| Availability | User explicitly requires currently sale-ready products | Missing/stale/unspecified selected-variant status | Explicitly unavailable selected offer under a hard-now condition |
| Shipping/destination | User explicitly requires shipment to a specified market/address | Partial or absent support for chosen seller/variant | Explicit ineligibility for the required market/selection |
| Material/regulatory/rights condition | Facts or explicit user's required use make it essential | Requires additional factual/legal check | Verified prohibited or incompatible use for proposed offer |

**Price nuance:** The ability to render a product card without an observed price does not automatically make the underlying opportunity `needs_verification` when there is no price constraint. Display “Current price not verified” instead of a number. **Whenever a current price is actually shown, its amount/currency/market/variant must be verified.** If price is essential to the claimed mechanism or user constraint, missing price is a mandatory unknown.

Global Catalog `available` / `ships_to` can provide selected query-time clues; do not turn them into stock counts, assured address-level delivery, or joint fulfillment. Storefront capabilities vary. Explicitly re-check requested and returned variant IDs after a `get_product` lookup that may relax option preferences.

`commercialState` is separately `offer_ready_to_evaluate | offer_needs_check | offer_blocked` relative to **actual user hard constraints**, not to hypothetical deal terms.

### 5.5 Negotiation unknowns are not assessment blockers

Keep distinct `dealUnknowns`: partner willingness, resale/wholesale/licensing rights, profit margin, negotiated price, exclusivity, campaign economics, co-packing, inventory commitments, and cross-merchant fulfillment. These matters must **never** be asserted as established from Qloo or public Shopify catalogs. They do **not automatically** force `needs_verification` for a good exploratory opportunity.

---

## 6. Decision policy — auditable and non-numeric

### Gate precedence

1. Reject **verified hard contradictions** involving the true proposed parties/products, material compatibility, supported relationship assertion, or applicable explicit requirements → `unsupported`.
2. If any **required** relationship/identity/product/objective/explicit-constraint proof remains unknown → `needs_verification`.
3. Otherwise → `supported`.

**Nuance:** A weak cultural *description* is removable without rejecting an otherwise valid native relationship; a wrong foundational Qloo entity or falsified entire discovery claim is a hard conflict. Missing research is usually unknown, not unsupported. Do not upgrade any unsupported evidence by changing LLM wording.

```ts
// Policy pseudocode. All validate* functions operate ONLY on trusted,
// normalized server-side evidence, never on the client's asserted scores.
function assessCommerce(x: ValidatedCommerceEvidence): CommerceAssessment {
  const identity = evaluateIdentity(x);
  const culture = evaluateCulture(x);       // relationship + explanation separately
  const mechanism = evaluateMechanism(x);   // attributes + joint use + increment
  const objectiveFit = evaluateObjective(x);
  const commercial = evaluateHardConstraints(x);
  const reasonCodes = collectReasonCodes(identity, culture, mechanism, objectiveFit, commercial);
  const required = [identity, culture.gate, mechanism.gate, objectiveFit, ...commercial.requiredChecks];

  const status: CommerceStatus = required.some(c => c.state === 'contradicted')
    ? 'unsupported'
    : required.some(c => c.state === 'unknown')
      ? 'needs_verification'
      : 'supported';

  return {
    policyVersion: 'brand-commerce-v1.1',
    status,
    discoveryBasis: x.discoveryBasis,
    researchLead: culture.relationship === 'direction_only',
    culturalRelationship: culture.relationship,
    culturalExplanation: culture.explanation,
    identity,
    culturalGate: culture.gate,
    productMechanism: mechanism,
    objectiveFit,
    commercialChecks: commercial.checks,
    commercialState: commercial.state,
    evidenceCoverage: calculateCoverage(x),
    rankingFeatures: status === 'supported' ? deriveRankingFeatures(x, culture, mechanism, objectiveFit) : null,
    assortmentScope: x.assortmentScope ? retainPermittedAssortmentScope(x.assortmentScope) : null,
    reasonCodes,
    materialUnknowns: collectUnknowns(identity, culture.gate, mechanism.gate, objectiveFit, commercial.requiredChecks),
    dealUnknowns: describeDealUnknowns(x),
    reviewFlags: x.reviewFlags,
    evidenceRefs: x.permittedEvidenceRefs,
    evaluatedAt: x.evaluatedAt,
  };
}
```

`evaluateCulture().gate` returns `supported` for `native_recommendation_verified`, `direct_pair_supported`, or `context_relationship_corroborated`; `unknown` for `direction_only` or `unknown`; `contradicted` for foundational relationship misattribution. Explanation specificity **never** changes a valid native gate to unknown.

`evaluateMechanism().gate` aggregates the three required product checks; its factual evidence must be traceable. The LLM is never allowed to set `status`.

---

## 7. Ranking: transparent, contextual, reproducible

**First partition by status:** Supported → Needs Verification (visibly mark research leads) → Unsupported (do not promote). **Only** rank Supported opportunities produced under the **same initiating brand, objective, relevant user requirements, and scorer policy**.

### Lexicographic order among Supported

Compare criteria *in order*, stopping at the first meaningful difference. **No arithmetic sum, raw affinity blending or generated probability.**

| Priority | Rank criterion | Allowed interpretation |
|---|---|---|
| **1. Objective suitability** | `matches_explicit_focus` > `clearly_serves_objective` > `adequately_serves_objective` | Respect the user's selected hero product, explicit gifting/use purpose or described cross-sell contribution. Where no extra focus was stated, **do not invent one**; compare product-specific suitability to Bundle/Cross-Sell. |
| **2a. Product link (amended 27 Oct)** | `direct` > `same_thing` = `added_need` > `shared_activity` | From the judgment: the partner item acts on the starting item (a bag that carries the blanket, coffee for the brewer), both handle one specific thing (vegetables chopped on the board, then cooked in the pot), or they only share a named activity (a headlamp for the same camping trip). Live runs ranked a headlamp beside a carryall for a blanket; a buyer reads the direct pair as the stronger offer. This replaces the earlier "do not automatically prefer functional over occasion" for Bundles; it orders Supported results only and never changes a verdict. In partner discovery (not direct comparison), a pair linked only by a shared activity is not shown (user decision 27 Oct); the judge also checks that the partner item does its own kind of job in the pair (`partnerUseStated`: not a belt "securing" a T-shirt). |
| **2. Product-combination quality** | `distinct_concrete_joint_value` > `credible_joint_value` | Does the supported product mechanism establish particularly clear joint roles and incremental utility? |
| **3. Cultural explanation specificity** | `specific_theme` > `broad_theme` > `no_named_theme` | A valid native recommendation **without a theme remains Supported**; this tie-break rewards a better evidenced *explanation*, not a fictitious larger affinity. |
| **4. Partner differentiation** | `evidenced_partner_specific_reason` > `generic_category_reason` | Evidence-backed reason **this particular brand** is interesting beyond “any merchant selling product category X.” Ranking aid only; not a gate. |
| **5. Explicit soft preferences** | More clearly satisfied **verified** preferences first; unspecified preferences neutral | Compare `verifiedMatchedPreferencesCount`, derived only from user-provided preferences matched to trusted selected-product text. Record `unresolvedPreferencesCount` without using it as a negative sort key. Never sort by rationale-array length. |
| **6. Relevant evidence quality** | Better coverage/currentness of **material** observations | Prefer fresh selected-offer facts and fewer consequential unknowns; do not reward redundant pages, sheer citation count or catalog size. |
| **7. Stable tie-break** | Normalized verified counterparty ID, then canonical product/variant/offer IDs | Stable order under pagination/retrieval shuffling. These IDs are for internal sorting only where permitted. |

Each feature must be produced by an explicit **reason-coded rubric**, not generated as a free-form high-confidence label. For priority 1, `matches_explicit_focus` applies **only** to a user-entered or user-selected focus; it may not be awarded because the model imagines a goal. A sufficiently supported mechanism can still rank below one with clearer roles without being reclassified Unsupported.

Do not assign `credible_joint_value` and `generic_category_reason` to every Supported opportunity as permanent defaults. They are conservative labels when the higher conditions below are unproved; award the higher labels only from validated selected-product or partner-specific evidence. A model-supplied ranking label has no authority.

Award labels from the **same validated evidence packet**, using these minimum rules:

- `matches_explicit_focus`: the selected exact product or documented purpose appears in the opportunity, and the cited mechanism specifically serves it. `clearly_serves_objective`: both product roles (Bundle) or the observed assortment contribution (Cross-Sell) are concrete and direct, but no explicit focus match is established. `adequately_serves_objective`: the objective gate passes, while the contribution is less direct. An absent user focus cannot earn the first label.
- `distinct_concrete_joint_value`: cited product attributes establish distinct roles and a specific incremental use or occasion beyond the minimum passing mechanism. `credible_joint_value`: all mechanism gates pass but no further distinctive joint value is evidenced. A pleasant description or mechanism-family name does not upgrade quality.
- `specific_theme`: a named substantive theme is supported by actual Qloo findings and relevant candidate/product corroboration. `broad_theme`: meaningful Qloo-backed territory is evidenced but a narrower shared theme is not. `no_named_theme`: the cultural relationship is valid, while no defensible theme was established.
- `evidenced_partner_specific_reason`: a cited fact about this verified partner materially explains the choice beyond its product category. `generic_category_reason`: only the category-level reason is verified. A merchant's number of listings and the number of repeated citations do not qualify.
- `good` coverage: all facts material to this opportunity's status and ranking were checked for the selected seller/variant and applicable market in the current assessment; `limited`: the required gates pass but a nonessential material detail remains unverified or dated; `poor`: only the minimum passing proof is present. Coverage never overrides an unknown **required** gate or awards extra credit for search volume.

**Coverage is about material evidence**, not extra searches. Display the ranking rationale (“Fits selected hero product; concrete joint use; verified named cultural context”) instead of an opaque percent.

### Avoid domination by merchant/catalog volume

1. Canonicalize duplicates/UPIDs/variant-level repeats; treat distinct merchant offers separately when merchant identity matters.
2. Group by verified Brand B, **show the best distinct opportunity** per partner and expand secondary combinations.
3. Prefer useful diversity in the shortlist (function/use occasion/partner category) without secretly altering Qloo evidence or pretending categories are independent cultural scores.
4. Do not compare a ranked Supported bundle against a Needs Verification cross-sell as if the numbers were interchangeable.
5. Needs Verification is a **research queue**, optionally ordered by most actionable missing proof, not a second disguised “Top Matches” leaderboard.

---

## 8. Candidate exploration policy (part of the discovery worker, not the scorer)

The scoring engine evaluates **what gets researched**. The worker must prevent early Qloo candidates or merchants with huge catalogs from consuming the entire evaluation budget.

1. Anchor one **unconstrained** native Qloo discovery request to verified Brand A; preserve returned order/parameters. Tag enrichment is optional and cannot block this path.
2. Cheap triage first: verify candidates and real official shops, note plausible complementary product families and whether reliable Catalog MCP access exists. Discard wrong namesakes; mark unreachable catalogs as **coverage limitations**, not cultural failures.
3. Select **a bounded, varied candidate set** from this response. Prefer credible early leads while also reserving exploration for different useful product roles/occasions; do **not** reorder using raw scores from different Qloo queries.
4. For each candidate, investigate a small number of **specific, source-grounded** product hypotheses. If one fails, try another genuinely different product/variant **only if it could change the outcome**, then move on.
5. Observe actual Brand A assortment/product scope before claiming cross-sell gaps. Re-query **selected** Shopify offers for current facts; Storefront-first for verified merchants and Global where justified.
6. Stop at the configured **API/time/cost research budget**, diminishing genuinely new opportunity value, or exhaustion of evidence. Never manufacture a target number of results.
7. If using Qloo-guided Shopify discovery fallback, preserve `shopify_qloo_guided` provenance. Fallback search hits start as **research leads** until independent cultural validation passes.
8. Keep reviewable in-run **exploration metadata**: query scope, identities checked, attempted candidates, hypothesis count, stop reason, and observed assortment breadth. Never claim an exhaustive search. Respect all provider data rules before persisting any such metadata.

For the hackathon, make the bounded cap a **configuration** rather than a hidden ranking factor. This design does **not** require new provider integrations or user inputs. The first end-to-end acceptance milestone remains a **native-Qloo Product Bundle**.

---

## 9. Typed data contract — proposals are not verdicts

Types below are **conceptual TypeScript interfaces**. Align them to the repository's actual Zod schemas. Types for inputs and outputs are intentionally separated; a client or LLM may only propose a mechanism, not approve an assessment.

```ts
type PolicyVersion = 'brand-commerce-v1.1';
type CommerceObjective = 'product_bundle' | 'cross_sell';
type DiscoveryBasis =
  | 'qloo_native_brand' | 'qloo_context_brand'
  | 'shopify_qloo_guided' | 'user_specified';
type Support = 'supported' | 'unknown' | 'contradicted';
type CommerceStatus = 'supported' | 'needs_verification' | 'unsupported';

type CulturalRelationship =
  | 'native_recommendation_verified' | 'direct_pair_supported'
  | 'context_relationship_corroborated' | 'direction_only'
  | 'unknown' | 'contradicted';
type CulturalExplanation = 'specific_theme' | 'broad_theme' | 'no_named_theme';
type MechanismKind =
  | 'functional_complement' | 'occasion_complement'
  | 'assortment_complement' | 'duplicate_or_substitute'
  | 'incompatible' | 'unproven';
type CommercialState = 'offer_ready_to_evaluate' | 'offer_needs_check' | 'offer_blocked';
type EvidenceCoverage = 'good' | 'limited' | 'poor';

type CitedCheck = {
  state: Support;
  reasonCodes: string[];
  sourceRefs: string[];   // references permitted by applicable provider policy
  missingFacts: string[];
};

type MarketContext = { countryCode: string; currencyCode?: string };
type UserRequirements = {
  hard: {
    mustShipToMarket: boolean;
    mustBeAvailableNow: boolean;
    priceLimit?: { amountMinor: number; currencyCode: string; basis: string };
    requiredVariantAttributes?: Record<string, string>;
    otherExplicitRequirements?: string[];
  };
  soft: string[];          // only user-provided; absence is neutral
  selectedHeroProductRef?: string;
  explicitPurpose?: string;
};

type ProposedOpportunity = {
  objective: CommerceObjective;
  seedBrandInput: string;
  partnerBrandInput?: string;        // omitted for native find-partners flow
  proposedMechanism: MechanismKind;
  proposedRationale: string;         // hypothesis, NEVER a verified fact
  proposedProductRefs: string[];
  sourceClaimIds: string[];          // references to facts to be verified
};

type VerifiedClaim = {
  claimId: string;
  subjectRef: string;
  predicate: string;
  value: unknown;
  basis: 'qloo_result' | 'merchant_authored' | 'shopify_inferred'
    | 'official_corroboration';
  sourceRef: string;
  observedAt: string;
  sellerRef?: string;
  variantRef?: string;
  marketCountry?: string;
  currencyCode?: string;
  verification: CitedCheck;
};

type LiveOfferRef = {
  provider: 'shopify_global' | 'shopify_storefront';
  productId: string;
  variantId?: string;
  sellerId?: string;
  shopId?: string;
  sellerDomain?: string;
  // TRANSIENT research reference; persist only after rights review.
};

type AssortmentScope = {
  observedFamilies: string[];       // descriptive coverage only, not proof of absence
  inspectedQueries?: string[];       // app-authored query scope, never catalog result copies
  anchorClaimRefs: string[];
  coverage: 'adequate_for_claim' | 'partial' | 'unknown';
  observedAt?: string;
  limitationNotes: string[];
};

type ValidatedCommerceEvidence = {
  objective: CommerceObjective;
  discoveryBasis: DiscoveryBasis;
  seedBrandRef: string;
  partnerBrandRef: string;
  prospectiveCounterpartyRole: string;  // verified seller / brand owner / other
  seedOfferRefs: LiveOfferRef[];
  partnerOfferRefs: LiveOfferRef[];
  assortmentScope?: AssortmentScope;
  qlooQueryRefs: string[];            // includes original discovery evidence where applicable
  verifiedClaims: VerifiedClaim[];   // transient + permitted validated references
  proposedMechanism: MechanismKind;
  marketContext: MarketContext;
  userRequirements: UserRequirements;
  permittedEvidenceRefs: string[];  // ONLY safe durable refs/claims by provider policy
  reviewFlags: string[];
  evaluatedAt: string;
};

type ProductMechanismAssessment = {
  kind: MechanismKind;
  attributeEvidence: CitedCheck;
  jointUseCoherence: CitedCheck;
  incrementalValue: CitedCheck;
  gate: CitedCheck;
  roles: { seedRole: string; partnerRole: string };
  boundedRationale: string;
};

type RankingFeatures = {
  objectiveSuitability: 'matches_explicit_focus' | 'clearly_serves_objective' | 'adequately_serves_objective';
  productQuality: 'distinct_concrete_joint_value' | 'credible_joint_value';
  culturalExplanation: CulturalExplanation;
  partnerDifferentiation: 'evidenced_partner_specific_reason' | 'generic_category_reason';
  preferenceRationale: string[];      // computed ONLY from user-provided preferences
  verifiedMatchedPreferencesCount: number;
  unresolvedPreferencesCount: number; // informational, neutral in the comparator
  materialEvidenceCoverage: EvidenceCoverage;
  stablePartnerKey: string;
  stableOfferKey: string;
  reasonCodes: string[];
};

type CommerceAssessment = {
  policyVersion: PolicyVersion;
  status: CommerceStatus;
  discoveryBasis: DiscoveryBasis;
  researchLead: boolean;
  culturalRelationship: CulturalRelationship;
  culturalExplanation: CulturalExplanation;
  identity: CitedCheck;
  culturalGate: CitedCheck;
  productMechanism: ProductMechanismAssessment;
  objectiveFit: CitedCheck;
  commercialChecks: Record<string, CitedCheck>;
  commercialState: CommercialState;
  evidenceCoverage: EvidenceCoverage;
  rankingFeatures: RankingFeatures | null;
  assortmentScope: AssortmentScope | null;
  reasonCodes: string[];
  materialUnknowns: string[];
  dealUnknowns: string[];
  reviewFlags: string[];
  evidenceRefs: string[];
  evaluatedAt: string;
};
```

**Contract invariant:** `ValidatedCommerceEvidence` is constructed **server-side** by checking response provenance, actual source data, seller/variant identity and allowed claims. It does **not** accept user-/LLM-provided `culturalRelationship`, `productCompatibility`, or `rankingFeatures`. Those are derived by the scoring authority. `CommerceAssessment` fields must match the actual return shape above; do not retain the mismatched v1.0 `facts`/`reasons` output shape.

**Implementation detail for ranking:** Map enum values to fixed order values **per criterion** internally, then lexicographically compare the criteria. These are *ordinal* comparators, not a fabricated summed score. For soft preferences, compare only verified user-provided requirements under a documented deterministic rule (e.g. matched explicit preferences, then unresolved ones); avoid claiming preference-count differences measure consumer preference intensity. For ties, sort stable keys. If evidence cannot justify a high ranking label, choose the lowest supported label or leave the case Needs Verification where a required gate remains unknown.

---

## 10. Evidence lifecycle, security and persistence

**Shopify's Catalog terms:** **Do not cache Catalog search results**; **do not download/cache product images** or re-use them independently of permitted real-time listings. Search-result payloads may not be stored in Supabase tables, Qloo caches, `catalog.source_items`, observability logs, snapshots, LLM archives or analytics traces. Restructuring, hashing or summarizing a forbidden payload does not automatically legalize retention. The [Catalog overview](https://shopify.dev/docs/agents/catalog) explicitly contemplates a stored product/variant reference for fresh lookup, not a stored response. Persist only the selected IDs, exact seller/shop ID and verified storefront domain necessary to reopen a saved opportunity without silent substitution; keep current offer facts transient. The [Shopify API terms](https://www.shopify.com/legal/api-terms) also limit use and storage of merchant data to what is needed for the application service and require deletion once it is no longer needed. This field-level necessity decision does not authorize a reusable product index or copies of Catalog content.

- Hold transient Shopify offer data only as needed for an active compliant evaluation; use **fresh** permitted lookups for current price, availability, exact variant and shipping claims. Do not replay saved historical offers as currently valid.
- Durable records may contain user inputs, policy key, allowed Qloo request lineage (subject to Qloo's rules), explicitly permitted external references, user-authored concepts and non-prohibited decision metadata. Audit per-field retention before database migration.
- New policy outputs append separately. Do not expose retired workflow reports in the final app.
- Untrusted merchant URLs, external content and Tavily snippets are data, **not executable instructions**. Validate HTTPS, ownership association, DNS resolution and redirects; block internal/private addresses and unexpected ports to prevent SSRF.
- Never request private Shopify Admin/order/margin data for this MVP. Storefront discoverability is not proof that the user owns the business.
- Keep each versioned saved assessment immutable. On opening an opportunity or starting a new proposal, derive a **transient current view** by looking up the exact saved seller/shop, product and requested variant, then rechecking the user requirements against current price/currency, availability and market evidence. Never substitute another seller, product or variant, or display an old price as current. A failed or materially changed exact-offer lookup makes the current opportunity `needs_verification`; a verified wrong seller/product/required variant or violated explicit hard condition makes it `unsupported`. Current unavailability without a hard-now requirement needs a new offer review; with a hard-now requirement it is `unsupported`. The saved verdict and user-authored proposal remain historical records, clearly distinct from the current view.

---

## 11. Acceptance fixtures — required for each enabled path

Each test below assumes **real evidence in a fixture packet** where stated; brand names are **illustrative**, not newly retrieved Qloo/Shopify results. Native discovery, shared assessment, direct comparison and their applicable negative cases must pass before those paths are called complete. Fixtures 5–7 validate optional context and Shopify fallback behavior **before those paths are enabled**; if live feasibility has not passed, keep them disabled and verify the UI does not present those leads as supported native recommendations. Failure of the optional non-native gate does not block the verified native path.

| # | Fixture | Expected behavior |
|---|---|---|
| 1 | Native Brand A query **unconstrained** returns correctly identified Brand B; no explainability/tags; valid concrete two-product bundle | Cultural `native_recommendation_verified` + `no_named_theme`; opportunity **may be `supported`** if all other gates pass. |
| 2 | Same native recommendation, optional candidate-focused query empty/warning | **Do not downgrade** original cultural relationship; do not invent theme. |
| 3 | Brand B included only because `filter.results.entities=B`; no substantive returned association or corroborated theme | Cultural `unknown`; **`needs_verification`** (especially in direct comparison). |
| 4 | User-specified direct pair; Qloo evidence has interpretable candidate association or independently verified meaningful common cultural territory; valid offers/mechanism | `direct_pair_supported` and potentially `supported`; **never claim independent unconstrained discovery**. |
| 5 | Context path: Qloo lacks native Brand A; specific verified product references resolve to Qloo inputs; Qloo recommends B; independent candidate corroboration | `context_relationship_corroborated` and potentially `supported`, never native Brand A affinity. |
| 6 | Qloo-guided Shopify keyword produces B without candidate-side relationship evidence | `direction_only`; research lead, `needs_verification`. |
| 7 | Qloo returns only generic “lifestyle”/“design” tag, no meaningful candidate participation; non-native path | Cannot pass cultural relationship on generic tag alone. |
| 8 | Native Brand A signal actually belongs to a different namesake; all commerce facts otherwise plausible | **`unsupported`** foundational identity conflict. |
| 9 | Named shared theme incorrectly asserted but original native recommendation valid | Remove/downgrade theme; **do not discard** legitimately proven native relationship. |
| 10 | Coffee beans + verified compatible brewer; selected brand offers and native Qloo evidence | Functional mechanism may be `supported`; no invented joint checkout or ROI. |
| 11 | Tea + ceramic cup, named coherent gifting purpose, two verified offers and sufficient culture | Occasion mechanism may be `supported`; not automatically inferior to functional. |
| 12 | Candle + journal with no product-specific roles, only “wellness aesthetic” | `productCompatibility=unknown`, opportunity `needs_verification` absent other hard conflict. |
| 13 | Socks + coffee joined only by “morning routine” story | Weak `jointUseCoherence`/`incrementalValue` → **unknown**, not unsupported unless a genuine contradiction exists. |
| 14 | Products demonstrably technically incompatible for claimed use | **`unsupported`** for that opportunity. |
| 15 | Cross-Sell complements one actual cited seed product family; limited assortment | Can be supported while explicitly saying **reviewed assortment only**, not “Brand A doesn't sell X.” |
| 16 | Cross-Sell only searches one seed category, LLM claims full-category absence | Reject the absence claim; status may be `needs_verification` if the supposed complement depends on it. |
| 17 | Global Catalog seller is unrelated reseller falsely described as Brand B's own official merchant | Identity unknown/contradicted as warranted; cannot pass merchant validation based on product branding alone. |
| 18 | Requested size/variant silently relaxed by product lookup | Do not pass selected variant; if required, unknown or contradicted depending on returned evidence. |
| 19 | US prefill only; shipping is unverified and no mandatory shipping toggle set | Do **not** fail the opportunity solely for missing US delivery proof; disclose missing shipping. |
| 20 | User explicitly demands US shipping; unavailable/unknown shipping signal | **Verified ineligible → `unsupported`; unknown → `needs_verification`**. |
| 21 | User hard price cap in USD; selected offer priced GBP with no comparable permitted conversion | `needs_verification` for price constraint; no arithmetic comparison or invented exchange rate. |
| 22 | A price is missing; no cap and price not essential to mechanism | Possible `supported` with price shown as **not verified**, never invented. |
| 23 | Existing historic collaboration found by Tavily | Cite history only; cannot claim new agreement, new sales benefit, or independent Qloo pairing. |
| 24 | No negative Tavily news returned | No automatic “brand safe” or reputational score. |
| 25 | Supported comparable tea+cup gifting opportunity vs supported tea+infuser; user explicitly requests gifting | Ranking must respect **explicit purpose**; mechanism family alone must not force infuser first. |
| 26 | Two supported opportunities same objective but one has stronger documented partner-specific rationale | Better evidenced candidate wins when earlier criteria tie; category-wide generic rationale is not a gate failure. |
| 27 | Same permitted evidence packet, changed LLM wording/pagination/search order/redundant citation count | **Same status, rationale categories and deterministic ranking**. |
| 28 | Shopify response payload/image is attempted in persistent logs/cache/snapshot | Persistence policy test fails; no prohibited data is stored. |
| 29 | Native Qloo candidate lacks suitable products; later Qloo candidate has viable pair | Worker continues within research budget and surfaces later opportunity; does not force earlier match. |
| 30 | Retired workflow routes and reports | Historical Brand × Brand and Brand × YouTube routes and reports do not appear in the final app. |
| 31 | Selected item is a brand-history book; its page says the brand also makes bags; proposed Bundle treats the selected book as a bag | Brand-wide background does not ground the selected item's role; mechanism stays unknown even when the passage matches exactly. |

### Human validation (not a claim of measured accuracy)

1. Assemble a fixed evaluation set across food/beverage, apparel, accessories, home and personal care (electronics only where compatibility claims can be checked). Include convincing positives, wrong merchants, strong Qloo/weak product pairs, weak Qloo/strong product pairs, false cultural themes, generic occasions and explicit hard-market blockers.
2. Two independent human reviewers label product-mechanism defensibility, cultural explanation correctness, and whether they would shortlist the opportunity. Resolve disagreements; retain adjudication notes.
3. Compare **Qloo-led discovery + Shopify assessment** against a **Shopify/category-only** candidate-search baseline under the **same seed, objective, available calls and research effort**. Assess `Precision@3` among Supported, false-Supported rate, ranking preference, diversity and actual incremental contribution of Qloo.
4. Test repeated identical accepted evidence packets for stable status and ordering regardless of LLM phrasing or candidate-return order. If the rubric produces unstable subjective judgments, fix normalization/validation or add human review; do not mask the problem with invented precision.

---

## 12. Implementation order and definition of done

1. **Prove one live native-Qloo Bundle journey** end-to-end with actual IDs, Qloo response, independently verified merchants, selected product/variant offers and defensible product mechanism. Report failures honestly.
2. Implement split **proposal → validated evidence → authoritative assessment** schemas, provenance checks, identity/seller validation, permitted source refs and v1.1 versioned output.
3. Implement **cultural relationship + cultural explanation** independently, including native-without-tag and focused-query-only cases.
4. Implement three product-mechanism checks, objective-specific proof rules and hard-vs-default market semantics.
5. Implement deterministic status policy, lexicographic supported ranking, grouping/deduplication, stable tie-breakers and bounded worker research.
6. Wire evidence explanations into UI; maintain distinct Supported / Needs Verification / Unsupported states and research-lead labeling. After partner selection, draft the proposal directly from verified facts in the Proposal Studio (concept step removed 25 Oct).
7. Verify no Shopify policy violations or SSRF; run all fixtures applicable to enabled paths, including disabled-branch rejection checks, plus Brand × Brand end-to-end tests; then perform the human quality evaluation. Run the context and fallback fixtures before enabling those optional paths.

**Definition of done:** For every shown opportunity, a reviewer can tell **which verified companies/merchants and selected products**, **what Qloo actually established**, **why the products work together for this user's objective**, **which facts remain unverified**, **what still requires a deal**, **why this result ranks above another**, and **what was observed versus inferred**. If a mandatory element is missing, call it Needs Verification/research lead instead of inventing certainty.

## Official references (provider capabilities; not proof of live CrossCulture success)

- Qloo Insights, query-specific explainability and result filtering: https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md
- Qloo Taste Analysis, tag insight semantics: https://github.com/qloo/docs-public/blob/main/reference/taste-analysis.md
- Shopify Catalog overview and caching/image restrictions: https://shopify.dev/docs/agents/catalog
- Shopify Global Catalog MCP and market, seller, variant filters: https://shopify.dev/docs/agents/catalog/global-catalog
- Shopify Storefront Catalog MCP: https://shopify.dev/docs/agents/catalog/storefront-catalog
- Architecture authority: **CrossCulture Brand × Brand Architecture v2.2 (clarified)**.

*This v1.1 policy is a specification, not a claim that new provider calls or production/human validations have already succeeded. Implement the acceptance tests against actual response schemas and permitted source data before calling it deployed.*
