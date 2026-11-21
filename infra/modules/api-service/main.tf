###############################################################################
# API service — Spring Boot container on ECS Express Mode (Fargate).
#
# Express Mode provisions the ECS service, an Application Load Balancer with
# TLS, autoscaling policies, health checks and a public HTTPS URL from three
# inputs. There is no surcharge for Express Mode itself; you pay for Fargate,
# the ALB, logs and data transfer. Up to 25 Express services in compatible
# subnets share one ALB, so adding a second service later costs no new ALB.
#
# Schema verified against AWS provider 6.73.0. Two things to know if you edit
# this resource:
#   * the service name argument is `service_name`, not `name`
#   * there is no url attribute; the public endpoint arrives via ingress_paths
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

variable "subnet_ids" {
  type = list(string)

  description = <<-EOT
    Subnets for the service. At least two are required.

    IMPORTANT: Express Mode derives whether the load balancer is
    internet-facing or internal from these subnets -- there is no argument
    for it. Public subnets yield an ingress path with accessType PUBLIC;
    private subnets yield PRIVATE, and nothing outside the VPC can reach the
    API. This is only discoverable after apply, via the ingress_paths
    attribute or `aws ecs describe-express-gateway-service`.
  EOT

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "Express Mode requires at least 2 subnets."
  }
}

variable "image" {
  type        = string
  description = "Fully qualified ECR image reference, digest or immutable tag."
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "cpu" {
  type        = number
  description = "Fargate CPU units. 512 = 0.5 vCPU."
  default     = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "health_check_path" {
  type    = string
  default = "/actuator/health/readiness"
}

variable "db_secret_arn" {
  type        = string
  description = "Secrets Manager ARN the task may read."
}

variable "db_security_group_id" {
  type        = string
  description = <<-EOT
    Security group fronting Postgres. This module attaches its own ingress
    rule to it, so that database does not have to know about api.
  EOT
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "ses_send_resource_arns" {
  type        = list(string)
  description = <<-EOT
    Every SES resource the sender must be authorised against.

    This is a list, not a single identity ARN, because SendEmail authorises
    against each resource the request touches. A request that names a
    configuration set is checked against the identity AND the configuration
    set; a policy granting only the identity denies it with a message that
    reads like the identity is wrong. Pass both.

    Empty disables the grant entirely, which is right for an environment
    with no verified domain.
  EOT
  default     = []
}

variable "bootstrap_admin_email" {
  type        = string
  description = <<-EOT
    Email for the initial admin account, created on startup only while the
    user table is empty. Leave null once a real admin exists; the account is
    not removed if you do, because the service never deletes users.
  EOT
  default     = null
}

variable "environment" {
  type        = map(string)
  description = "Plain environment variables for the container."
  default     = {}
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  name = "${var.project}-api"

  # The JWT secret ARN is the module's own concern rather than the caller's,
  # so it is merged in here instead of being threaded through var.environment.
  container_environment = merge(
    var.environment,
    {
      JWT_SECRET_ARN           = aws_secretsmanager_secret.jwt.arn
      DAILY_API_KEY_SECRET_ARN = aws_secretsmanager_secret.daily.arn
    },
    var.bootstrap_admin_email == null ? {} : {
      BOOTSTRAP_ADMIN_SECRET_ARN = aws_secretsmanager_secret.bootstrap_admin[0].arn
    },
  )

  # Secrets the task role may read. The bootstrap entry disappears from the
  # policy once bootstrap_admin_email is cleared.
  readable_secret_arns = concat(
    [var.db_secret_arn, aws_secretsmanager_secret.jwt.arn, aws_secretsmanager_secret.daily.arn],
    var.bootstrap_admin_email == null ? [] : [aws_secretsmanager_secret.bootstrap_admin[0].arn],
  )
}

###############################################################################
# JWT signing key
#
# Generated here and stored in Secrets Manager so it never appears in the
# image, the task definition or `docker inspect`. HS256, so this single value
# both signs and verifies.
#
# Rotating it is a deliberate act with a visible consequence: every issued
# token stops verifying and users have to sign in again. There is no
# automatic rotation for that reason -- taint this resource when you want it.
###############################################################################

resource "random_password" "jwt" {
  length = 64
  # Alphanumeric only. The value is used as raw HMAC key material, and
  # punctuation buys no entropy worth the encoding risk at this length.
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name        = "${var.project}/jwt-signing-key"
  description = "HS256 signing key for ${local.name} access tokens"
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({ key = random_password.jwt.result })
}

###############################################################################
# Daily (video meetings) API key
#
# Terraform creates the secret but never its value: the key is issued by
# Daily and set by hand, so it does not end up in Terraform state. Until a
# value exists the API runs with video switched off, and it re-reads the
# secret every few minutes, so setting it needs no redeploy:
#
#   aws secretsmanager put-secret-value --secret-id <project>/daily-api-key \
#     --secret-string '{"key":"<your Daily API key>"}'
###############################################################################

resource "aws_secretsmanager_secret" "daily" {
  name        = "${var.project}/daily-api-key"
  description = "Daily.co REST API key for ${local.name} video meetings"
}

###############################################################################
# Bootstrap admin
#
# A fresh database has no users, so there is no way in. When
# bootstrap_admin_email is set, the service creates that one admin on startup
# -- and only while the user table is completely empty, so it can never
# resurrect or overwrite an account later.
#
# The password is generated here and kept in Secrets Manager rather than
# passed as a plain environment variable, because task definitions are
# readable by anyone with ecs:DescribeTaskDefinition. Read it once with:
#
#   aws secretsmanager get-secret-value \
#     --secret-id <project>/bootstrap-admin --query SecretString --output text
#
# then sign in and change it.
###############################################################################

resource "random_password" "bootstrap_admin" {
  count = var.bootstrap_admin_email == null ? 0 : 1

  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "bootstrap_admin" {
  count = var.bootstrap_admin_email == null ? 0 : 1

  name        = "${var.project}/bootstrap-admin"
  description = "Initial admin password for ${local.name}"
}

resource "aws_secretsmanager_secret_version" "bootstrap_admin" {
  count = var.bootstrap_admin_email == null ? 0 : 1

  secret_id = aws_secretsmanager_secret.bootstrap_admin[0].id
  secret_string = jsonencode({
    email    = var.bootstrap_admin_email
    password = random_password.bootstrap_admin[0].result
  })
}

###############################################################################
# Logs
###############################################################################

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
}

###############################################################################
# Three roles, because Express Mode needs three distinct identities:
#   execution      — pulls the image, writes logs (used by the ECS agent)
#   task           — what YOUR code runs as; reads the DB secret
#   infrastructure — what Express Mode itself uses to create the ALB for you
###############################################################################

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "ecs_service_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ReadSecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.readable_secret_arns
  }

  # Outbound mail. Scoped to named resources rather than "*", so a bug
  # cannot send as some other domain this account verifies later.
  dynamic "statement" {
    for_each = length(var.ses_send_resource_arns) == 0 ? [] : [1]
    content {
      sid    = "SendMail"
      effect = "Allow"
      actions = [
        "ses:SendEmail",
        "ses:SendRawEmail",
      ]
      resources = var.ses_send_resource_arns
    }
  }

  # ECS Exec, so you can get a shell in a running task without a bastion.
  statement {
    sid    = "ExecuteCommand"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "app-permissions"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_iam_role" "infrastructure" {
  name               = "${local.name}-infrastructure"
  assume_role_policy = data.aws_iam_policy_document.ecs_service_assume.json
}

# Verified against the live account: this is the managed policy AWS publishes
# for the Express Mode infrastructure role. Note the irregular casing --
# lowercase "for", and no "Policy" suffix, unlike its siblings
# (AmazonECSInfrastructureRolePolicyForVolumes). Do not "correct" it.
resource "aws_iam_role_policy_attachment" "infrastructure_managed" {
  role       = aws_iam_role.infrastructure.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
}

###############################################################################
# Security group for the task. Express Mode attaches the ALB in front of it.
###############################################################################

resource "aws_security_group" "api" {
  name        = local.name
  description = "Fargate tasks for ${local.name}"
  vpc_id      = var.vpc_id

  tags = { Name = local.name }
}

resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound to RDS, Secrets Manager, ECR"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = var.db_security_group_id
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres from ${local.name} tasks"
}

###############################################################################
# The service itself
###############################################################################

resource "aws_ecs_cluster" "this" {
  name = var.project

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

# AWS refuses to move an existing Express service between subnet types:
#
#   InvalidParameterException: Changing subnet types is not supported for
#   ECS express gateway services.
#
# The provider does not mark subnets as force-new, so it plans a harmless
# looking in-place update that then fails at apply. Binding the service to
# this value turns a LATER subnet change into a replacement, which AWS does
# allow.
#
# Note the limitation, learned the hard way: replace_triggered_by fires when
# the referenced value CHANGES, not when it is first created. Adding this
# block does not retroactively force the replacement you are currently stuck
# on -- the first apply just creates the terraform_data and then fails the
# same way. To get out of that state, either run
#   terraform apply -replace=module.api.aws_ecs_express_gateway_service.api
# (the deploy workflow exposes this as a manual input), or delete the
# service out of band and let the next apply recreate it.
#
# Replacement means a new endpoint hostname, and the API is briefly down
# while the old service drains. The deploy workflow re-reads api_url after
# every apply and rebuilds the front end against it, so nothing is left
# pointing at the old address.
resource "terraform_data" "subnet_binding" {
  input = var.subnet_ids
}

resource "aws_ecs_express_gateway_service" "api" {
  lifecycle {
    replace_triggered_by = [terraform_data.subnet_binding]
  }

  # NOT `name` -- this resource calls it service_name, unlike aws_ecs_service.
  service_name = local.name
  cluster      = aws_ecs_cluster.this.name

  execution_role_arn      = aws_iam_role.execution.arn
  task_role_arn           = aws_iam_role.task.arn
  infrastructure_role_arn = aws_iam_role.infrastructure.arn

  cpu    = var.cpu
  memory = var.memory

  health_check_path = var.health_check_path

  # Without this, apply returns as soon as the service is accepted, and the
  # deploy's smoke test then polls a load balancer whose DNS has not
  # propagated -- every attempt returns 000 and the deploy fails even though
  # the service comes up healthy a minute later. Waiting costs a few minutes
  # of apply time and removes a whole class of false failure.
  wait_for_steady_state = true

  primary_container {
    image          = var.image
    container_port = var.container_port

    # Without this, Express Mode creates its own log group
    # (/aws/ecs/<cluster>/<service>-<suffix>) which never expires, and the
    # group defined above sits empty while CloudWatch charges accrue
    # indefinitely. Pointing it here puts logs under the retention policy.
    aws_logs_configuration {
      log_group = aws_cloudwatch_log_group.api.name

      # The provider documents log_stream_prefix as optional, but
      # UpdateExpressGatewayService rejects the call without it:
      #   missing required field,
      #   UpdateExpressGatewayServiceInput.PrimaryContainer
      #     .AwsLogsConfiguration.LogStreamPrefix
      # Omitting it plans as a removal, which fails every apply. Keep it.
      log_stream_prefix = "ecs"
    }

    dynamic "environment" {
      for_each = local.container_environment

      content {
        name  = environment.key
        value = environment.value
      }
    }
  }

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [aws_security_group.api.id]
  }

  depends_on = [
    aws_iam_role_policy_attachment.execution_managed,
    aws_iam_role_policy_attachment.infrastructure_managed,
    aws_iam_role_policy.task,
  ]

  tags = { Name = local.name }
}

locals {
  # Express Mode has no single "url" attribute. The public endpoint comes back
  # through the ingress_paths list, so normalise it into a usable URL. The
  # scheme check is defensive: the endpoint is a bare hostname today, and this
  # keeps working if the provider starts including one.
  raw_endpoint = try(aws_ecs_express_gateway_service.api.ingress_paths[0].endpoint, null)

  service_url = local.raw_endpoint == null ? null : (
    startswith(local.raw_endpoint, "http") ? local.raw_endpoint : "https://${local.raw_endpoint}"
  )
}

output "service_url" {
  description = "Public HTTPS URL Express Mode assigned to the service."
  value       = local.service_url
}

output "service_arn" {
  value = aws_ecs_express_gateway_service.api.service_arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_express_gateway_service.api.service_name
}

output "security_group_id" {
  value = aws_security_group.api.id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}
