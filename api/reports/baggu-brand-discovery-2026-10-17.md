# BAGGU Brand × Brand primary discovery — 2026-10-17

## Method and budget

A temporary signed-in local user selected the independently verified BAGGU identity (Qloo `28823801-25D0-4A3E-AA90-3F028E2DBB3A`, Wikidata `Q133042541`, `baggu.com`), created a Co-Marketing & Cross-Promotion project, and ran the normal `live_brand` discovery worker. The runner supplied **no partner, candidate order, or provider override**. It captured the saved run and latest frozen assessment before diagnostic cleanup. This is local live-provider verification, not hosted acceptance.

The shared rolling web ledger was **38/50** before the run and **50/50** after: 12 new Search/Extract reservations, eight reported credits. The user-private Qloo response count rose from zero to five (seed describe, recommendation, pair rank, and two tag responses). No additional web calls were made after exhaustion.

## Actual funnel

Qloo recommendation response `13936447-da2a-48af-aa7a-3ed0f8ce9f17` returned **12** brands in this order: Need Supply Co., Creatures of Comfort, Hansel From Basel, Cold Picnic, Lacausa, Building Block, Everlane, Assembly, Lisa Says Gah, Mohawk General Store, Jesse Kamm, NOMIA. The production worker's existing eight-lead cap screened the first eight. Cold Picnic was fourth and was neither supplied nor promoted manually.

| Screened lead | Identity outcome | Assessment outcome |
| --- | --- | --- |
| Need Supply Co. | Wikidata record `Q85788128` found; official-site corroboration absent | Not assessed; record alone did not pass identity gate |
| Creatures of Comfort | No resolved business record or official-domain corroboration | Not assessed |
| Hansel From Basel | No resolved business record or official-domain corroboration in this run | Not assessed |
| Cold Picnic | No Wikidata record; official-domain lookup was skipped because its Qloo description's “rugs” category was missing from the bounded identity vocabulary | Not assessed; **screening defect corrected offline after the run**, not retrospectively verified |
| Lacausa | No resolved business record or official-domain corroboration | Not assessed |
| Building Block | Ambiguous identity | Not assessed |
| Everlane | Wikidata `Q21410966` and matching `everlane.com` established identity | Researched, frozen and assessed; insufficient evidence |
| Assembly | Ambiguous identity | Not assessed |

The remaining four Qloo recommendations were not screened because of the existing eight-lead cap. The funnel was **12 Qloo candidates → 8 screened → 1 identity-confirmed → 1 researched → 1 Qloo broad-overlap-supported → 1 frozen/assessed → 0 eligible, 0 conditional, 1 insufficient-evidence**. The saved local run was `partial`; it contained one Everlane match and immutable v4.0.1 assessment `0e4814dd-c8b5-45cb-a303-b78056f75f69`. Its frozen data was captured for this report, then the temporary test account and its run were deleted. No scored recommendation was saved.

## Frozen Everlane evidence and score

The packet froze BAGGU/Everlane Wikidata identity source records and the Qloo pair-rank response `97d334a5-f2b3-4fd0-a985-74a65ed6388d`. Exact shared Qloo tags in seed response `5aa034e7-6589-40c0-92a2-e7622fc425e6` and partner response `5d9f8fbe-0474-4b94-a212-1446971f4ecb` were `indie` (`urn:tag:genre:music:indie`) and `Minimalist Design` (`urn:tag:keyword:qloo:minimalist_design`). Both are **broad overlaps**, not specific named relationships; pair rank/affinity did not directly set C.

The frozen snapshot held **C=.50, R=null, G=null**, `insufficient_evidence`, no display score, `brand-goal-fit-v2`, scorer `4.0.1`. Its `partnerActivity` was empty; no inspected web source passed into the frozen evidence. Content-creation capability and activation channel were unsupported in the packet. It lacked an attributable partner activity in the relevant territory, an inspected concrete joint promotional route, and supported activation channels for both brands. The worker performed selective web research, but retrieved pages did not establish those claims. This is inconclusive research, not evidence that Everlane lacks those capabilities. A generic internal mechanism string was present in `score_json`; it was **not** a validated or frozen source-backed proposal and G remained null.

The 12 web reservations were seven Everlane Search requests and five Extract requests; inspected/extracted leads included the Everlane About page, product collections, a Tumblr page and a redirect. None became a valid activity or Goal Fit source. Research exhausted the shared ledger before more official-site identity or capability questions could be resolved for other candidates. The result does not establish whether Cold Picnic or the unscreened four could qualify.

## Follow-up and limitations

The missing `rugs` identity category was reproduced with an official-domain fixture: before correction, **zero** identity searches were issued for the otherwise valid Cold Picnic description. Adding `rugs` enables the same two bounded official-domain checks used for other categories; an unrelated domain still fails. It does not bypass identity, cultural, R/G, or scorer gates. This code correction has not been rerun live while the shared web ledger is full.

No candidate was eligible or conditional, so the conditional three-concept, edited Proposal Studio, save/reload and export sequence was **not entered**. The current run demonstrates saved unscored assessment creation and readback before test-account cleanup, not a saved scored recommendation or complete downstream acceptance. A later normal run after budget capacity returns must verify the corrected identity path and source-supported Co-Marketing evidence before the downstream sequence is justified.
