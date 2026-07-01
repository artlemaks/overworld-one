# The cluster object itself is free. Container Insights is OFF (it bills CloudWatch
# per metric) — re-enable later if we need the dashboards.
resource "aws_ecs_cluster" "main" {
  name = var.project

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

# Prefer FARGATE_SPOT (up to ~70% cheaper) — ideal for the bursty P1 load test.
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${var.project}-server"
  retention_in_days = 7
}
