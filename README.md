# CrossCulture

CrossCulture is a partnership planning app for finding brand partners around specific product bundles and cross-sells, and for researching creator partnerships from a brand's cultural directions. [Brand × Brand Architecture v2.2](CrossCulture_Brand_Brand_Architecture_v2.2_Clarified.md) governs the commerce workflow, and [Scoring Engine v1.1](CrossCulture_Brand_Brand_Scoring_Engine_v1.1.md) governs commerce opportunity assessment and ranking. [BUILD_PLAN.md](BUILD_PLAN.md) describes the separate Qloo-led creator research path.

## Repository layout

- `web/`: Next.js app and customer interface.
- `api/`: research API, provider adapters, workers, and focused checks.
- `supabase/`: local Supabase configuration and database migrations.
- `scripts/`: project-level development checks.
- `BUILD_PLAN.md` and `progress.md`: implementation plan and verified checkpoints.

## Local development

Install dependencies with `npm ci` in both `api/` and `web/`. Configure the Supabase project and apply the migrations in `supabase/migrations/`. Copy [`.env.example`](.env.example) to `.env.local` and [`web/.env.example`](web/.env.example) to `web/.env.local`, then add your own values. Both local files are ignored. Start the API with `npm run dev` from `api/` and the web app with `npm run dev` from `web/`.

The API requires a database connection, Supabase authentication configuration, and the relevant provider credentials for live research. Qloo research uses the separately installed `qloo` MCP command. Provider keys are server-only; only Supabase's publishable configuration belongs in `NEXT_PUBLIC_` variables. The local Qloo hackathon kit is a development reference and is not vendored in this repository.

Brand × Brand research depends on configured Qloo, Shopify Catalog, and selective Tavily access. Creator research uses Qloo cultural directions and YouTube video/content evidence without Tavily. Its private saved runs, channel metadata, and extracted observations expire after 15 days; raw transcripts are not saved. See [BUILD_PLAN.md](BUILD_PLAN.md) for the current verification state. Product-context discovery for brands absent from Qloo remains disabled until its separate live evidence gate passes.
