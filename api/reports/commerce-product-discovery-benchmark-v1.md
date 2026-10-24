# Selected-anchor partner-product discovery benchmark v1

This is a **synthetic retrieval regression**, separate from the 16-case fixed-pair mechanism benchmark. Run `node api/scripts/check-commerce-product-discovery.mjs` from the repository root. The fixture has one exact Brand A product/variant, a verified Qloo Brand B candidate, sixteen observed Brand B product positions across a broad search, and two focused search scopes. No brand or product name in this synthetic fixture is a live provider result.

The script checks three behaviors under the normal shared pair-research function:

1. For Product Bundle, a plausible partner item that is late in broad returned order can be selected and assessed against the exact anchor. A hallucinated product ID is ignored.
2. For Cross-Sell, the same observed assortment can lead the objective-aware selector to a different first assessed partner item while preserving the anchor and Qloo relationship.
3. If the selector fails, bounded scope-aware fallback still reaches a distinct partner product from a focused search and reports the selection limitation.

The test injects a deterministic selector, mechanism proposal, and rubric so it isolates **retrieval and routing**. Its Supported results are fixture states, not human judgments about real products. It does not measure the production selector's semantic quality or prove that the app finds the best item in a live catalog.

## Required live evaluation

Build a separate, independently reviewed set of US merchant cases after candidate selection, with exact Brand A product/variant, objective, actual Qloo-returned Brand B ID, official storefront, dated public product links, and multiple Brand B product alternatives. Freeze the candidate cases before app execution. Two reviewers should judge which specific partner products are defensible, weak, or uncertain from source-linked evidence; adjudicate disagreements without seeing app choices. Record whether each alternative was returned by search, resolved by exact detail, assessed, and shown. Keep provider transport/rate limits, incomplete search coverage, mechanism Unknown, and human-disputed product merit separate.

Report recall of independently adjudicated defensible products **within observed and exact-resolvable catalog results**, coverage of the eligible alternatives, first or top reviewed product quality, and final opportunity precision separately. Compare equal-budget retrieval approaches if claiming improvement. Do not turn this into one accuracy percentage or use the 16 fixed-pair cases as an independent holdout. Shopify Catalog search payloads, images, and current offer facts remain transient; retain only permitted references and source-linked review decisions.
