output "ecr_repository_url" {
  value       = aws_ecr_repository.server.repository_url
  description = "Push the server image here."
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as AWS_ROLE_ARN in GitHub Actions for OIDC deploys."
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "alb_dns_name" {
  value       = var.runtime_enabled ? aws_lb.main[0].dns_name : null
  description = "ALB endpoint (ws://<dns>) — only when runtime_enabled."
}
