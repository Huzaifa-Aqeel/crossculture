# Fishwife × Fly By Jing live pipeline check (2026-10-17)

## Normal workflow outcome

The local signed-in diagnostic used the production brand resolver and would have used the normal direct-pair and autonomous discovery workers. Neither run could start because the required Qloo brand identity was unavailable. No Qloo candidate, cultural bridge, frozen assessment, v4.0.1 score, recommendation, concept, proposal, saved match, reload, or export was generated for this pair. The temporary test user was removed.

| Brand | Qloo `qloo_describe` with `type: brand` | Wikidata |
| --- | --- | --- |
| Fishwife | `needs_input`, resolution issue `not_found`, no results for exact name | Search returned dictionary/profession, art, statue, and punk-band records; no corroborated consumer-brand record |
| Fly By Jing | `needs_input`, resolution issue `ambiguous`, no exact-name result; shown candidates were unrelated brands | `Q137427273`, “brand of chili crisp”, official site `https://flybyjing.com` |

Additional precise Qloo queries, `Fishwife Tinned Seafood` and `Fly By Jing Chili Crisp`, returned `needs_input` with unrelated seafood or beauty/restaurant candidates. They did not supply verified Qloo brand IDs. Selecting an unrelated entity would violate the identity and bridge gates. Fishwife-only Qloo recommendations cannot be requested without a confirmed seed Qloo ID. Fly By Jing therefore could not be autonomously discovered or excluded by a genuine Fishwife discovery run.

## Independent official-web evidence

The existing ledger-tracked Tavily Search adapter found an inspected [Fishwife official product page](https://eatfishwife.com/products/smoked-salmon-with-flybyjing-sichuan-chili-crisp) describing its existing smoked-salmon and Fly By Jing Sichuan Chili Crisp collaboration. It says Fishwife supplies smoked salmon and Fly By Jing supplies Sichuan Chili Crisp. An inspected [Fly By Jing product page](https://flybyjing.com/products/sichuan-chili-crisp) confirms the Chili Crisp product. This supports the historical collaboration and distinct product contributions as public facts; it does not establish a Qloo cultural bridge or a proposed new joint offering. No agreement for another project was inferred.

The current `brand-goal-fit-v2` product mechanism classifier also returned `null` for these source excerpts in an offline check. Its conservative product vocabulary currently includes categories such as jacket, bag and bottle, but not salmon or chili crisp. Thus even with valid Qloo identities, this food pairing would need a properly source-backed product mechanism beyond the current vocabulary before numeric G; this check did not change the policy or v4 scorer.

## Provider use and acceptance limits

- Qloo: six `qloo_describe` calls total (the signed-in attempt for two names plus four exact/expanded-name probes); none produced a cacheable `ok` brand response. No recommend, rank, or entity-tag request was made.
- Wikidata: five search/detail requests during the preflight and signed-in attempt. Only Fly By Jing yielded a selected brand record.
- Tavily: four Search requests, each reporting one credit. The shared rolling web ledger advanced from 34/50 requests and 20 reported credits to 38/50 and 24 credits. No Extract request was needed. Search results remain in the normal shared provider cache.
- Direct comparison: not started; identity prerequisites unavailable. Fresh autonomous discovery: not started; Fishwife Qloo seed ID unavailable. Frozen evidence and v4 score: not produced. Conditional proposal/save/reload/export: not tested for this pair because there was no supported assessment.

The test establishes a provider-coverage entry blocker for this requested pairing, plus a reproducible food-product Goal Fit vocabulary gap. It is not evidence of a failed cultural relationship between the real businesses; Qloo never resolved the two exact brands. Existing evidence gates were preserved.
