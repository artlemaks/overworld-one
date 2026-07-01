variable "project" {
  type        = string
  default     = "overworld-one"
  description = "Name prefix + tag for all resources."
}

variable "aws_region" {
  type        = string
  default     = "eu-west-1"
  description = "AWS region."
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR."
}

# ---------------------------------------------------------------------------
# COST TOGGLES — the whole point of this module.
#
# Both default to false, so `terraform apply` provisions ONLY the free/near-free
# scaffolding (VPC, ECR, IAM, ECS cluster, log group). Flip runtime_enabled on to
# stand up the paid footprint for the P1 load test, then flip it back off to
# tear it down. postgres_enabled is separate because P1 (real-time scale) needs
# Redis but NOT Postgres — that lands in P2.
# ---------------------------------------------------------------------------

variable "runtime_enabled" {
  type        = bool
  default     = false
  description = "Provision the paid runtime: ALB + Fargate service + ElastiCache Redis. Turn on only when actively load-testing/serving."
}

variable "postgres_enabled" {
  type        = bool
  default     = false
  description = "Provision RDS Postgres (P2+). Independent of runtime_enabled."
}

variable "server_image_tag" {
  type        = string
  default     = "latest"
  description = "ECR image tag the ECS task runs. Build+push before enabling runtime."
}

variable "server_desired_count" {
  type        = number
  default     = 1
  description = "Fargate task count (only applies when runtime_enabled)."
}

variable "fargate_cpu" {
  type        = number
  default     = 256
  description = "Fargate task CPU units (256 = 0.25 vCPU, the smallest)."
}

variable "fargate_memory" {
  type        = number
  default     = 512
  description = "Fargate task memory MiB (512 = smallest for 256 CPU)."
}

variable "redis_node_type" {
  type        = string
  default     = "cache.t4g.micro"
  description = "ElastiCache node type (smallest Graviton)."
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class (smallest Graviton)."
}

variable "db_allocated_storage" {
  type        = number
  default     = 20
  description = "RDS storage GB (gp3 minimum)."
}

variable "github_repo" {
  type        = string
  default     = "artlemaks/overworld-one"
  description = "owner/repo allowed to assume the CI deploy role via GitHub OIDC."
}

variable "certificate_arn" {
  type        = string
  default     = ""
  description = "Optional ACM cert ARN. Empty = ALB serves plain HTTP/ws (fine for synthetic load tests). Set to add an HTTPS/wss listener for real clients."
}
