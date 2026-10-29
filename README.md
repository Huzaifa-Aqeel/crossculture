# CrossCulture

**Find brand partners whose customers already like you, and the exact products you could sell together.**

CrossCulture helps a consumer brand plan product bundles and cross-sells with another brand. You pick one of your products. The app uses Qloo to find brands your audience already likes, checks those brands' live Shopify stores for products that genuinely work with yours, and shows the strongest pairs with the reasons behind them. You can also name a brand you already have in mind and compare the two directly.

**[Try the live app](https://culture-circle.vercel.app/)** · Sign-in is required; judge access is provided privately with the hackathon submission.

## The problem

A brand that wants a partner for a bundle or cross-sell has two questions to answer:

1. **Would my customers care about this brand?** Partnerships work when both brands share a core customer but do not compete.
2. **Do our products actually belong together?** A good bundle does one job together, such as a blanket and the bag that carries it, not two unrelated items with a discount.

Today this is manual. Searching by product category mostly finds competitors (a coffee maker search returns other coffee makers), and the best partners are often in a different category entirely. Checking every candidate's store and products by hand does not scale.

## The solution

CrossCulture answers both questions in one research run:

1. **Choose your brand, market, goal (Bundle or Cross-sell) and starting product.** The app confirms your brand and its Shopify store.
2. **Find partners.** Qloo recommends brands from your brand's taste profile, across categories. The app also asks Qloo for brands your audience likes within categories that suit your product, for example coffee brands for a coffee maker.
3. **Check real products.** For each partner, the app confirms its official store, searches its live catalog for items that work with your product, and assesses exact products and variants.
4. **Keep only strong pairs.** A **bundle** is recommended only when the two items do one job together (a bag carries the blanket, a strainer drains what the pot cooked). A **cross-sell** must meet a separate practical need, or complete the same routine, scent or look that both products' own descriptions name (a conditioner after a shampoo, a body oil in the same scent as a perfume). Both products are verified, and competitors, look-alikes and mood-only pairings are filtered out.
5. **Review and act.** Each result shows why the products fit, the cultural connection, cities where both audiences are strong, current prices, and open questions. A result can become an editable partnership proposal.
6. **Rate the results.** Your ratings shape your next runs for the same brand.

### Ratings that shape the next run

Each result can be rated once, and the reason you give decides how far the rating reaches:

| Rating | What changes next time |
|---|---|
| **Good fit** | That exact product pair is re-checked first and shown at the top, and the partner is researched earlier. |
| **Not a fit** · *products don't go together* | That pair is never shown again; the partner's other products can still appear. |
| **Not a fit** · *not right for my brand*, *already working with them*, *not credible* | That partner is skipped for your brand. |

Ratings are personal: they change your own runs, not other users' results.

### Example

In a US Bundle run for Rumpl's *Original Puffy Blanket – Grand Teton*, Qloo's recommendations for Rumpl included **United by Blue**. The app verified United by Blue's store and found three supported combinations, including the **(R)evolution™ 55L Carry-On Duffle**, which carries and protects the blanket on a trip, and the **Reusable DIY Cleanup Kit**. Separately, Qloo's audience tags placed *environmental advocates* and *sustainability advocates* in the top half of both brands' lists, which is the cultural connection shown with the result.

## Screenshots

**Partnership recommendations** — a completed Caraway product-bundle search with product pairs, cultural context, and next steps.

<img src="docs/screenshots/recommendations.png" alt="CrossCulture recommendations for Caraway, showing product pairs with Public Goods and Brightland" width="760">

**Editable proposal** — the saved draft for a selected pairing, with product links and the evidence behind it.

<img src="docs/screenshots/proposal-studio.png" alt="CrossCulture proposal editor for a Caraway and Public Goods product bundle" width="760">

## Why Qloo

Qloo is what makes the partner list worth checking. Without it, the choice is between category search, which returns competitors, and guesswork. Qloo connects brands through the tastes of the people who like them, so it surfaces non-competing brands in other categories that share your audience: a blanket brand's audience leads to bag and outdoor brands, a cookware brand's audience to tableware and pantry brands.

| Step | Qloo request | Why |
|---|---|---|
| Identify your brand | `qloo_describe` (brand type only) | Anchors everything to the right Qloo brand entity, not a person or product with the same name. |
| Suggest partners | `qloo_recommend` with your brand as the only signal (up to 12 brands) | Brands your audience likes, across categories. These partners are described as "People who like A also tend to like B." |
| Partners for your product | `qloo_recommend` with your brand as the only signal, limited to up to two Qloo brand categories chosen for your product | Finds complements the brand-wide list misses, such as coffee brands for a coffee maker. Described as liked "among coffee & tea brands." |
| Compare two named brands | `qloo_recommend` in both directions, then `qloo_rank` with specific shared tags confirmed on both brands' own sites | A brand you name is not assumed to fit; the cultural link must be found. |
| Explain the connection | Audience and lifestyle tags for each brand (`/v2/insights`, tag types filtered) | Names who both brands resonate with, using tags prominent for both and not near-universal. |
| Where to launch | `qloo_where_popular` for each brand | Cities where both audiences are strong, as a starting point for local campaigns. |

Qloo calls go through the pinned `@qloo/qloo-harness` MCP package. The audience-tag query calls the gateway's read-only `/v2/insights` endpoint directly with the same server-side credential, because the harness does not expose the tag-type filter. Qloo responses are cached privately per user, and credentials never reach the browser.

## Run it locally

You need **Node.js 22.19+**, a Supabase project, a Qloo hackathon credential, a Tavily key, and either AWS Bedrock access or an OpenAI-compatible model endpoint. Shopify Catalog access also needs a public HTTPS URL serving the included [`ucp-agent-profile.json`](web/public/ucp-agent-profile.json).

```sh
git clone https://github.com/Huzaifa-Aqeel/culture-circle.git
cd culture-circle
(cd api && npm ci)
(cd web && npm ci)
cp .env.example .env.local
cp web/.env.example web/.env.local
```

In `.env.local`, set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `QLOO_API_KEY`, `QLOO_BASE_URL` (`https://hackathon.api.qloo.com`), `TAVILY_API_KEY`, `SHOPIFY_UCP_PROFILE_URL` and the model settings shown in [`.env.example`](.env.example). Leave `RESEARCH_WORKER_FUNCTION_NAME` empty so the API runs research in-process.

In `web/.env.local`, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and keep `CROSSCULTURE_API_URL=http://127.0.0.1:8787`. Apply the database migrations with `npx supabase db push`.

```sh
(cd api && npm run dev)   # API and research worker on :8787
(cd web && npm run dev)   # web app on :3000
```

Open `http://localhost:3000`, sign in, and try a US brand that sells on Shopify. Offline tests run with `(cd api && npm test)` and make no provider calls.

## Limits

- Results are a starting point for a partnership conversation. Qloo affinities and city popularity are aggregate signals: they do not identify shared customers, predict sales, or show that a partner is interested.
- Your brand must be in Qloo, and partners must sell on Shopify with a verifiable store.
- Each run reviews a time-limited sample of partners and products, not every catalog in full. Qloo's categories are broad, so some products (for example cookware, pet or outdoor gear) rely on the brand-wide partner list.
## License

[MIT](LICENSE) © 2026 Huzaifa Aqeel.

Built for the Qloo Agentic Hackathon
