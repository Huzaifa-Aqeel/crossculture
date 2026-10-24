# Product-mechanism evaluation v1 — 24 October 2026

## What was measured

The app's own pair review (`evaluateCommerceMechanism`: proposal → source-checked quotes → rubric → objective judgment → deterministic rules) on 64 hand-written synthetic product pairs in `fixtures/commerce-mechanism-eval-v1.json`. Each pair ran three times on Bedrock `qwen.qwen3-next-80b-a3b`. Product text is synthetic, not Shopify data. Labels apply Scoring Engine v1.1 §4, §5.2 and §5.3 to the product mechanism only; identity, culture and offers are out of scope.

Labels were written by Claude with a reason per pair, not by human reviewers, so this is a regression and consistency measure, not the human-adjudicated precision the Scoring Engine §11 asks for. The 24-pair holdout was frozen before any run (sha256 `58fc95ba232ecd437dd89d5d9671db94fa6dc5414495290de82a8470f3233438`) and evaluated once, after changes were final.

Rerun: `npm run eval:mechanism -- --split dev --repeats 3 --label <name>` from `api/`. Results land in `reports/mechanism-eval/`.

## Results

"Pass rate" counts all runs (pairs × 3). "Stable" means all three runs agreed. The dev set gained four pairs after the live runs below (shirt + belt, shirt + beach tote, shirt + sandal, helmet + goggles); the holdout never changed.

| Set | Objective | Good pairs passing | Bad pairs passing | Stable |
|---|---|---|---|---|
| Dev (40), before | Bundle | 3% (0/10 pairs by majority) | 0% | 19/20 |
| Dev (40), before | Cross-Sell | 87% (9/10) | 13% (1/10) | 16/20 |
| Dev (44), final | Bundle | 67% (7/11) | 0% (0/13) | 21/24 |
| Dev (44), final | Cross-Sell | 100% (10/10) | 0% (0/10) | 20/20 |
| Holdout (24), final | Bundle | 100% (6/6) | 0% (0/6) | 12/12 |
| Holdout (24), final | Cross-Sell | 89% (5/6) | 0% (0/6) | 11/12 |

The holdout was run twice: once after the first fix (Bundle bad 17%: sweater + hand balm) and once after the live-run rules below. Neither run was used to tune. The old code was not run on the holdout.

## Live runs (24 October, signed-in public API, temporary users deleted)

| Run | Before these rules | Final code |
|---|---|---|
| Everlane linen shirt, Bundle | 7 Supported, all outfit co-wear (shirt + belt/sandal/tote) | 0 Supported |
| Caraway sauté pan, Bundle | 1 Supported: pan + laundry oxygen bleach (unsupported care claim) | 2 Supported: pan + Arhaus dinnerware set, pan + cutting board |
| Everlane linen shirt, Cross-Sell | — | 8 Supported (bags, pouches, sandals, belts) |
| Our Place (no product chosen), Bundle | — | 0: Qloo partners were bedding, bags, lingerie, haircare, jewelry, rugs |

Each Supported run saved an opportunity, generated three concepts, edited a proposal and reloaded with current offers.

## Causes found

1. **Prompt templates carried answers.** Several prompts said `Return exactly {"field":true,...}` with concrete values. Under structured output at temperature 0 the model copied them verbatim. The Bundle counterfactual's template held rejecting values, so it rejected every Bundle (including coffee + grinder and tea + infuser, the Scoring Engine's own examples). The Bundle and Cross-Sell challenges and the concept review held passing values, so they approved everything; a second bag of coffee passed as a Cross-Sell. The proposal template also pre-filled `"kind":"occasion_complement"`.
2. **A word filter blocked real bundles.** Any role or benefit containing words such as `coat`, `clean`, `wash`, `treat` or `apply` required merchant-authored compatibility proof, so a rain coat + daypack or skillet + chainmail scrubber could never be Supported.
3. **Stacked "if unsure, no" checks.** Three model checks asked overlapping questions after the rubric; one rejection anywhere sank a pair.

## Changes

- One objective judgment replaces the three stacked challenges. It writes a few words about each item's job and the combined outcome, then picks a named verdict. The server combines its fields: same product type → substitute; a mood, ritual or "moment" counts only when both items' own text names that activity (Scoring Engine §4 candle + journal example); otherwise the result must be practical.
- No prompt template carries an example answer; a check fails if one does.
- The compatibility rule applies only when an item's role is itself a treatment or care product (cleaner, conditioner, polish, protector, detergent…), excluding personal-care roles such as hair conditioner. Explicit "fits/compatible" claims still need merchant-authored proof.
- The proposal prompt asks for short roles, plain English, bundle-allowed kinds only, and no fit claims unless quoted; over-long fields are trimmed instead of discarding the proposal.
- The concept review quotes the exact unsupported phrase or says "none", instead of a bare boolean.
- Discovered partners are ordered by a product-fit hint from Qloo descriptions before deep research (likely → possible → unlikely; none excluded).
- After live runs: two apparel or personal-accessory items form a Bundle only when one acts directly on the other (a leash clip on a harness); outfits stay eligible as Cross-Sells. When the judge marks one item as a care product for the other, its trusted text must name the other item's type or material, and a restrictive care instruction on either page (dry clean only, professional cleaning only, do not use…) requires the exact merchant-authored compatibility statement.

## Known misses and limits

- Dev Bundle misses: rain jacket + daypack (rejected as co-wear under the strict apparel rule), journal + wind-down candle (borderline Scoring Engine example), duvet + dryer balls (care text says "laundry", not "duvet"), helmet + goggles (strict exact-title fit rule).
- Holdout Cross-Sell miss: leather boot + cedar shoe trees (strict fit rule).
- The exact-title fit rule blocks many equipment pairs whose benefit says "fits" or "works with"; it is kept because the Scoring Engine treats technical fit as material.
- Without a chosen starting product, research pairs arbitrary products from each side and reviews 4 pairs per partner; most results come from the chosen-product path.
- Concepts sometimes fall back to the generic templates when the concept review rejects the drafts (seen on the Everlane Cross-Sell run).
- Labels are Claude-written; human adjudication is still required for a precision claim.
