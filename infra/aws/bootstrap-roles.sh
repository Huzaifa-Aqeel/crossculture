#!/usr/bin/env bash
set -euo pipefail

aws_profile="${AWS_PROFILE:-pet-care}"
aws_region="${AWS_REGION:-us-east-1}"
aws_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

create_role() {
  local role_name="$1" trust_file="$2"
  if ! aws iam get-role --role-name "$role_name" --profile "$aws_profile" --region "$aws_region" >/dev/null 2>&1; then
    aws iam create-role --role-name "$role_name" \
      --assume-role-policy-document "file://$aws_dir/$trust_file" \
      --profile "$aws_profile" --region "$aws_region" \
      --query 'Role.Arn' --output text
  fi
}

create_role crossculture-api-lambda-role lambda-trust.json
create_role crossculture-worker-lambda-role lambda-trust.json
create_role crossculture-scheduler-role scheduler-trust.json

for role_name in crossculture-api-lambda-role crossculture-worker-lambda-role; do
  aws iam attach-role-policy --role-name "$role_name" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
    --profile "$aws_profile" --region "$aws_region"
done

aws iam put-role-policy --role-name crossculture-api-lambda-role \
  --policy-name CrossCultureApiAccess --policy-document "file://$aws_dir/api-role-policy.json" \
  --profile "$aws_profile" --region "$aws_region"
aws iam put-role-policy --role-name crossculture-worker-lambda-role \
  --policy-name CrossCultureWorkerAccess --policy-document "file://$aws_dir/worker-role-policy.json" \
  --profile "$aws_profile" --region "$aws_region"
aws iam put-role-policy --role-name crossculture-scheduler-role \
  --policy-name CrossCultureSchedulerAccess --policy-document "file://$aws_dir/scheduler-role-policy.json" \
  --profile "$aws_profile" --region "$aws_region"

echo "CrossCulture IAM execution roles are ready."
