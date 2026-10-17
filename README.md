# CrossCulture

CrossCulture is a partnership planning app for discovering and comparing brand partners and YouTube creators. The product contract is in [FR v1.7](CrossCulture_Functional_Requirements_v1.7.md), and the sole scoring specification is [Scoring Engine v4](CrossCulture_Scoring_Engine_v4.md).

## Repository layout

- `web/`: Next.js app and customer interface.
- `api/`: research API, provider adapters, workers, and focused checks.
- `supabase/`: local Supabase configuration and database migrations.
- `scripts/`: project-level development checks.
- `BUILD_PLAN.md` and `progress.md`: implementation plan and verified checkpoints.

## Local development

Install dependencies with `npm ci` in both `api/` and `web/`. Configure the Supabase project and apply the migrations in `supabase/migrations/`. Copy [`.env.example`](.env.example) to `.env.local` and [`web/.env.example`](web/.env.example) to `web/.env.local`, then add your own values. Both local files are ignored. Start the API with `npm run dev` from `api/` and the web app with `npm run dev` from `web/`.

The API requires a database connection, Supabase authentication configuration, and the relevant provider credentials for live research. Qloo research uses the separately installed `qloo` MCP command. Provider keys are server-only; only Supabase's publishable configuration belongs in `NEXT_PUBLIC_` variables. The local Qloo hackathon kit is a development reference and is not vendored in this repository.

Sample fixtures under `api/fixtures/` are labeled sample data. Live research depends on configured provider access and available request budgets. See [BUILD_PLAN.md](BUILD_PLAN.md) for the current verification state.
