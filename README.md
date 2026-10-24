# CrossCulture

CrossCulture is a partnership planning app for finding brand partners around specific product bundles and cross-sells. [Brand × Brand Architecture v2.2](CrossCulture_Brand_Brand_Architecture_v2.2_Clarified.md) governs the commerce workflow, and [Scoring Engine v1.1](CrossCulture_Brand_Brand_Scoring_Engine_v1.1.md) governs commerce opportunity assessment and ranking. [BUILD_PLAN.md](BUILD_PLAN.md) holds the implementation plan.

## Repository layout

- `web/`: Next.js app and customer interface.
- `api/`: research API, provider adapters, workers, and focused checks.
- `supabase/`: local Supabase configuration and database migrations.
- `scripts/`: project-level development checks.
- `BUILD_PLAN.md` and `progress.md`: implementation plan and verified checkpoints.

## Local development

Install dependencies with `npm ci` in both `api/` and `web/`. Configure the Supabase project and apply the migrations in `supabase/migrations/`. Copy [`.env.example`](.env.example) to `.env.local` and [`web/.env.example`](web/.env.example) to `web/.env.local`, then add your own values. Both local files are ignored. Start the API with `npm run dev` from `api/` and the web app with `npm run dev` from `web/`.

The API requires a database connection, Supabase authentication configuration, and the relevant provider credentials for live research. Qloo research uses the separately installed `qloo` MCP command. Provider keys are server-only; only Supabase's publishable configuration belongs in `NEXT_PUBLIC_` variables. The local Qloo hackathon kit is a development reference and is not vendored in this repository.

Brand × Brand research depends on configured Qloo and Shopify Catalog access, with Tavily used only for the Compare Two Brands cultural check and the public-source review of a saved partner. Research starts at `/research/new`: the brand and its country (which sets the market, currency and website guess), then a goal and a chosen starting product. Brand × YouTube creator research has been removed from the app. See [BUILD_PLAN.md](BUILD_PLAN.md) for the current verification state. Product-context discovery for brands absent from Qloo remains disabled until its separate live evidence gate passes.

## Checks

From `api/`, `npm test` runs the offline fixture checks; they load no provider credentials. `npm run test:local` runs the checks that need the local Supabase stack (database, RLS and API authentication) and its status file at `/tmp/crossculture-supabase-status.env`. Neither suite calls a live provider. From `web/`, `npx tsc --noEmit` and `npm run build` check the interface.
