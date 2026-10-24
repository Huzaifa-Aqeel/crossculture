# Qloo mid-market brand coverage preflight — 2026-10-17

## Search contract and method

The installed Qloo MCP exposes typed `qloo_describe(entity, type: "brand")`, `qloo_recommend`, `qloo_rank`, `qloo_entity_tags`, and `qloo_find_tags`. Its typed describe resolves through Qloo Search and validates returned IDs with `/entities`. [Qloo's official Search reference](https://github.com/qloo/docs-public/blob/main/reference/get-search.md) documents `query`, `types`, `take`, and `page`. The preflight compared MCP responses with direct official `/search?types=urn:entity:brand&take=100&page=1` responses, using the same configured Qloo host and credential. It did not guess IDs or substitute a venue/person for a brand.

| Input | Typed native Qloo result | Direct typed Search | Interpretation |
| --- | --- | --- | --- |
| Fishwife | `needs_input/not_found`, no brand results | 0 results | No resolvable brand in this Qloo search. Untyped `FISHWIFE` is a Caribbean seafood restaurant, not the tinned-fish company. |
| Fly By Jing | `needs_input/ambiguous`, unrelated “by” brands | 202 results across pages 1–3; no exact or near-name match | Broad token matching produces unrelated brands. `Flybyjing` also returned no typed result. No verified native identity. |
| MiiR | `needs_input/not_found`, no brand results | 0 results | No resolvable typed brand. Untyped search shows `MiiR Flagship` as a **place**, not a brand; `MiiR drinkware` typed search returned none. |
| BAGGU | `ok`, **Baggu** `28823801-25D0-4A3E-AA90-3F028E2DBB3A`, described as the Brooklyn reusable-bag/accessories brand | 1 result, same ID | Verified native Qloo brand identity. Case difference is handled by app name normalization. |
| Fellow | `needs_input/ambiguous`, unrelated `Jolly Food Fellow` | 1 unrelated result | `Fellow Products` and `Fellow coffee` did not resolve the coffee-equipment company. No verified native identity. |

These are bounded negative **search** results, not proof that Qloo has no underlying record under any possible name or catalog revision. The app's `normalizeQlooBrands` receives no valid result for four brands; it does not discard a matching entity in these cases. Its strict confirmation therefore correctly blocks incorrect merges. BAGGU survives normalization. The installed MCP has no separate broad entity-search tool; `qloo_describe` is the supported name/UUID resolution surface. The official API's documented typed `/search` was used to audit the MCP outcome rather than treating `needs_input` alone as catalog absence.

## BAGGU cultural path

- BAGGU native Qloo ID produced 12 brand recommendations via `/v2/insights`. The list included Cold Picnic and Hansel From Basel without manual candidate injection.
- Cold Picnic `F5BDFE2E-B464-48FB-9025-52C3CFFF4F3C` was independently confirmed by native Qloo describe. A candidate-specific brand rank returned the same ID with query-relative affinity `0.9453350859`. That number is **not** a Collaboration Opportunity Score or an admissible bridge by itself.
- Qloo's top-20 entity-tag responses for BAGGU and Cold Picnic share exact IDs for `Design Enthusiasts` (`urn:tag:customer_segment:qloo:design_enthusiasts`) and `indie` (`urn:tag:genre:music:indie`). The current bridge builder admits both as **broad** Qloo tag overlaps. The latter is generic and the tag responses include unrelated place-style artifacts, so neither should be described as a specific named cultural relationship. A Qloo-stage route exists; independent identity/business evidence, relevant activities, objective capabilities, and v4 eligibility remain untested.
- Hansel From Basel was also recommended, native-ID-confirmed, and ranked, but its top-20 intersection with BAGGU was only the generic `indie` tag after current exclusions. Building Block, Lisa Says Gah, Everlane, and Cold Picnic tags were sampled for bridge quality; Cold Picnic gave the clearest exact shared design-community tag in this bounded set.

## Alternative for an absent seed

Qloo `qloo_find_tags("tinned seafood")` returned native tags including `urn:tag:interests:qloo:tinned_seafood`. `qloo_recommend(target_type: "brand", signal_tags: [that URN])` is a supported API operation and returned five brands. In this test they were unrelated organizations (for example Hyatt Place and Edward Waters College), all with the same reported affinity. This is a technically legitimate **tag-led exploratory search**, but the tested output did not validate its relevance, and it does not establish a Fishwife Qloo identity or a brand-specific Fishwife–candidate relationship. The current Brand × Brand workflow cannot use it for Fishwife identity, bridge freezing, or scoring without a separately specified and validated product design. No such workflow was implemented.

## Offline product-mechanism diagnosis

Fixtures based on the previously inspected official Fishwife salmon collaboration page and Fly By Jing Chili Crisp product page return `null` from `concreteProductMechanism`. The fixed `PRODUCT_TYPES` vocabulary covers items such as bags and bottles but omits salmon, tinned fish, chili crisp and sauces. A control with the same inspected/company-verified source structure and explicit selling language yields a bundle for bag plus bottle, while salmon plus chili crisp still returns `null`. Missing inspected or company attribution still returns `null`. This isolates a product-vocabulary coverage limit rather than a v4 score defect. Existing collaboration evidence is historical business evidence; it must not imply agreement to a future project. No production gate or scorer was changed.

## Recommendation and usage

**Recommend BAGGU as the seed for the next fresh full end-to-end demo.** It is the only one of the five with a confirmed native Qloo brand ID, 12 Qloo-discovered brand leads, and at least one candidate with a reproducible broad design-community overlap. Do not preselect Cold Picnic in that autonomous run. Official business identity, source-backed Goal Fit, concept/proposal persistence and final scoring still require normal testing.

This preflight used **26 Qloo MCP operations** and **7 direct official Qloo Search requests** (including two additional Fly By Jing result pages). It made **zero Tavily, Wikidata, YouTube, LLM, or scoring requests**. Focused offline fixtures passed with `node api/scripts/check-midmarket-coverage-offline.mjs`.
