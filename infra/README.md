# Infra (P1F-I-4 · OOM-12)

Hosting is **AWS** (`eu-west-1`), provisioned with Terraform. See `terraform/` and its README.

- **Cost-first:** everything billable is behind a toggle that defaults off, so `terraform apply`
  creates only free scaffolding (VPC, ECR, ECS cluster, IAM/OIDC, log group). Turn `runtime_enabled`
  on only for the P1 load test, then off to tear it down.
- **Access:** IAM Identity Center (SSO), profile `overworld`. `aws sso login --profile overworld`.
- **Status:** Terraform authored and `plan`-validated against the account (both toggle states). Not
  yet applied — do that when we need the runtime (P1). Server image must be built+pushed to ECR first.

Local development needs none of this — `docker compose up` (Redis + Postgres) covers it.
