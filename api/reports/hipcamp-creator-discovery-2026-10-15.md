# Hipcamp → Find Creators: bounded live acceptance

Both runs used the signed-in discovery worker, the verified Hipcamp seed, Qloo, the configured LLM, official YouTube Data API v3, optional selected-video captions, evidence freezing, and Scoring Engine v4.0.1. The test supplied **no candidate channel**. A test-only filter required an explicit `US` channel country; the production worker instead retains unknown market status for review. Each test user and its saved rows were deleted after the script read the completed results. No raw captions were saved or printed.

## Baseline: tag-only planner

Five Qloo-tag directions: `off-grid cabin documentary 21st century female protagonist`; `folk music road trip with friendship themes`; `women-owned rural retreats indie music backdrop`; `beet salad at tourist attractions three star stays`; `inexpensive nature escapes discover card users`. Official search returned 12/12, 12/9, 12/10, 12/12 and 12/9 raw/distinct channel leads per query, with no duplicates across queries. Round-robin screening selected 15 distinct leads. Two US channels reached 20/20 metadata analysis and frozen v4 assessment: World With Wife (identity unknown) and Feral Yana (creator identity confirmed). Both had C/R=null and G=.75, zero Qloo bridges, and saved `insufficient_evidence` results without display scores. Eight leads were stopped by the test-only US filter, five were US organizations, and no eligible/conditional result was saved. Official YouTube ledger delta: **5 search, 19 shared** requests. The tag response included `Beet Salad`, `Discover` and `Three Star`; none of the planned searches used Hipcamp's available named Half Dome relationship.

## Named-place planner replay

The focused planner correction supplied the existing private Qloo `qloo_recommend(target_type=place, signals=[Hipcamp])` result as **search direction input only**. Half Dome (`0BF2D589-1C2F-4FEE-82F6-AFD2579BEB8A`) appeared in that response (`0d7af021-e8a8-40bc-bae3-8f706bc75d8e`). The planner validated the exact signal ID and exact place name. It did not grant a creator bridge from the search direction.

| Search direction | Raw hits | Distinct channels in query | Returned channel IDs after within-query deduplication |
|---|---:|---:|---|
| Folk music camping documentaries 21st century | 12 | 11 | `UCnniUmgeeFG6Bcir8ootwRQ`, `UCDH8vDwTlh8fzyvqke_NEIQ`, `UCchdMh2nwfH_wU6i276FQmA`, `UCTN4h3PP9a3_EyC1kzfulqg`, `UCUWgo-Vtzfz_oH2yqMJqaCA`, `UCg4DI_xYh1SwqDbvyEbKK9w`, `UChujtvnG16kriwFi7DyNrQw`, `UC2U4oSgmwIsAQ8iwL5vVolQ`, `UCMbiN_9V01_LJrmsyHCO3zA`, `UCzbdwhywqZABXE0wyuJRrKw`, `UCeXYbpOvVX4huMMttMxjXxQ` |
| Female protagonist road trip friendship nature documentary | 12 | 11 | `UCcBp_9YPyma4c3HTadmRJ3Q`, `UCcjtAhoiYUnHP9-Tw01gZ-g`, `UCW0aZJEFmITJRLb0IWMqESg`, `UCIziMpdNn_ni6mhXo0BrYhA`, `UCaSp7ZhCZRDq0W8wXxOg_hA`, `UC0DbjCJIr2kZ6oaXEHSr5GQ`, `UC_IRYSp4auq7hKLvziWVH6w`, `UCsJ_ndX9MKprtGcD0glG_pg`, `UC3MJVwoumJMTqCe9IaEhtiw`, `UC5wLOl78s9ESYeHWPcuhRzg`, `UC4erRQuMzptu9MpkObbknBw` |
| Inexpensive women-owned campgrounds near Half Dome | 12 | 11 | `UCE3uBK9lvf5sc_GkgAac4Ew`, `UCBwAtbWFquv9_wEp1ObnopQ`, `UCOgjuLu9seNqgA181jEy27Q`, `UCdwRPtvg55RfbiH5mJ1uIJA`, `UCwZcNfPpV9CXSVbpH1ckVmw`, `UCmkY3pUj-_-pd2fcLj2TdFQ`, `UCjGNpX42QLX8OYBLrEJ_Uhg`, `UC0NcdseSn2mpj_nF5JZ-hPQ`, `UCH0-qj4iZCzcKzw-MuV65uw`, `UCmrnkorxHqQ-8kFPI5QiRtg`, `UCok54whZY4sB7orZ-bHsbnA` |
| Indie music and beet salad at national park picnics | 0 | 0 | None |

There were 33 distinct valid returned channel IDs and no cross-query duplicates. Round-robin selection kept the first 15. Their screening decisions were:

| Channel (official channel ID) | Country | Decision |
|---|---|---|
| Fandabi Dozi – Tom Langhorne (`UCnniUmgeeFG6Bcir8ootwRQ`) | GB | Test-only US filter |
| Nature on PBS (`UCcBp_9YPyma4c3HTadmRJ3Q`) | US | Organization excluded |
| Joe Houston (`UCE3uBK9lvf5sc_GkgAac4Ew`) | US | Assessed; creator identity unknown |
| bol etus (`UCDH8vDwTlh8fzyvqke_NEIQ`) | Unknown | Test-only US filter |
| AeroMint Drama (`UCcjtAhoiYUnHP9-Tw01gZ-g`) | US | Assessed; creator identity unknown |
| Libby & Alex – Fulltime Travel Couple (`UCBwAtbWFquv9_wEp1ObnopQ`) | Unknown | Test-only US filter; no negative finding about location or creator identity |
| TrueScaryStories (`UCchdMh2nwfH_wU6i276FQmA`) | Unknown | Test-only US filter |
| Bloom Romance TV (`UCW0aZJEFmITJRLb0IWMqESg`) | US | Organization excluded |
| Jacey Out West (`UCOgjuLu9seNqgA181jEy27Q`) | US | Assessed; creator identity unknown |
| The Human Craft (`UCTN4h3PP9a3_EyC1kzfulqg`) | US | Assessed; creator identity confirmed |
| Moonveil Drama (`UCIziMpdNn_ni6mhXo0BrYhA`) | US | Organization excluded |
| Azure MacCannell (`UCdwRPtvg55RfbiH5mJ1uIJA`) | US | Assessed; creator identity unknown |
| `UCUWgo-Vtzfz_oH2yqMJqaCA`, `UCaSp7ZhCZRDq0W8wXxOg_hA`, `UCwZcNfPpV9CXSVbpH1ckVmw` | Not inspected | Left as leads after the five-packet test limit |

All **five** assessed channels had complete **20/20** latest-upload metadata analysis, yielding **100/100** analyzed sampled videos. Eight selected caption attempts were recorded across three channels: seven available and one transient retrieval error. The other two channels stopped at `no_useful_video`. The assessed channels' cultural observations were Joe Houston: camping/glamping mentions; Jacey Out West: national-park souvenir, Bryce Canyon and Grand Staircase-Escalante; The Human Craft: historical craft and cultural terms; the remaining two had no retained cultural signal. None had an observed Half Dome reference in the representative sample or selected captions. Bryce Canyon resolved as a Qloo place but **failed the Hipcamp pair recommendation**; other named phrases were ambiguous or unsupported. No Qloo creator bridge was frozen. No commercial claim was researched or asserted from these results.

The worker saved five v4.0.1 `insufficient_evidence` snapshots before test-user cleanup: Joe Houston, AeroMint Drama, Jacey Out West, The Human Craft and Azure MacCannell. Each had **C=null, R=null, G=.75, no display score**. Four also lacked confirmed independent creator identity; The Human Craft passed identity but had no supported pair bridge. Group counts: **eligible 0, conditional 0, insufficient 5**. Official YouTube ledger delta: **4 search, 22 shared** requests. The run was partial due evidence, not a YouTube quota stop or metadata extraction failure.

## Discovery conclusion and title-evidence audit

The initial bottleneck was specific: Hipcamp's tag response mixed cultural and unrelated place attributes, while the tag-only planner never used its named Half Dome relation. The correction reached a named-place search, but its query combined Half Dome with `inexpensive` and `women-owned` constraints and mostly retrieved organizations, uncertain operators, or creators whose latest samples addressed different subjects. Search-hit relevance alone did not establish recurring creator content or a Qloo bridge. No candidate was inserted or promoted to obtain a score. A more focused creator-video query and better independent identity evidence are possible next investigations; this checkpoint does not claim they would yield a score.

The direct Hipcamp × Through My Lens positive control remains **eligible 50/100**, with C=.75, R=.25, G=.75. Its frozen partner bridge cites the official [Half Dome Hike in Yosemite: My Honest Review](https://www.youtube.com/watch?v=TBMurjUZHLA) title and the Qloo exact place/pair records. The title presents Half Dome as the explicit video subject, not a navigation label or passing keyword. The already cached official description independently says the video walks through the hike section by section, from trailhead to summit and back, but that description was **not** the frozen observation basis. Under v4 §5, one source-backed named relationship supports C=.75; under §6.1, one isolated title-grounded video supports only R=.25. The score is thus not evidence of sustained Half Dome coverage. No scorer formula, rating anchor or eligibility gate changed.

Focused named-planner provenance fixtures, creator v4 fixtures, signed-in creator worker/reuse/expiry/RLS fixture, TypeScript checks and production build passed. The signed-in fixture printed success but held a database pool open and was stopped after its assertions.
