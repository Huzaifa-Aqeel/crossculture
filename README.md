# CrossCulture

**Find a brand partnership that makes sense for both the audience and the products.**

CrossCulture helps a brand explore product bundles and cross-sells with another brand. Start with one of your products. The app uses Qloo to find culturally related brands, checks their real storefronts for complementary products, and explains which combinations are worth discussing. You can also name a brand you already have in mind and compare the two directly.

**[Try the live app](https://culture-circle.vercel.app/)** · Sign-in is required; judge access is provided privately with the hackathon submission.

## The problem

Finding a partner means answering two questions: why might people interested in one brand care about the other, and what would their products offer together? A team must check cultural signals, verify both stores' products, and explain the combination's value across many potential partners.

CrossCulture brings those checks into one research flow. Its output is a **starting point for a partnership conversation**, not a forecast of sales or proof that either brand has agreed to collaborate.

## What happens in a search

1. **Choose a brand, country, goal, and starting product.** The app confirms the brand and its Shopify storefront.
2. **Find or name a partner.** In *Suggest partners*, Qloo recommends brands from the starting brand's taste signal. In *Compare with a brand*, you choose the second brand and Qloo helps assess the cultural relationship.
3. **Check products.** The worker verifies the partner's storefront, searches its live Shopify catalog, and evaluates specific products and variants against the chosen product and goal.
4. **Review the evidence.** Results separate the product reason, cultural connection, current offers, and potential challenges. Weak or unverified combinations are not presented as recommendations.
5. **Create a proposal.** A recommended combination can become an editable proposal with product links, supporting reasons, and points the brands still need to agree on.

### An observed result

In a hosted US **Product bundle** run using Rumpl's *Original Puffy Blanket – Grand Teton*, Qloo's brand recommendation included **United by Blue**. After storefront and product research, the app found three supported combinations with that partner, including the **(R)evolution™ 55L Carry-On Duffle**. The blanket can be carried and protected in the duffle on an outdoor trip. The run reached its research time limit after 40 Shopify Catalog calls, so it did **not** review every Qloo lead or every product in those stores.

A separate Qloo audience-tag check found *environmental advocates* and *sustainability advocates* in the top half of both brands' returned lists. These are aggregate associations, not evidence that the brands have the same customers.

## Why Qloo is essential

Qloo supplies the cultural evidence; Shopify supplies observed product and offer details. The model helps plan searches and propose a product mechanism, while server rules check whether its claims are supported. A plausible product pair alone cannot establish a cultural link.

| Product decision | Qloo evidence used |
|---|---|
| Identify the starting brand | `qloo_describe` resolves the named brand to a Qloo brand entity. |
| Suggest partners | `qloo_recommend` requests brands using **only the starting brand** as its signal, without product or tag filters. The partner must come from that response. |
| Compare two named brands | The app checks an unconstrained recommendation in either direction; if neither returns the pair, it uses `qloo_rank` and specific shared tags corroborated by both brands' public pages. A focused rank alone does not prove a relationship. |
| Explain the connection | Separate tag-insight requests for each brand can identify shared, sufficiently specific audience or lifestyle associations. |
| Suggest launch areas | `qloo_where_popular` for each brand identifies metro areas appearing in both result lists within the chosen country. These are suggested areas to investigate, not measured customer overlap. |

The app uses the pinned `@qloo/qloo-harness` MCP package for its Qloo workflows. One audience-tag query calls the event gateway's read-only `/v2/insights` endpoint directly with the same server-side event credential: the harness's tag workflow does not expose the tag-type filter needed to avoid generic tags. Qloo responses are cached privately per user. Credentials never go to the browser.

### Redacted Qloo-to-result path

For the Rumpl example, the relevant choices were:

1. `qloo_describe` resolved **Rumpl** as a brand entity; its identifier is omitted here.
2. `qloo_recommend` requested up to **12 brand entities**, with Rumpl's entity as the sole signal. United by Blue was among the returned candidates. Products were not sent to Qloo to steer this discovery.
3. Both brands were queried separately for **lifestyle, customer identity, customer segment, and influencer-appeal tags**. Shared tags were considered only when they were prominent for both brands and not near-universal.
4. The worker verified United by Blue's store and assessed actual Shopify products. A supported product combination, the Qloo relationship, and the remaining business unknowns were then shown together.

Qloo's result is evidence of aggregate taste affinity. The product pairing is CrossCulture's assessment based on observed listings; neither source establishes demand, partnership consent, or a ready-to-sell joint bundle.

## How it runs

```text
Next.js on Vercel → authenticated API on AWS Lambda → Supabase run record
                                               ↘ research Lambda → Qloo, Shopify Catalog,
                                                                 Bedrock, selective Tavily search
                                                   → results and proposals in Supabase Postgres
```

The API returns after queuing a run. A separate Lambda claims one run and writes its results; Supabase stores project and run state. Qloo credentials, model credentials, and database access remain server-side. User records have row-level security; the Qloo response cache is private per user.

For implementation detail, see the [architecture](CrossCulture_Brand_Brand_Architecture_v2.2_Clarified.md), [assessment rules](CrossCulture_Brand_Brand_Scoring_Engine_v1.1.md), and [AWS deployment guide](infra/aws/README.md).

## Run it locally

You need **Node.js 22.19+**, a Supabase project, an event-issued Qloo credential and gateway, a Tavily key, and either AWS Bedrock access or a configured OpenAI-compatible model endpoint. Shopify Catalog access also needs a public HTTPS URL serving the included [`ucp-agent-profile.json`](web/public/ucp-agent-profile.json). The Qloo harness is installed with the API dependencies; no global installation is needed.

```sh
git clone https://github.com/Huzaifa-Aqeel/culture-circle.git
cd culture-circle
(cd api && npm ci)
(cd web && npm ci)
cp .env.example .env.local
cp web/.env.example web/.env.local
```

Set the server values in `.env.local`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `QLOO_API_KEY`, `QLOO_BASE_URL` (the hackathon gateway is `https://hackathon.api.qloo.com`), `TAVILY_API_KEY`, `SHOPIFY_UCP_PROFILE_URL`, and the model settings. The examples in [`.env.example`](.env.example) show both model options. Leave `RESEARCH_WORKER_FUNCTION_NAME` empty locally so the API process runs the worker.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `web/.env.local`; leave `CROSSCULTURE_API_URL=http://127.0.0.1:8787`. Link the Supabase CLI to your project and apply `supabase/migrations/` in filename order, for example with `npx supabase db push`.

```sh
(cd api && npm run dev)   # API and local worker on :8787
(cd web && npm run dev)   # web app on :3000
```

Open `http://localhost:3000`, sign in, and try a US brand with a Shopify storefront. An individual run commonly takes a few minutes. Offline checks run with `(cd api && npm test)` and do not call live providers.

## Limits

- Qloo must resolve the brand, and the app currently researches Shopify storefronts. Some stores cannot be verified or block access.
- Research uses bounded searches and a time limit. A result is a sample of the available partners and products, not an exhaustive catalog review.
- Qloo affinities and geographic popularity are aggregate signals. They do not identify shared customers, predict sales, or establish partner interest.
- Shared research memory and personal feedback behavior are implemented in this repository. Learning a policy from many users' feedback remains planned, pending real traffic.
- Live validation has focused on US brands; other markets have had limited testing.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/), with taste data from Qloo and product data from Shopify's Storefront Catalog.
