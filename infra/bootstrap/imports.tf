###############################################################################
# Adoption of already-created bootstrap resources.
#
# WHY THIS FILE EXISTS
# The bootstrap resources were created directly through the AWS API on
# 2026-11-18, before any Terraform state existed -- which is the normal
# chicken-and-egg of a bootstrap stack: the stack that creates the state
# backend cannot itself start with a state backend.
#
# These `import` blocks (Terraform 1.5+) tell Terraform to adopt the live
# resources into state on the next apply instead of trying to create them
# again and failing with EntityAlreadyExists / BucketAlreadyOwnedByYou.
#
# HOW TO USE
#   cd infra/bootstrap
#   terraform init
#   terraform plan     # expect "N to import, 0 to add, 0 to destroy"
#   terraform apply
#
# A small diff on aws_iam_openid_connect_provider.github is expected and
# harmless: the provider was created with two GitHub thumbprints, while the
# tls_certificate data source computes one. Either is accepted -- AWS no
# longer validates thumbprints for well-known IdPs.
#
# AFTER THE IMPORT SUCCEEDS, DELETE THIS FILE. Import blocks are one-shot
# instructions, not permanent configuration, and leaving them in place is
# confusing for anyone who later runs this stack against a fresh account.
###############################################################################

import {
  to = aws_s3_bucket.tfstate
  id = "advisory-tfstate-638646121967"
}

import {
  to = aws_s3_bucket_versioning.tfstate
  id = "advisory-tfstate-638646121967"
}

import {
  to = aws_s3_bucket_server_side_encryption_configuration.tfstate
  id = "advisory-tfstate-638646121967"
}

import {
  to = aws_s3_bucket_public_access_block.tfstate
  id = "advisory-tfstate-638646121967"
}

import {
  to = aws_dynamodb_table.tflock
  id = "advisory-tflock"
}

import {
  to = aws_iam_openid_connect_provider.github
  id = "arn:aws:iam::638646121967:oidc-provider/token.actions.githubusercontent.com"
}

import {
  to = aws_iam_role.github_deploy
  id = "advisory-github-deploy"
}

# Role policy attachments import as "<role-name>/<policy-arn>".
import {
  to = aws_iam_role_policy_attachment.github_deploy_power
  id = "advisory-github-deploy/arn:aws:iam::aws:policy/PowerUserAccess"
}

# Inline role policies import as "<role-name>:<policy-name>".
import {
  to = aws_iam_role_policy.github_deploy_iam
  id = "advisory-github-deploy:terraform-iam-and-state"
}

import {
  to = aws_ecr_repository.api
  id = "advisory/api"
}

import {
  to = aws_ecr_lifecycle_policy.api
  id = "advisory/api"
}
