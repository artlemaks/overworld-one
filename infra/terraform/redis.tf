# Redis — needed from P1 (authoritative counters + pub/sub). Toggled by runtime_enabled.
# Single node, no replicas, no Multi-AZ = cheapest.

resource "aws_elasticache_subnet_group" "redis" {
  count      = var.runtime_enabled ? 1 : 0
  name       = "${var.project}-redis"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_elasticache_cluster" "redis" {
  count              = var.runtime_enabled ? 1 : 0
  cluster_id         = "${var.project}-redis"
  engine             = "redis"
  node_type          = var.redis_node_type
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.redis[0].name
  security_group_ids = [aws_security_group.redis.id]
  apply_immediately  = true
}

resource "aws_ssm_parameter" "redis_url" {
  count = var.runtime_enabled ? 1 : 0
  name  = "/${var.project}/REDIS_URL"
  type  = "SecureString"
  value = "redis://${aws_elasticache_cluster.redis[0].cache_nodes[0].address}:6379"
}
