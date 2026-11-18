###############################################################################
# API service — Spring Boot container on ECS Express Mode (Fargate).
#
# Express Mode provisions the ECS service, an Application Load Balancer with
# TLS, autoscaling policies, health checks and a public HTTPS URL from three
# inputs. There is no surcharge for Express Mode itself; you pay for Fargate,
# the ALB, logs and data transfer. Up to 25 Express services in compatible
# subnets share one ALB, so adding a second service later costs no new ALB.
#
# >>> VERIFY ON FIRST PLAN <<<
# aws_ecs_express_gateway_service shipped in AWS provider 6.23.0 and is newer
# than most of this stack. If `terraform plan` disputes an argument name here,
# check the resource docs and adjust -- the surrounding IAM and logging is
# conventional and will not be the problem.
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

variable "environment" {
  type        = map(string)
  description = "Plain environment variables for the container."
  default     = {}
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  name = "${var.project}-api"
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
    sid       = "ReadDatabaseSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_secret_arn]
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

# AWS publishes a managed policy for the ECS infrastructure role that covers
# load balancer management. If the ARN below does not resolve on first apply,
# list candidates with:
#   aws iam list-policies --scope AWS --query \
#     "Policies[?contains(PolicyName,'ECSInfrastructureRolePolicy')].Arn"
resource "aws_iam_role_policy_attachment" "infrastructure_managed" {
  role       = aws_iam_role.infrastructure.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRolePolicyForLoadBalancers"
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

resource "aws_ecs_express_gateway_service" "api" {
  name    = local.name
  cluster = aws_ecs_cluster.this.name

  execution_role_arn      = aws_iam_role.execution.arn
  task_role_arn           = aws_iam_role.task.arn
  infrastructure_role_arn = aws_iam_role.infrastructure.arn

  cpu    = var.cpu
  memory = var.memory

  health_check_path = var.health_check_path

  primary_container {
    image          = var.image
    container_port = var.container_port

    # >>> VERIFY: if plan rejects this block, the container reads the same
    # values from ENV defaults baked into the Dockerfile, except
    # CORS_ALLOWED_ORIGINS -- which would then need passing another way.
    dynamic "environment" {
      for_each = var.environment

      content {
        name  = environment.key
        value = environment.value
      }
    }
  }

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.api.id]
  }

  depends_on = [
    aws_iam_role_policy_attachment.execution_managed,
    aws_iam_role_policy_attachment.infrastructure_managed,
    aws_iam_role_policy.task,
  ]

  tags = { Name = local.name }
}

output "service_url" {
  description = "Public HTTPS URL Express Mode assigned to the service."
  value       = try(aws_ecs_express_gateway_service.api.service_url, null)
}

output "service_arn" {
  value = aws_ecs_express_gateway_service.api.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_express_gateway_service.api.name
}

output "security_group_id" {
  value = aws_security_group.api.id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}
