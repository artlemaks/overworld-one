# Paid runtime: ALB + Fargate service + task definition. All gated on runtime_enabled.

locals {
  runtime = var.runtime_enabled ? 1 : 0
  image   = "${aws_ecr_repository.server.repository_url}:${var.server_image_tag}"

  # REDIS_URL exists whenever runtime is on; DATABASE_URL only if Postgres is on.
  container_secrets = concat(
    var.runtime_enabled ? [{ name = "REDIS_URL", valueFrom = aws_ssm_parameter.redis_url[0].arn }] : [],
    var.postgres_enabled ? [{ name = "DATABASE_URL", valueFrom = aws_ssm_parameter.database_url[0].arn }] : [],
  )
}

resource "aws_lb" "main" {
  count              = local.runtime
  name               = "${var.project}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "server" {
  count                = local.runtime
  name                 = "${var.project}-server"
  port                 = 8080
  protocol             = "HTTP"
  vpc_id               = aws_vpc.main.id
  target_type          = "ip"
  deregistration_delay = 30

  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  count             = local.runtime
  load_balancer_arn = aws_lb.main[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server[0].arn
  }
}

# Optional wss/TLS listener — only when a cert is supplied (real clients, not load tests).
resource "aws_lb_listener" "https" {
  count             = var.runtime_enabled && var.certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.main[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server[0].arn
  }
}

resource "aws_ecs_task_definition" "server" {
  count                    = local.runtime
  family                   = "${var.project}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_cpu
  memory                   = var.fargate_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name         = "server"
    image        = local.image
    essential    = true
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "8080" },
      { name = "TICK_HZ", value = "4" },
      { name = "LOG_LEVEL", value = "info" },
    ]
    secrets = local.container_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.server.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "server"
      }
    }
  }])
}

resource "aws_ecs_service" "server" {
  count           = local.runtime
  name            = "${var.project}-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server[0].arn
  desired_count   = var.server_desired_count

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server[0].arn
    container_name   = "server"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.http]
}
