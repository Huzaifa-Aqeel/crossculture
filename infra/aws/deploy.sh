#!/usr/bin/env bash
set -euo pipefail

aws_profile="${AWS_PROFILE:-pet-care}"
aws_region="${AWS_REGION:-us-east-1}"
aws_account="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text --profile "$aws_profile")}"
aws_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$aws_dir/../.." && pwd)"
api_dir="$repo_dir/api"
lambda_zip="$api_dir/dist/crossculture-lambda.zip"
temporary_dir="$(mktemp -d)"
chmod 700 "$temporary_dir"
trap 'rm -rf "$temporary_dir"' EXIT

if [[ ! -f "$repo_dir/.env.local" ]]; then
  echo "Missing local deployment environment: $repo_dir/.env.local" >&2
  exit 1
fi

"$aws_dir/bootstrap-roles.sh"
(cd "$api_dir" && npm run aws:package)
node --env-file="$repo_dir/.env.local" "$api_dir/scripts/write-lambda-env.mjs" "$temporary_dir"

create_or_update_function() {
  local function_name="$1" role_name="$2" handler="$3" timeout="$4" memory="$5" env_file="$6"
  local role_arn="arn:aws:iam::$aws_account:role/$role_name"
  if aws lambda get-function --function-name "$function_name" --profile "$aws_profile" --region "$aws_region" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$function_name" \
      --zip-file "fileb://$lambda_zip" --profile "$aws_profile" --region "$aws_region" \
      --query 'FunctionArn' --output text
    aws lambda wait function-updated --function-name "$function_name" \
      --profile "$aws_profile" --region "$aws_region"
    aws lambda update-function-configuration --function-name "$function_name" \
      --role "$role_arn" --runtime nodejs24.x --handler "$handler" \
      --timeout "$timeout" --memory-size "$memory" \
      --environment "file://$temporary_dir/$env_file" \
      --profile "$aws_profile" --region "$aws_region" \
      --query 'FunctionArn' --output text
  else
    aws lambda create-function --function-name "$function_name" \
      --role "$role_arn" --runtime nodejs24.x --handler "$handler" \
      --timeout "$timeout" --memory-size "$memory" \
      --zip-file "fileb://$lambda_zip" \
      --environment "file://$temporary_dir/$env_file" \
      --profile "$aws_profile" --region "$aws_region" \
      --query 'FunctionArn' --output text
  fi
  aws lambda wait function-updated --function-name "$function_name" \
    --profile "$aws_profile" --region "$aws_region"
}

create_or_update_function crossculture-research-worker crossculture-worker-lambda-role \
  src/research-lambda.handler 900 1024 worker-env.json
RESEARCH_WORKER_FUNCTION_NAME=crossculture-research-worker AWS_PROFILE="$aws_profile" \
  AWS_REGION="$aws_region" npm --prefix "$api_dir" run aws:worker-concurrency

create_or_update_function crossculture-api crossculture-api-lambda-role \
  src/api-lambda.handler 60 512 api-env.json

if ! aws lambda get-function-url-config --function-name crossculture-api \
  --profile "$aws_profile" --region "$aws_region" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name crossculture-api \
    --auth-type NONE --profile "$aws_profile" --region "$aws_region" \
    --query 'FunctionUrl' --output text
fi

add_url_permission() {
  local statement_id="$1" action="$2" condition_flag="$3"
  if aws lambda get-policy --function-name crossculture-api --profile "$aws_profile" \
    --region "$aws_region" --query Policy --output text 2>/dev/null |
      grep -Eq "\"Sid\"[[:space:]]*:[[:space:]]*\"$statement_id\""; then
    return
  fi
  aws lambda add-permission --function-name crossculture-api \
    --statement-id "$statement_id" --action "$action" --principal '*' \
    "$condition_flag" --profile "$aws_profile" --region "$aws_region" \
    --query Statement --output text >/dev/null
}
add_url_permission CrossCulturePublicUrl lambda:InvokeFunctionUrl --function-url-auth-type=NONE
add_url_permission CrossCulturePublicUrlInvoke lambda:InvokeFunction --invoked-via-function-url

worker_arn="arn:aws:lambda:$aws_region:$aws_account:function:crossculture-research-worker"
scheduler_role_arn="arn:aws:iam::$aws_account:role/crossculture-scheduler-role"
node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({Arn:process.argv[2],RoleArn:process.argv[3]}))' \
  "$temporary_dir/scheduler-target.json" "$worker_arn" "$scheduler_role_arn"
if ! aws scheduler get-schedule --name crossculture-research-recovery \
  --profile "$aws_profile" --region "$aws_region" >/dev/null 2>&1; then
  aws scheduler create-schedule --name crossculture-research-recovery \
    --schedule-expression 'rate(1 minute)' --flexible-time-window '{"Mode":"OFF"}' \
    --target "file://$temporary_dir/scheduler-target.json" \
    --profile "$aws_profile" --region "$aws_region" --query ScheduleArn --output text
fi

aws lambda get-function-url-config --function-name crossculture-api \
  --profile "$aws_profile" --region "$aws_region" --query FunctionUrl --output text
