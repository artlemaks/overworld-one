# Security groups are free, so create them unconditionally; the resources that use
# them (ALB, Redis, RDS) are toggled. Data-plane access to Redis/RDS is restricted
# to the Fargate service SG — never the public internet.

resource "aws_security_group" "alb" {
  name        = "${var.project}-alb"
  description = "ALB ingress"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP/ws"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = var.certificate_arn == "" ? [] : [1]
    content {
      description = "HTTPS/wss"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-alb" }
}

resource "aws_security_group" "service" {
  name        = "${var.project}-service"
  description = "Fargate task SG"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App port from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-service" }
}

resource "aws_security_group" "redis" {
  name        = "${var.project}-redis"
  description = "ElastiCache SG"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from service"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  tags = { Name = "${var.project}-redis" }
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "RDS SG"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from service"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  tags = { Name = "${var.project}-rds" }
}
