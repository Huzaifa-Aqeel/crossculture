# Brand × YouTube C/R intersection diagnosis — 16 October 2026

This is a bounded local diagnosis using the retained A24/Nike discovery traces, live Qloo MCP Insights, official YouTube Data API v3 metadata, the signed-in creator worker, real evidence freezing, and Scoring Engine v4.0.1. Diagnostic users were deleted after each run. Temporary JSON traces are under `/tmp/crossculture-cr-*`; they are not customer recommendations. No transcript, new provider, schema, FR, or scorer change was made.

## Qloo top-20 limit and exact typed pairs

The local Qloo MCP advertises `qloo_rank` with `options`, `option_type`, and `signals`. Its live provenance shows `/v2/insights` queries using exact `filter.type`, `filter.results.entities`, and `signal.interests.entities`. The resolver formerly treated absence from `qloo_recommend(limit=20)` as a negative pair finding. These probes used **observed creator references**, exact Qloo IDs and types, not a guessed name or a raw affinity threshold.

| Brand and observed entity | Exact Qloo entity ID/type | In brand top 20? | Filtered Insights result | Finding |
| --- | --- | --- | --- | --- |
| A24 × *The Social Network* | `74C401D6-D3B3-4B08-BBC3-22A9F13E40C7` / movie | No | Exact movie returned for A24 signal | Demonstrated top-20 false negative after the sampled video was independently resolved as the film. |
| Nike × Ronaldinho | `E9B81FE2-F5FE-41C3-8CCA-67A28BF46C7D` / person | No | Exact person returned for Nike signal | Demonstrated top-20 false negative. |
| Nike × Unai Emery | `089185EA-BD24-43FC-BC9B-C20939173F86` / person | No | Empty | Unsupported; no bridge. |
| Nike × AJ Dybantsa | `3CCE843A-91FA-4A03-9716-42B6199B149D` / person | No | Empty | Unsupported; no bridge. |

The new private per-user `qloo_rank` wrapper caches an exact typed result in the existing Qloo response store. It rejects a missing response, different entity ID or type, and nonnumeric affinity; the resolver records the response ID and input hash. **The affinity number is never converted to C**. An admissible named bridge still requires an independently observed, material creator reference, exact Qloo entity identity, and a returned brand-conditioned result. Missing or ambiguous results stay review-needed. The filtered endpoint expresses Qloo cultural association, not a claim that A24 made *The Social Network* or Nike sponsored Ronaldinho.

The normal A24 × Karsten replay first remained unscored because untyped `qloo_describe("The Social Network")` returned a movie/album ambiguity. The official sampled [video](https://www.youtube.com/watch?v=d0dxBTyZm-M) names a sequel in its title and has Movie/Film/Cinema tags. A narrow disambiguator selects the unique movie candidate only when an observed sampled video has that exact title reference and film context; a music-tag fixture remains ambiguous. Multiple movie candidates also remain ambiguous. The exact-ID Qloo pair check then runs normally.

## Latest-20 activity screen versus search-hit ordering

A one-time diagnostic imported the latest 20 official uploads for the **21 historically selected** A24/Nike leads. The durable YouTube ledger records **63 new shared list requests** in that 55-second window: 21 `channels.list`, 21 `playlistItems.list`, and 21 `videos.list`; no search request. This was a measurement, not a deep assessment. Exact top-20 Qloo names in titles or descriptions were only *potential* evidence. The production screen uses **titles only**, excludes obvious product/sale titles, and never grants C or R.

| Historical pool | Existing deep limit | What latest-20 metadata showed | Consequence |
| --- | --- | --- | --- |
| A24, nine selected | Three packets | Seventh lead Loyalty Cup had four distinct sampled **titles** naming top-20 A24 films; fourth lead Novum had two *Midsommar* titles. | Search-hit priority had left a real C/R opportunity outside the packet limit. |
| Nike, 12 selected | Four packets | First eight had no exact top-20 person **title** match. Seventh lead Football Tat's apparent matches were in descriptions only. Tenth lead AJcompsHD had an exact Cristiano Ronaldo sampled title. | Description-only Football Tat was a false research signal. Replaying the general 12-preview ordering over those historical profiles moves AJcompsHD from tenth to first for deep research; the title itself does not verify its eventual bridge. |

The production worker now previews at most 12 selected canonical leads through the **same official import adapter**, bounded by the existing run plan (`floor((maxProviderCalls - 24) / 3)`). It reuses those profiles for deep packets, orders previewed leads by distinct latest-sample videos naming Qloo-returned entities, keeps tied/uncertain leads in their original diverse order, and leaves the deep packet limit unchanged. Channel operator identity is still checked before assessment. A screen failure does not discard a lead. The title screen is a research allocation heuristic; normal LLM extraction, Qloo pair validation, freezing and v4 decide admissibility.

## Normal assessment and R audit

| Bounded run | Frozen C/R/G, result | Source and exact limit |
| --- | --- | --- |
| A24 × Karsten direct | `.75/.75/.75`, eligible **75/100** | Latest-20 sampled [The Social Network video](https://www.youtube.com/watch?v=d0dxBTyZm-M) and [Spider-Man: Brand New Day video](https://www.youtube.com/watch?v=rFRjXJO1eoQ) were separately observed and admitted through Qloo. His older *Eighth Grade* discovery hit was absent from this direct run and did not contribute to R. |
| A24 × Loyalty Cup direct | `.75/.50/.75`, eligible **65/100** | One central latest-20 [The Farewell analysis](https://www.youtube.com/watch?v=j5QJDZzkvzM) survived Qloo validation and freeze. Its latest upload was in 2022; present-day activity/availability remains an explicit practical uncertainty, even though the approved v4 rubric admits the observed sample. |
| Nike × Football Tat direct | `null/null/.75`, insufficient evidence | Its person-name matches were in descriptions. The metadata extractor produced no material named cultural observation; operator identity was also unresolved. No bridge was manufactured. |
| Nike × AJcompsHD direct | `.75/.50/.75`, eligible **65/100** | One latest-20 [Ronaldinho video](https://www.youtube.com/watch?v=-JvPjTJkF60) was materially observed and returned by the exact typed Nike Qloo query. Other player names remained ambiguous, including Cristiano Ronaldo; the sampled title that made this channel worth inspecting was not itself granted as a bridge. |

The v4 creator R classifier already accepts activity linked to **any admitted bridge in the same pair**, rather than requiring the discovery-hit entity to recur. A regression proves that a different sampled, Qloo-supported entity can supply R while an out-of-sample hit cannot; removing the second supported bridge returns R to null. The real Karsten replay demonstrates this path with two different sampled films. No sample frequency, scorer anchor or score formula changed.

## Retrieval comparison and live discovery

The unrestricted normal A24 planner selected `Eighth Grade review analysis emotional honesty`, `The Noguchi Museum visit meditative space design`, and `Filmmaker profile intimate storytelling A24 style`. It selected nine leads and assessed three (60 sampled videos); none had a frozen bridge. It saved **0 eligible, 0 conditional, 3 insufficient** with **3 search + 24 shared** new YouTube requests. This is an honest negative live result; the preview cannot recover a channel absent from the returned pool.

A controlled **Qloo-grounded query replay**, with no supplied/injected channel, used `Eighth Grade final scene analysis` and the normal worker with the same three deep packets. Loyalty Cup reached assessment and the saved shortlist: **1 eligible (65/100), 0 conditional, 2 insufficient**; 9 selected, 3 assessed; **1 search + 21 shared** new YouTube requests. This isolates the prior progression problem for an already observed first-page lead, but the fixed query is a diagnostic, not proof that unrestricted planning always finds it.

A separate controlled Nike replay used its actual Qloo-backed `Daniel Alves career analysis` direction, no supplied channel, and the same four deep packets. Twelve distinct channels were returned; four had full 20-video samples and normal assessments. AJcompsHD reached the saved shortlist with its [sampled Ronaldinho source](https://www.youtube.com/watch?v=-JvPjTJkF60): **1 eligible (65/100), 0 conditional, 3 insufficient**, at **1 search + 30 shared** new YouTube requests. Daily Dose Of Football lacked a supported bridge; Piotr Foot and Football Tat also lacked independently verified operators. AJcompsHD was fourth in this *one-query* pool, so this live result proves normal assessment but does not by itself isolate the preview's effect. The historical three-direction pool placed it tenth; applying the final general preview rule offline to those 12 retained official profiles places it first. A full unrestricted three-direction Nike replay remains unverified.

No extra recency or pagination search was justified yet: both A24 and Nike already had source-supported C/R opportunities among first-page leads, so more raw results would not measure or solve the demonstrated progression limit. `search.list` pages and other list calls each consume one call in their respective Google quota buckets under [current official documentation](https://developers.google.com/youtube/data/determine_quota_cost); the app's separate rolling ledger was enforced throughout. At 10:14 UTC the app ledger held **43/85 search and 337/800 shared** reservations in its rolling 24-hour window. Query wording clearly changed the A24 returned pool, so robust unrestricted search-direction coverage remains to be verified separately.

## Verification and remaining limits

- Focused named-resolution, false-pair, source-backed movie ambiguity, latest-title ordering, run-budget boundary and alternate-R fixtures pass.
- Private Qloo cache reuse/owner isolation/wrong-type checks, real evidence-freeze fixture, signed-in creator integration, YouTube retention, creator-v4 regression, TypeScript, and production build pass.
- No change to v4.0.1, the latest-20 rule, out-of-sample source roles, provider ceilings, official YouTube adapter, or database schema.
- The controlled A24 and Nike results are not unrestricted planner acceptance results. The multi-direction A24 unrestricted run remained unscored; the historical Nike multi-direction pool was replayed offline through the current selection function, not through a new unrestricted live run. Query wording and preview coverage are separate remaining sources of variability.
