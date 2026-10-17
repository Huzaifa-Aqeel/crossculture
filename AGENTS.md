# CrossCulture agent rules

## Project authority

- `CrossCulture_Functional_Requirements_v1.7.md` is the approved product, provider, data, and workflow specification.
- `CrossCulture_Scoring_Engine_v4.md` alone defines scoring: one evidence-based Collaboration Opportunity Score explained by Cultural Connection, Content/Business Relevance, and Goal Fit ratings, plus eligibility, confidence, and ranking. Do not create or extend a competing scoring algorithm.
- Keep one implementation plan in `BUILD_PLAN.md`. Check both the FR and `progress.md` before implementation, map completed and remaining work to FR v1.7, and record substantial checkpoints in `progress.md`.
- Verify actual migrations and runtime behavior before relying on historical table counts or feature names in the FR. Preserve existing data and user-authored writing during migrations.

## Provider and test boundaries

- Use only official YouTube Data API v3 for YouTube search, channel information, and video metadata; use only the isolated `youtube-transcript` npm adapter for optional selected-video subtitles. Do not add another YouTube scraper, transcript retriever, or video-analysis provider. Failed subtitles must leave metadata research usable.
- Keep YouTube metadata in the permitted shared provider cache for at most 30 days across cache/evidence/snapshots. Process raw transcripts only in memory; never persist, cache, log, or export them. Keep structured transcript-derived observations with video IDs, timestamps, and source references for at most 15 days in existing records, with dependent research marked for review on expiry. Do not add transcript-specific tables; keep the YouTube quota ledger.
- Complete the Brand × YouTube path with source-backed creator categories, Qloo-resolved cultural bridges, partnership assessments and comparable ranked recommendations. Submit validated frozen evidence only to the adopted Scoring Engine v4; group eligible and conditional scored results separately, and withhold scores for insufficient-evidence or excluded outcomes. Current runtime creator results are partial and unscored, which is an implementation gap rather than the product target. Do not restore the removed approval flag or introduce an alternate scorer.
- Preserve both Find Collaborators paths (Qloo brand candidates; Qloo-grounded YouTube search directions and actual API-discovered creators) and Compare Specific Partners for both pair types. Direct comparison skips broad discovery and reuses research and assessment components. Qloo, Wikidata, selective web research, and the existing LLM keep their separate roles.
- Qloo response caching is private per user. For Qloo-related implementation, inspect the local Qloo hackathon kit first, then official Qloo documentation if needed. Avoid unnecessary live provider calls.
- Use US brands and US YouTube creators in live tests. Keep sample data visibly labeled and never present it as live evidence. Provider keys stay server-only.

## Working process

- Read the request in context of the approved FR and current code. Ask for guidance when a genuine contradiction affects implementation and cannot be resolved from the user's decisions.
- Reason independently about architecture and share material design changes with the user before implementing them.
- Keep governing docs deduplicated and current. Update `progress.md` after substantial work with what is built, tested, partial, and still planned.

## Codebase Navigation — Graphify

- Before major refactoring, architectural changes, or cross-module
  modifications, check for `graphify-out/graph.json`.

- If the graph exists and reflects the current codebase, query it
  to identify relevant modules, dependencies, callers, and affected tests.

- If source code has changed since the last graph update, refresh it
  incrementally using `graphify . --update`.

- Prefer querying the existing graph over repeatedly exploring
  the entire repository.

- Verify important graph findings against actual source code.
  Never treat inferred relationships as verified facts.

- After completing a major implementation milestone, update the
  graph so future sessions have current architectural information.

- Do not regenerate the graph for trivial changes.

## Customer-facing product language:
- The app should feel like a polished partnership planning product. Use clear labels     such as “Cultural connections,” “Why it fits,” and “Potential challenges.” Do not show API/vendor names, raw identifiers, tool calls, agent plans, debug traces, model terminology, or explanations of how feedback changed the system in the customer UI. Keep technical provenance in server records and a developer-only trace for hackathon verification. Show source links and honest limits in plain language
