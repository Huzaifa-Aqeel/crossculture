# Creator attribution and score consistency verification — 16 October 2026

## Danni Juhl attribution

- The assessed official YouTube channel is `UCkGNihSIqW5eDM4Wukj-t_g`, named Danni Juhl, US country field. Its short description alone does not attribute the operator.
- A bounded Tavily Search for `Danni Juhl portfolio` returned `https://www.dannijuhl.net/` as a lead. Tavily's text and markdown Extract projections omitted the decisive hrefs, so neither projection was accepted as link proof.
- The existing shared web ledger and cache now cover narrow first-party HTML link inspection. The inspected portfolio explicitly links to `https://linktr.ee/dannijuhl`; the inspected Linktree links back to the portfolio and labels `https://www.youtube.com/channel/UCkGNihSIqW5eDM4Wukj-t_g?` “My YouTube Channel”. The empty query marker does not change the canonical channel path. Redirect targets and name-only matches are not accepted.
- Both inspected pages have independent source hashes and retained outbound targets in the existing `catalog.source_items` `creator_identity` records. The normal worker freezes both catalog source references for the operator claim. No new table or identity threshold was introduced.
- The bounded identity check reused the saved Search and two page-inspection responses on replay. Initial calls used one Tavily Search credit and two ledger-tracked direct page inspections with zero Tavily credits. Two earlier markdown Extract probes returned stripped links and reported zero credits. The shared 50-request limit still counts all requests.

## Normal A24 × Danni direct assessment

The ordinary direct-pair worker, with optional captions disabled, analyzed **20/20** latest official video metadata records and completed without candidate errors. It saved v4.0.1 `insufficient_evidence`, **C=null, R=null, G=.75**, no display score. The reason codes were `no_qloo_supported_pair_bridge` and `creator_cultural_content_unverified`. The current latest-20 still contains [“The Art Of Imperfection - a #microfilm #mentalhealth #cinematic”](https://www.youtube.com/watch?v=vNhgVtoYEfk). This run's extracted cultural observations instead presented *Making Room For My Inner Artist* as ambiguous and *The Art Of Imperfection* as unsupported. The earlier discovery assessment froze a *Microfilm* bridge and C/R/G `.75/.50/.75`, but its temporary packet was deleted. The subsequent [cross-workflow audit](creator-cultural-consistency-2026-10-16.md) established that Qloo's *Microfilm* is an artist, while this title uses “a #microfilm” as a generic format. The earlier bridge was an unsupported identity merge; the direct run's C/R-null result was appropriate.

## Nike × AJcompsHD score comparison

Both recorded runs used the same official latest-20 [Ronaldinho video](https://www.youtube.com/watch?v=-JvPjTJkF60), an exact Nike–Ronaldinho typed Qloo relationship, and a sampled [content-format video](https://www.youtube.com/watch?v=eHaVK2MeCVA) for G. Both froze **C=.75 and G=.75**. The direct preservation path marked Ronaldinho **substantive** (R=.25, **50/100**), while Qwen in discovery marked the same title-grounded activity **central** (R=.50, **65/100**). The later [cross-workflow audit](creator-cultural-consistency-2026-10-16.md) found no demonstrated difference in the underlying official metadata and made this explicit, corroborated paired-title centrality deterministic for new assessments. v4.0.1 and historical snapshots remain unchanged.

Focused link, misleading Linktree, wrong-channel, redirect, evidence-freeze and scorer fixtures passed. The signed-in creator fixture and production build passed. The A24 direct result remains honestly unscored after the cultural-identity correction.
