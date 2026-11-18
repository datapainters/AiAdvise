###############################################################################
# Database — single-AZ RDS PostgreSQL, password generated and stored in
# Secrets Manager with automatic rotation left off until you need it.
#
# Deliberately NOT Aurora Serverless v2: its 0.5 ACU floor bills ~$44/month
# before serving a single query, which is more than a db.t4g.small costs
# outright. Revisit when traffic is spiky enough to justify it.
###############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.23"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }
}

variable "project" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

# NOTE: ingress is granted by the CONSUMER, not here. The api-service module
# attaches its own rule to the security group this module exports. Doing it
# the other way round makes database depend on api while api depends on
# database's secret ARN -- a dependency cycle Terraform will refuse to plan.

variable "instance_class" {
  type        = string
  description = "RDS instance class. db.t4g.small is the sane floor for prod."
  default     = "db.t4g.small"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "advisory"
}

variable "db_username" {
  type    = string
  default = "advisory_app"
}

variable "multi_az" {
  type        = bool
  description = "Doubles the instance cost. Off until there is revenue to protect."
  default     = false
}

variable "deletion_protection" {
  type    = bool
  default = true
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project}-db"
  subnet_ids = var.private_subnet_ids

  tags = { Name = "${var.project}-db" }
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "Postgres access for ${var.project}"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.project}-db" }
}

resource "random_password" "db" {
  length = 32
  # RDS rejects several punctuation characters in master passwords; keep to
  # a set that is known-safe rather than discovering it during apply.
  override_special = "!#$%*()-_=+[]{}<>:?"
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.project}-pg17"
  family = "postgres17"

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  # pg_stat_statements needs a restart to load.
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "this" {
  identifier = "${var.project}-postgres"

  engine         = "postgres"
  engine_version = "17"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false

  multi_az                = var.multi_az
  backup_retention_period = 7
  backup_window           = "08:00-09:00"
  maintenance_window       = "sun:09:30-sun:10:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  apply_immediately          = false

  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-postgres-final"

  tags = { Name = "${var.project}-postgres" }
}

###############################################################################
# Connection details in Secrets Manager. The app reads this at boot; nothing
# ever bakes a password into a task definition or an image.
###############################################################################

resource "aws_secretsmanager_secret" "db" {
  name        = "${var.project}/database"
  description = "Postgres connection details for ${var.project}"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id

  secret_string = jsonencode({
    username = aws_db_instance.this.username
    password = random_password.db.result
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = aws_db_instance.this.db_name
    # Spring reads this directly as spring.datasource.url
    jdbc_url = "jdbc:postgresql://${aws_db_instance.this.endpoint}/${aws_db_instance.this.db_name}"
  })
}

output "security_group_id" {
  value = aws_security_group.db.id
}

output "secret_arn" {
  description = "Secrets Manager ARN holding the connection details."
  value       = aws_secretsmanager_secret.db.arn
}

output "endpoint" {
  value = aws_db_instance.this.endpoint
}
