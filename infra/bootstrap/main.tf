###############################################################################
# Bootstrap stack — apply ONCE, by a human, with admin credentials.
#
# This stack creates the things the CI/CD pipeline needs before it can run:
#   * remote state backend (S3 + DynamoDB lock table)
#   * GitHub OIDC identity provider
#   * the IAM role GitHub Actions assumes (no long-lived access keys anywhere)
#   * ECR repositories for the API image
#
# It keeps its own state LOCAL and committed-ignored, because it is the thing
# that creates the remote backend. Apply it once and leave it alone:
#   cd infra/bootstrap && terraform init && terraform apply
#
# Everything else lives in infra/envs/<env> and uses the S3 backend below.
###############################################################################

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # aws_ecs_express_gateway_service landed in provider 6.23.0.
      version = ">= 6.23"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  name_prefix = var.project

  # GitHub can issue OIDC tokens whose subject embeds immutable numeric IDs
  # -- repo:<owner>@<owner_id>/<repo>@<repo_id>:... -- rather than plain
  # names. That is an org-level setting, it is ON for this org, and it is
  # invisible from the workflow side: the only symptom is AccessDenied with
  # "Not authorized to perform sts:AssumeRoleWithWebIdentity", naming
  # nothing. If you ever need to see the real subject, it is recorded in
  # CloudTrail against the failed AssumeRoleWithWebIdentity event.
  #
  # Both forms are trusted so the role survives that setting being toggled.
  oidc_repo_forms = concat(
    ["${var.github_owner}/${var.github_repo}"],
    var.github_owner_id != null && var.github_repo_id != null
    ? ["${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}"]
    : []
  )
}

###############################################################################
# Remote state backend
###############################################################################

resource "aws_s3_bucket" "tfstate" {
  bucket = "${local.name_prefix}-tfstate-${local.account_id}"

  # State is the keys to the kingdom. Never let this be destroyed casually.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tflock" {
  name         = "${local.name_prefix}-tflock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

###############################################################################
# Container registry
###############################################################################

resource "aws_ecr_repository" "api" {
  name                 = "${local.name_prefix}/api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the 30 most recent images; expire the rest."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = { type = "expire" }
      }
    ]
  })
}

###############################################################################
# GitHub Actions OIDC trust
#
# GitHub presents a short-lived OIDC token; AWS exchanges it for temporary
# credentials. No secrets stored in GitHub beyond the role ARN (not a secret).
###############################################################################

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Scope the trust to THIS repository. Without this condition any GitHub
    # repo on the internet could assume the role.
    #
    # Contexts are enumerated rather than trusting a bare
    # "repo:<owner>/<repo>:*", so a token minted for a context this pipeline
    # does not use cannot assume the role.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = flatten([
        for repo in local.oidc_repo_forms : [
          "repo:${repo}:ref:refs/heads/${var.deploy_branch}",
          "repo:${repo}:pull_request",
          "repo:${repo}:environment:*",
        ]
      ])
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name_prefix}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

# Deliberately broad to start: this role runs `terraform apply` for the whole
# platform, so narrowing it is an exercise in chasing your own tail until the
# resource set is stable. Tighten it once the stack stops changing shape --
# docs/hardening.md tracks that. PowerUserAccess cannot touch IAM, so the
# iam/* grant below is explicit and scoped by path.
resource "aws_iam_role_policy_attachment" "github_deploy_power" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

data "aws_iam_policy_document" "github_deploy_iam" {
  statement {
    sid    = "ManageServiceRoles"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:PassRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:CreateServiceLinkedRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.name_prefix}-*"]
  }

  # Read-only on the OIDC provider. The deploy role does not need to create
  # one -- bootstrap already did, and letting a CI pipeline mint identity
  # providers is more authority than it should hold.
  statement {
    sid       = "ReadOidcProvider"
    effect    = "Allow"
    actions   = ["iam:GetOpenIDConnectProvider"]
    resources = ["arn:aws:iam::${local.account_id}:oidc-provider/*"]
  }

  statement {
    sid       = "ReadStateBackend"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketVersioning"]
    resources = [aws_s3_bucket.tfstate.arn]
  }

  statement {
    sid       = "WriteStateObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.tfstate.arn}/*"]
  }

  statement {
    sid    = "StateLocking"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
    ]
    resources = [aws_dynamodb_table.tflock.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy_iam" {
  name   = "terraform-iam-and-state"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy_iam.json
}

###############################################################################
# Variables
###############################################################################

variable "project" {
  description = "Short slug used to prefix every resource name."
  type        = string
  default     = "advisory"
}

variable "region" {
  description = "Primary AWS region."
  type        = string
  default     = "us-east-2"
}

variable "github_owner" {
  description = "GitHub user or org that owns the repo."
  type        = string
}

variable "github_repo" {
  description = "Repository name, without the owner prefix."
  type        = string
}

variable "deploy_branch" {
  description = "Branch whose merges are allowed to deploy."
  type        = string
  default     = "main"
}

variable "github_owner_id" {
  description = <<-EOT
    Numeric GitHub org/user ID, needed when the org issues immutable OIDC
    subject claims. Find it with: gh api users/<owner> --jq .id
  EOT
  type        = string
  default     = null
}

variable "github_repo_id" {
  description = <<-EOT
    Numeric GitHub repository ID, paired with github_owner_id.
    Find it with: gh api repos/<owner>/<repo> --jq .id
  EOT
  type        = string
  default     = null
}

###############################################################################
# Outputs — feed these into infra/envs/prod/backend.tf and the GH workflows.
###############################################################################

output "state_bucket" {
  description = "S3 bucket holding remote Terraform state."
  value       = aws_s3_bucket.tfstate.id
}

output "state_lock_table" {
  description = "DynamoDB table used for state locking."
  value       = aws_dynamodb_table.tflock.name
}

output "github_deploy_role_arn" {
  description = "Set this as the AWS_DEPLOY_ROLE repository variable in GitHub."
  value       = aws_iam_role.github_deploy.arn
}

output "ecr_api_repository_url" {
  description = "Push the API image here."
  value       = aws_ecr_repository.api.repository_url
}
