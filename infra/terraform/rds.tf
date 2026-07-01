# Postgres — needed from P2 (durable events/participants/commemoratives). Toggled
# by postgres_enabled, separate from runtime so the P1 load test doesn't pay for it.
# Single-AZ, minimal storage, no final snapshot = cheapest.

resource "random_password" "db" {
  count   = var.postgres_enabled ? 1 : 0
  length  = 24
  special = false
}

resource "aws_db_subnet_group" "main" {
  count      = var.postgres_enabled ? 1 : 0
  name       = "${var.project}-db"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_db_instance" "main" {
  count                   = var.postgres_enabled ? 1 : 0
  identifier              = "${var.project}-db"
  engine                  = "postgres"
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  storage_type            = "gp3"
  db_name                 = "overworld"
  username                = "overworld"
  password                = random_password.db[0].result
  multi_az                = false
  publicly_accessible     = false
  db_subnet_group_name    = aws_db_subnet_group.main[0].name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true
}

resource "aws_ssm_parameter" "database_url" {
  count = var.postgres_enabled ? 1 : 0
  name  = "/${var.project}/DATABASE_URL"
  type  = "SecureString"
  value = "postgres://overworld:${random_password.db[0].result}@${aws_db_instance.main[0].endpoint}/overworld"
}
