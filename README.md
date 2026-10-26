# CrossCulture

**Find the brand partner your customers already love — and the exact product bundle to launch with.**

CrossCulture is a research agent for direct-to-consumer brands. You pick one of your own products and a goal (a two-brand **product bundle** or a **cross-sell**). The agent uses Qloo's taste graph to find brands whose audiences share your audience's taste, checks each candidate's real store, finds the exact partner products that work with yours, judges every pairing against verified product facts, and writes a partnership proposal grounded in what both audiences love.

- Live app: `https://culture-circle.vercel.app` (sign-in required; judges receive a demo account with the submission)
- Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/)

---

## 1. Problem

Small and mid-sized brands grow through collaborations — co-branded bundles, "customers also bought" cross-sells, joint launches. Finding the right partner is slow and mostly guesswork:

- **"Similar brand" lists find competitors, not partners.** A cookware brand needs a dinnerware partner, not another cookware brand.
- **Product fit alone isn't enough.** A blanket and a duffle bag go together, but the collaboration works only if both brands speak to the same people.
- **AI assistants guess.** Ask a language model which brands share your audience and it answers from popularity and press coverage. It cannot know what a brand's audience actually loves.

CrossCulture answers two questions together, with evidence for each: **will these two audiences care about each other** (Qloo), and **do these exact products work together** (live store data plus a checked judgment).

## 2. What it does

1. **Choose your brand, market, goal and one product.** The agent confirms the brand's official website and Shopify store before anything else.
2. **Discover culturally related partners.** Qloo recommends brands using your brand as the only taste signal; each candidate's identity and store are verified.
3. **Research real products.** The agent screens each partner's live catalog, plans searches for complementary products, and selects exact partner products and variants.
4. **Judge every pair.** A model proposes how the two products work together; the server checks every cited fact against the product pages, a separate rubric and an objective judgment must agree, and weak or generic pairings are rejected.
5. **Explain the cultural fit.** Each recommended partner shows why the brands belong together, from Qloo: the taste link, **who both brands resonate with**, and the cities where both audiences are strongest.
6. **Write the proposal.** One click produces an editable partnership proposal built only from verified facts, ready to copy or download.
7. **Learn.** Research memory makes later runs faster for everyone; your "Good fit" / "Not a fit" feedback shapes your next run.

Example result (Rumpl × United by Blue, Bundle):

> **Rumpl Original Puffy Blanket + United by Blue (R)evolution™ 55L Carry-On Duffle** — *Recommended*
> **Why it fits:** The packable blanket is stored and protected in the water-resistant duffle during an outdoor trip.
> **Cultural connection:** People who like Rumpl also tend to like United by Blue. Both brands resonate with environmental advocates and sustainability advocates.
> **Where audiences overlap:** the metros that rank highly for both brands.

## 3. How Qloo is used, and why

Qloo decides **who the partner is** and **why the two brands belong together**. Shopify product data and a checked model judgment decide **which products, and why they work together**.

| Step | Qloo capability | Why it fits the problem |
|---|---|---|
| Resolve your brand | `describe` (MCP) | Anchors research on Qloo's actual brand entity, not a name guess. |
| Discover partners | `recommend`, brand → brands, your brand as the only signal (MCP) | Finds taste-adjacent brands across categories — partners, not competitors. Every suggested partner starts here. |
| Cultural gate | the partner must appear in that unconstrained recommendation | A pair cannot be *Recommended* without a real Qloo taste link. |
| Who both brands resonate with | type-filtered tag insights per brand: lifestyle, customer identity, customer segment, influencer appeal | The pair-specific "why": shared audience descriptors that only taste data can supply. |
| Where audiences overlap | `where_popular` for both brands | Concrete launch markets for ads, local creators or a pop-up. |
| Compare Two Brands | `rank`, a reverse recommendation check, and shared tags | Tests a partner the user already has in mind. |

All Qloo calls go through the official harness (`@qloo/qloo-harness`, MCP over stdio) except one: the harness's tag workflow has no tag-type filter, so the audience-tag request is sent directly to the same `/v2/insights` endpoint on the event gateway with the event credential. Qloo responses are cached privately per user.

**Grounding rules for cultural claims**

- A tag counts as shared only when Qloo returns it for **both** brands in **separate** requests.
- **Near-universal tags are never shown.** In a check of 16 brands, "folk music" was carried by 12 and "women-owned" by all 16; a Qloo popularity cutoff (0.9995) and a test across 11 brands removed generic music, film and dining genres entirely.
- **Core to both brands.** A shared audience tag is shown only when it is in the top half of each brand's Qloo list, ordered by the weaker of the two positions, so it must be strong for both brands. Segments naming children ("Toddlers") describe parents and are never presented as the audience.
- **Products never create a connection.** Products are never sent to Qloo as a signal; product text only decides which of the qualifying tags is shown first.
- **Wording stays honest.** "Both brands resonate with …" describes aggregate taste associations — never "shared customers", demand or sales.
- **Cultural explanation never changes a verdict or the ranking.** A weak product pair is not rescued by a good story.

## 4. Request-to-result walkthrough (redacted)

Run: **Rumpl**, United States, **Product bundle**, starting product *Original Puffy Blanket – Grand Teton*. Qloo entity IDs are shortened; no credentials or user data are shown.

1. **Resolve the brand** — `qloo_describe { entity: "Rumpl", type: "brand" }` → Qloo brand `589F…` with an official website. The website's homepage names the brand and exposes a Shopify storefront (`/.well-known/ucp`), so the identity is verified.
2. **Discover partners** — `qloo_recommend { target_type: "brand", signals: ["589F…"], limit: 12 }` → 12 brands, including United by Blue, Smartwool, Ibex, Royal Robbins and Toad&Co. *Choice:* brand entities only, a single-brand signal, no tag filters, so the result is Qloo's own taste link rather than one we steered.
3. **Verify each partner** — homepage name match and Shopify storefront for each lead. United by Blue passes; several leads fail honestly (a domain that does not exist, a store that blocks access).
4. **Research products (Shopify Storefront Catalog, live)** — the agent screens United by Blue's catalog against the blanket, plans searches ("waterproof gear sack", "compact camping pillow", …), selects exact products and variants, and judges each pair. Ten pairs are assessed; three are recommended: the 55L Carry-On Duffle, the Reusable DIY Cleanup Kit and the 1L Go-Anywhere Bag.
5. **Explain the culture** — per brand: `GET /v2/insights?filter.type=urn:tag&signal.interests.entities=<brand>&filter.tag.types=urn:tag:lifestyle:qloo,urn:tag:customer_identity:qloo,urn:tag:customer_segment:qloo,urn:tag:influencer_appeal:qloo&take=30`. *Choice:* audience and lifestyle tag types only — a brand's unfiltered top tags are dominated by near-universal ones (payment cards, "women-owned", folk music). Rumpl and United by Blue both carry, in the top half of their lists, *environmental advocates* and *sustainability advocates*; across 11 brands checked, most shared audience tags were carried only by the pair itself. The same rule on other categories:

   | Pair | Category | "Both brands resonate with …" |
   |---|---|---|
   | Rumpl × United by Blue | outdoor | environmental advocates and sustainability advocates |
   | Everlane × Cuyana | apparel | conscious consumers and minimalists |
   | Glossier × Summer Fridays | beauty | professional makeup artists and beauty enthusiasts |
   | Wild One × BarkBox | pets | animal lovers |
   | Caraway × Arhaus | home | women's fashion and free-spirited individuals |

6. **Launch areas** — `qloo_where_popular` for both brands within the United States; metros present in both lists become "Where audiences overlap".
7. **Result** — a recommended card per partner, with alternative combinations, current prices and stock, potential challenges, and a proposal on request.

**What this does not establish:** Qloo associations are aggregate taste affinities, not evidence of shared customers, partner interest, demand or sales. Prices, stock and shipping are checked live but are not a negotiated deal.

## 5. The agent

CrossCulture is an orchestrated research agent: code controls the sequence, budgets and stopping rules; models plan and judge inside it; every claim is checked against a tool result.

| Part | Role |
|---|---|
| Tools | Qloo (MCP harness), Shopify Storefront Catalog (Shopify UCP, MCP over HTTPS), Tavily web search (identity fallback and public-source review of a saved partner) |
| Planner (model) | Screens partner catalogs, plans product searches, selects candidate products |
| Judge (model, separately prompted) | Proposes a product mechanism, then a rubric and an objective judgment classify it; the server verifies every cited passage and applies deterministic rules |
| Budgets and stops | Per-partner and per-run Catalog call limits, time limits, early stops once enough distinct good pairs are found |
| Memory | Shared research memory (proven partners first, dead ends skipped, decisions reused) and per-user feedback |

Model: Qwen3-Next 80B on AWS Bedrock (configurable; an OpenAI-compatible endpoint also works). On a 72-pair synthetic benchmark, three repeats each, the judge passed 90% of good pairs and none of the 38 bad pairs.

### Learning

- **Shared research memory (all users):** partners that produced recommended pairs for similar products are researched first; partners with no website or Shopify store are skipped for 7 days; recent catalog screens and judged rejections are reused. Only store identifiers and public Shopify taxonomy categories are kept — no user, brand or product content.
- **Personal feedback (your next run):** "Not a fit" hides those two products from you again (any colour or size); "Already working with them", "Not right for my brand" or "Partner not credible" drops that partner from future searches for your brand; partners you liked are researched first.
- **Designed next:** learning across users from consensus (20 or more distinct brands, 70% or more agreement, monthly), and a monthly judge update that switches on only if the benchmark does not regress.

## 6. Architecture

```
Browser (Next.js, Vercel)
   │  Supabase Auth session
   ▼
API (AWS Lambda) ── verifies the user, queues runs, serves results and proposals
   │  invokes
   ▼
Research worker (AWS Lambda) ── runs one research job
   ├─ Qloo  (@qloo/qloo-harness MCP + /v2/insights tag request)
   ├─ Shopify Storefront Catalog (UCP)
   ├─ AWS Bedrock (planner and judge)
   └─ Tavily (selective web search)
   ▼
Supabase Postgres ── projects, runs, opportunities, assessments, proposals,
                     feedback, private per-user Qloo cache, shared research memory
```

Security and data handling:

- Provider keys and the database URL are server-only; the browser receives only Supabase's publishable values.
- Row-level security on user data; the research memory and review tables are server-only.
- No Shopify product content is stored: opportunities keep product and variant identifiers, and product details are fetched live when shown.
- Public fetches are restricted to HTTPS on public addresses, with DNS pinned per request.

## 7. Repository layout

| Path | Contents |
|---|---|
| `web/` | Next.js app (research setup, results, proposal studio) |
| `api/src/` | API, research worker, Qloo, Shopify Catalog and model adapters, assessment and memory |
| `api/scripts/` | Offline checks (`npm test`) and Lambda packaging |
| `api/fixtures/` | Labelled pair benchmarks used by the checks |
| `supabase/migrations/` | Database schema |
| `infra/aws/` | Lambda deployment scripts and IAM policies ([guide](infra/aws/README.md)) |
| `CrossCulture_Brand_Brand_Architecture_v2.2_Clarified.md` | Research workflow specification |
| `CrossCulture_Brand_Brand_Scoring_Engine_v1.1.md` | Assessment and ranking rules (no composite score) |

## 8. Setup from a clean environment

**Prerequisites**

- Node.js 22.19 or newer, and npm
- A Supabase project (Postgres and Auth)
- A Qloo API key (for the hackathon: the event credential and gateway)
- AWS credentials with Bedrock access to the chosen model (or an OpenAI-compatible endpoint)
- A Tavily API key (identity fallback and partner review)
- A public HTTPS URL serving `web/public/ucp-agent-profile.json` (Shopify's Catalog requires a hosted agent profile; deploying the web app provides one)

**Steps**

```sh
git clone https://github.com/Huzaifa-Aqeel/culture-circle.git
cd culture-circle
(cd api && npm ci)
(cd web && npm ci)
cp .env.example .env.local          # server settings
cp web/.env.example web/.env.local  # public Supabase settings and API URL
```

1. Fill in `.env.local`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `QLOO_API_KEY`, `QLOO_BASE_URL`, `TAVILY_API_KEY`, `SHOPIFY_UCP_PROFILE_URL`, and the model settings (`LLM_PROVIDER=bedrock`, `AWS_PROFILE`, `AWS_REGION`, `BEDROCK_MODEL_ID`). Leave `RESEARCH_WORKER_FUNCTION_NAME` empty locally; the API then runs research in the same process.
2. Fill in `web/.env.local` with your Supabase URL and publishable key; keep `CROSSCULTURE_API_URL=http://127.0.0.1:8787`.
3. Apply the migrations in `supabase/migrations/` to your database in filename order (for example `npx supabase db push` with the Supabase CLI linked to your project).
4. Start both apps:

   ```sh
   (cd api && npm run dev)   # API and research worker on :8787
   (cd web && npm run dev)   # web app on :3000
   ```

5. Open `http://localhost:3000`, sign up, and start a search at **New research**. Use US brands that sell through Shopify; a run usually takes 2–5 minutes.

**Checks**

```sh
(cd api && npm test)             # offline checks; no provider calls or credentials
(cd web && npx tsc --noEmit && npm run build)
```

**Deploy:** the web app runs on Vercel; the API and research worker run on AWS Lambda — see [infra/aws/README.md](infra/aws/README.md).

## 9. Known limitations

- **Qloo coverage.** Brands without an exact Qloo brand entity cannot be researched (Fellow, Fishwife and Fly By Jing were not found during testing).
- **Shopify only.** Partners must sell through a Shopify storefront that exposes the Storefront Catalog; others are skipped, and some sites block automated access.
- **Partner relevance varies.** Qloo's recommendation scores for a brand's top partners are nearly flat, and many suggested brands sell unrelated products (clothing for a blanket, fashion for a pan). The catalog screen removes them, but some runs end with only one recommended partner.
- **Audience tags are Qloo's inference.** "Both brands resonate with …" is shown only when a tag is core to both brands, but Qloo's audience descriptors are aggregate associations and can be surprising (Caraway and Arhaus share "women's fashion"). Brands with no shared core tag show the taste link and overlap cities only.
- **Judge accuracy is measured, not proven.** The benchmark is 72 synthetic pairs labelled by an AI reviewer, plus three real pairs labelled by a person. It shows the judge rejects bad pairs reliably; it is not a field accuracy figure.
- **No demand evidence.** Results identify plausible, verified opportunities; they do not establish partner interest, customer demand or sales.
- **Run time.** A run takes 2–5 minutes and can end early at a time or call limit, with a note that the review covered a sample.
- **Cross-user learning is designed, not built.** Shared research memory and personal feedback learning are live; learning from many users' feedback awaits real traffic.
- **Tested in the United States.** Other markets are supported in the setup but have had little live testing.

## 10. License

Released under the MIT License — see [LICENSE](LICENSE).

## Acknowledgments

Taste data from [Qloo](https://www.qloo.com/) via the [Qloo hackathon kit](https://github.com/qloo/qloo-hackathon-kit). Product data from Shopify's Storefront Catalog. Built with Next.js, Supabase and AWS.
