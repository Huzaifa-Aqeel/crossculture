# Hipcamp primary creator discovery relevance audit, 15 October 2026

This report uses one bounded signed-in live discovery after planner v3 and initial anchor ordering, plus a read-only replay of its cached official search responses after the final ordering fix. No creator was supplied to the live workflow. The temporary test user and its rows were deleted after the runner copied the evidence summary; raw transcripts were not saved or printed. The JSON trace is `/tmp/hipcamp-creator-discovery-v3-live.json` in the local workspace environment.

## Earlier 33-channel run: demonstrated selection miss and R/G diagnosis

The previous four searches returned 11, 11, 11 and 0 distinct channels (33 total, no cross-query duplicates). Round-robin selection retained 15. The Half Dome search was `inexpensive women-owned campgrounds near Half Dome`, combining unrelated Qloo attributes. Its sixth channel was **She Dreams of Alpine**, discovered through [a Half Dome backpacking episode](https://www.youtube.com/watch?v=RNWQwrfQQfg). The title presents Half Dome as the episode subject; the channel's official description self-identifies an outdoor backpacking educator. It was outside the 15-lead round-robin ceiling and was never assessed. The eighth hit was a Half Dome sleeping-bag product, not evidence of a creator cultural subject. Of the selected 15, five were assessed, three were organizations, four were stopped by the old test-only channel-country filter (one GB and three unknown), and three were not inspected after the five-packet test ceiling. Production retains unknown market status for review.

All five earlier assessed candidates had complete 20/20 metadata extraction and G=.75, but no frozen Qloo pair bridge or linked creator activity, so R=null before v4 assessment. The temporary source rows were deleted, and the earlier JSON report did not include their capability source IDs. Thus the precise video supporting each earlier G=.75 cannot now be reverified; the current code selects a source-backed demonstrated format or production expertise for `content_creation_capability`. This is a historical trace gap, not proof that the capability was absent.

| Earlier creator | Observed culture and Qloo outcome | Exact reason R was null |
|---|---|---|
| Joe Houston | Camping/glamping, `AMG Camping Club` and related phrases were ambiguous or unsupported for Hipcamp. | No admitted pair bridge; zero bridge-linked sample activities. Identity also unverified. |
| AeroMint Drama | No retained cultural signal from its analyzed sample. | No admitted pair bridge or linked activity. Identity unverified. |
| Jacey Out West | Bryce Canyon resolved as a Qloo place but failed Hipcamp pair projection; other places were ambiguous or unsupported. | No admitted Hipcamp pair bridge or linked activity. Identity unverified. |
| The Human Craft | Historical/craft references were ambiguous or unsupported for the Hipcamp pair. | Creator identity passed, but no admitted pair bridge or linked activity. |
| Azure MacCannell | No retained cultural signal from its analyzed sample. | No admitted pair bridge or linked activity. Identity unverified. |

## One bounded live v3 run

The planner used real Qloo named-place results with exact IDs and the private response ID `9108bf45-37ec-4dfe-9f9f-baea1544b6d2`. It produced two short named directions and two distinct tag directions. A named direction is a search hypothesis; the creator still needs its own observed subject and a separately validated Qloo pair bridge.

| Search | Qloo anchor | Raw hits | Distinct channels |
|---|---|---:|---:|
| `Half Dome hike` | Half Dome, `0BF2D589-1C2F-4FEE-82F6-AFD2579BEB8A` | 12 | 11 |
| `Glacier Point backpacking` | Glacier Point, `B28795F3-4874-4E1F-B7B2-CF127F4B54A3` | 12 | 12 |
| `indie film female protagonist friendship national park` | Three supplied cultural tag IDs | 12 | 12 |
| `women-owned outdoor retreats documentary` | Women-owned and documentary tag IDs | 12 | 11 |

There were **46 distinct channels** after two within-query duplicates and no cross-query duplicates. Fifteen were selected under the global lead ceiling. One organization (Pixar) was excluded; five channels received 20/20 latest-upload metadata analysis and frozen v4.0.1 assessments; nine selected leads were not inspected after the five-packet test ceiling. Four assessed channels had official `US` country; Florian Singler's country was unverified and was retained for review. Five selected-video captions were available across OWN and California Through My Lens. Official YouTube ledger delta: **four search and 16 shared requests**. All five assessments were saved as `insufficient_evidence`; eligible 0, conditional 0, scored recommendations 0.

| Assessed channel | Search hit | Identity / Qloo review | R and G source result |
|---|---|---|---|
| Molly Rose Outdoors | [Half Dome hike](https://www.youtube.com/watch?v=lM_3KGMzvOw) | Independent operator unverified. Sample references Pacific Crest Trail/Yosemite; Sierra City resolved but Hipcamp pair projection was unsupported. | No frozen bridge or linked sample activity, R=null. G=.75 from [source video](https://www.youtube.com/watch?v=jDptggjHUGg). |
| Backpacking Grub | [Glacier Point backpacking](https://www.youtube.com/watch?v=NvrrbUTg2Tc) | Operator unverified. `Trail magic` pair projection unsupported; another trail phrase ambiguous. | No frozen bridge/activity, R=null. G=.75 from [source video](https://www.youtube.com/watch?v=kANHZjGVMaw). |
| OWN | [retreat search hit](https://www.youtube.com/watch?v=j1wRUR0j_RA) | Classifier returned unknown, so identity was withheld. Entertainment references did not project to a Hipcamp pair. | No frozen bridge/activity, R=null. G=.75 from [source video](https://www.youtube.com/watch?v=l8SBfgkl9j8). |
| Florian Singler | [Half Dome hike](https://www.youtube.com/watch?v=rTT5g9KTvR0) | Operator and US country unverified; no retained named cultural signal in latest sample. | No frozen bridge/activity, R=null. G=.75 from [source video](https://www.youtube.com/watch?v=r_qUFZCnnlQ). |
| California Through My Lens | [Glacier Point search hit](https://www.youtube.com/watch?v=oAS7mSAuqj0) | Independent creator and US country verified. Latest sample and four selected captions named other places/events; all were ambiguous or unsupported for the Hipcamp pair. | No frozen bridge/activity, R=null. G=.75 from [source video](https://www.youtube.com/watch?v=DZI5lU85DYo). |

Each G source above is a frozen `personal_item` capability reference in that candidate's v4 evidence packet. It supports `content_creation_capability` for the chosen `content_collaboration` goal. It does not establish a cultural bridge or R. The run had no failed metadata batches or candidate errors. Its five `R=null` values came from absent admissible bridge-linked activity in the extracted source material, not a failure to freeze a verified bridge or a scorer-input loss. Source material might still contain unobserved context; this run makes no negative claim about every video the creator has published.

The corresponding cached official video titles are, in table order: **Day 83 | Beautiful Tuolumne Meadows | SOBO Pacific Crest Trail 2026**; **New Backpacking Gear! New Tent, Pillow, Tent Stakes And Other Items**; **Official Trailer: The Christmas Showdown 2 | OWN for the Holidays**; **INSANE MOUNTAIN FOREST LAKE TRAIL RUN**; and **I Took a $15 Train Into LA from the Inland Empire**. The frozen packets prove source membership and direct-capability classification. The temporary source rows containing the precise extracted `demonstratedFormats` text were deleted, so that underlying model phrase cannot be independently audited now. A later live test should export that validated basis before cleanup. OWN's G reflects production of a trailer, while its independent-creator identity remains unverified and its assessment unscored.

## Discovery-hit continuity and final ordering replay

All five assessed candidates had a discovery-hit video **outside** their latest-20 sample. The adaptive transcript chooser received each with `sourceRole=discovery_hit`; its latest-20 sample stayed at 20 videos. It selected other videos or stopped with `no_useful_video`, so this live run does not demonstrate a successful caption extraction from a discovery hit. The separate source-role and out-of-sample scoring fixtures passed. A discovery hit never increments representative-sample frequency.

The new `Half Dome hike` search itself returned the previously verified direct positive-control video, [Through My Lens: Half Dome Hike in Yosemite](https://www.youtube.com/watch?v=TBMurjUZHLA), at search rank six. The initial equal-priority anchor ordering still left this channel outside the 15 selected leads and five researched packets. This was a demonstrated ranking defect, so the final production ordering now places exact named-subject activity titles before generic anchor mentions, then rotates across directions. It does not award C, infer creator identity or discard cross-category leads. A read-only replay of the **same cached 46 results** selects Through My Lens fifth overall and second in the Half Dome queue, within the five-packet screen after Pixar's organization exclusion. The replay made **zero additional YouTube searches**. This corrected selection has not yet run through a new live evidence-freeze/v4 discovery assessment; the direct 50/100 result cannot be counted as a discovery result.

## Outcome

Focused planner, anchor-selection, named Qloo, transcript source-role, creator v4 and signed-in worker fixtures passed; the Next production build and TypeScript check passed. Query specificity improved and the returned known relevant channel is now selected in cached replay. **Autonomous scored discovery remains unverified after the final ordering correction.** The live run's actual saved results were five honest insufficient-evidence assessments. No identity or Qloo bridge rule, v4 rating, provider, table or retention rule changed.
