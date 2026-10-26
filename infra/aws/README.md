# CrossCulture AWS deployment

Target account: the one your CLI profile signs in to (read at deploy time, or set
`AWS_ACCOUNT_ID`); region: `us-east-1`; CLI profile: `AWS_PROFILE` (default `pet-care`).

## IAM deployment permission

The deploying IAM user has [crossculture-deployer-iam-policy.json](crossculture-deployer-iam-policy.json)
as an inline policy (replace `ACCOUNT_ID` with your account ID before attaching it). It permits creation and configuration of
`crossculture-*` roles and passing only those roles to Lambda and EventBridge
Scheduler. It does not grant general IAM administration.

The deployment uses three dedicated roles:

| Role | Trust | Permissions |
| --- | --- | --- |
| `crossculture-api-lambda-role` | [Lambda trust](lambda-trust.json) | CloudWatch Logs basic execution, [API policy](api-role-policy.json) |
| `crossculture-worker-lambda-role` | [Lambda trust](lambda-trust.json) | CloudWatch Logs basic execution, [worker policy](worker-role-policy.json) |
| `crossculture-scheduler-role` | [Scheduler trust](scheduler-trust.json) | [Scheduler policy](scheduler-role-policy.json) |

The two Lambda roles need the AWS managed `AWSLambdaBasicExecutionRole` policy.
The API role can invoke only `crossculture-research-worker`. The scheduler role
can invoke only that worker. Both Lambda roles permit Bedrock model invocation
because API requests and background research can generate text.

## Deployment sequence

1. Run `npm ci` and `npm run aws:package` from `api/`. The package includes the
   API handler, research handler, and Qloo MCP command; no `.env` file is added.
2. Create and configure the three execution roles above.
3. Create `crossculture-research-worker` using Node.js 24, handler
   `src/research-lambda.handler`, and the worker role. `npm run aws:worker-concurrency`
   reserves concurrency 2 if the account can retain at least 10 unreserved executions.
   The current account quota is 10, so the deployed worker uses shared concurrency.
   Raise the quota to at least 12 to apply the cap. Shared capacity still permits
   two simultaneous jobs when available; Postgres claims distinct rows.
4. Create `crossculture-api` using Node.js 24, handler
   `src/api-lambda.handler`, and the API role. Set
   `RESEARCH_WORKER_FUNCTION_NAME=crossculture-research-worker`.
5. Configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `QLOO_API_KEY`, `TAVILY_API_KEY`, LLM settings, and the production
   `SHOPIFY_UCP_PROFILE_URL` on the relevant functions. Keep provider keys and
   the database URL out of Vercel and Git.
6. Give the API a public HTTPS Function URL, leaving the worker without one.
   The API verifies the user's Supabase token on application routes. Configure
   a one-minute EventBridge Scheduler target for the worker using the scheduler
   role.
7. Set Vercel's `CROSSCULTURE_API_URL` to the API Function URL without a
   trailing slash; redeploy the web app and run a signed-in research test.

The deployed API Function URL is printed by `deploy.sh`; its `/health` endpoint
should return HTTP 200.

The production Shopify agent profile is
`https://culture-circle.vercel.app/ucp-agent-profile.json`. It returned HTTP
200 and is configured in the local deployment environment.
