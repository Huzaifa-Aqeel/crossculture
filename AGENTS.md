# CrossCulture agent rules

## Project authority

- `CrossCulture_Brand_Brand_Architecture_v2.2_Clarified.md` and `CrossCulture_Brand_Brand_Scoring_Engine_v1.1.md` govern Brand × Brand commerce only (`brand-commerce-v1.1`, no composite numeric score). The new Brand × YouTube creator flow is governed by the Qloo-led funnel in `BUILD_PLAN.md`. Its retired v4 workflow and historical creator records remain retired; no backward compatibility is required.
- Keep one implementation plan in `BUILD_PLAN.md`. Before implementation, check both Brand × Brand authority files, `BUILD_PLAN.md`, and `progress.md`. Map completed and remaining work to those authorities and record substantial checkpoints in `progress.md`.
- Verify actual migrations and runtime behavior before relying on old table counts or feature names. Preserve current Brand × Brand user data and writing during migrations; remove retired workflow data as directed.

## Provider and test boundaries

- Brand × Brand Find Partners and Compare Two Brands follow the Brand × Brand architecture; direct comparison skips broad discovery and reuses research and assessment components. Do not use Wikidata. Tavily remains selective Brand × Brand research only. The Brand × YouTube route uses Qloo cultural tags or typed non-person cultural entities to plan targeted YouTube video searches, then validates candidate channels with independent representative and targeted content samples. A Qloo entity is a search direction, never a channel recommendation. Do not use Tavily in this route. Store reusable public YouTube metadata, exact video details, and scoped extracted transcript observations for at most 15 days; never retain raw transcript text. Keep Qloo person recommendations out of this discovery path. Preserve private reviewed and rejected decisions for an independent creator benchmark; never synthesize reviewer labels.
- Qloo response caching is private per user. For Qloo-related implementation, inspect the local Qloo hackathon kit first, then official Qloo documentation if needed. Avoid unnecessary live provider calls.
- Use US brands in live tests. Keep sample data visibly labeled and never present it as live evidence. Provider keys stay server-only.

## Working process

- Read the request in context of the applicable authority documents above and current code. Ask for guidance when a genuine contradiction affects implementation and cannot be resolved from the user's decisions.
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
