# Terraform — Overworld One AWS infra (OOM-12)

Cost-first AWS footprint for the real-time stack. **Everything billable is behind a toggle that
defaults to off**, so a plain `apply` costs ~nothing.

## Cost model

| State                                                       | What exists                                             | ~Monthly                    |
| ----------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| `runtime_enabled=false`, `postgres_enabled=false` (default) | VPC, ECR, ECS cluster, IAM/OIDC, log group, SGs         | **~$0** (ECR storage cents) |
| `runtime_enabled=true`                                      | + ALB, Fargate (Spot) task, ElastiCache Redis t4g.micro | **~$40–55** while on        |
| `postgres_enabled=true`                                     | + RDS Postgres db.t4g.micro single-AZ                   | **+~$13** while on          |

Cost choices: no NAT Gateway (Fargate in public subnets), Fargate **Spot**, Graviton (ARM64) everywhere,
single-node/single-AZ, HTTP-only ALB for synthetic load tests (add `certificate_arn` for wss later),
Container Insights off, 7-day log retention.

## Usage

```bash
export AWS_PROFILE=overworld AWS_REGION=eu-west-1
terraform init
terraform plan                       # default = free scaffolding only
terraform apply                      # create the always-on scaffolding

# For the P1 load test (OOM-36) — bring the paid runtime up, then tear it down:
terraform apply -var runtime_enabled=true
# ... run load test against the ALB DNS (terraform output alb_dns_name) ...
terraform apply -var runtime_enabled=false

# P2 durability work:
terraform apply -var postgres_enabled=true
```

## Prerequisite before enabling runtime

Build + push the server image to ECR (arm64):

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin <ecr-registry>
docker buildx build --platform linux/arm64 -f server/Dockerfile -t <ecr-repo-url>:latest --push .
```

CI can do this via the `github_deploy_role_arn` output (GitHub OIDC — no stored keys).

## Not included yet (deliberately, to stay cheap/simple)

- Remote state backend (S3+DynamoDB) — add before multi-operator use.
- Custom domain / ACM cert / Route 53 — add `certificate_arn` when real clients arrive.
- Autoscaling policies — add in P5 hardening.
