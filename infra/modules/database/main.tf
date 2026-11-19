###############################################################################
# Database — single-AZ RDS PostgreSQL with an RDS-managed master password.
#
# Deliberately NOT Aurora Serverless v2: its 0.5 ACU floor bills ~$44/month
# before serving a single query, which is more than a db.t4g.small costs
# outright. Revisit when traffic is spiky enough to justify it.
#
# Password management (changed 2026-11-19). RDS owns the master password and
# rotates it in Secrets Manager on a schedule, every seven days by default.
# This is "managed rotation": no Lambda is involved, which is what makes it
# viable here -- a Secrets Manager rotation Lambda would have to run inside
# the VPC to reach Postgres, and since the NAT gateway was removed that would
# mean adding a Secrets Manager interface endpoint at roughly $7/month per AZ
# to rotate one password.
#
# What this costs us: you cannot create a read replica of an instance whose
# credentials are managed this way (true for every engine except SQL Server
# and Db2). There are no read replicas and none planned on a db.t4g.small
# serving a marketing site and a small portal. If one is ever needed, turn
# manage_master_user_password off first, which hands the password back.
#
# Deleting the instance also deletes the managed secret, so there is no
# orphaned credential to clean up -- and nothing to recover it from either.
###############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.23"
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
  port     = 5432

  # RDS generates the master password, stores it in its own Secrets Manager
  # secret and rotates it. `password` must be absent: the two are mutually
  # exclusive.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false

  multi_az                = var.multi_az
  backup_retention_period = 7
  backup_window           = "08:00-09:00"
  maintenance_window      = "sun:09:30-sun:10:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true

  # Deliberate. The alternative is that a change sits pending and lands in
  # the Sunday 09:30 maintenance window, which means any breakage happens
  # when nobody is watching rather than during a deploy someone is. On a
  # single-AZ instance serving this little, seeing it now beats finding out
  # later. Revisit if this ever carries traffic that minds a restart.
  apply_immediately = true

  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-postgres-final"

  tags = { Name = "${var.project}-postgres" }
}

###############################################################################
# Outputs.
#
# There is no hand-rolled secret here any more. The module used to generate a
# password and write a JSON blob containing the connection string alongside
# it; that secret is gone, because the moment RDS took over the password the
# copy in it became both wrong and misleading.
#
# The consequence for consumers: the managed secret holds credentials ONLY.
# Host, port and database name are not in it, so they are passed separately.
# They are not secret -- the endpoint is in the console, the Terraform state
# and this output -- and keeping them out of the secret is what lets the app
# treat a credential change as a credential change rather than a reconnect.
###############################################################################

output "security_group_id" {
  value = aws_security_group.db.id
}

output "secret_arn" {
  description = <<-EOT
    ARN of the RDS-managed master user secret. Contains username and
    password, rotated by RDS. Nothing else.
  EOT
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "endpoint" {
  value = aws_db_instance.this.endpoint
}

output "host" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "dbname" {
  value = aws_db_instance.this.db_name
}
