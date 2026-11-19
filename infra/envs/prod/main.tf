###############################################################################
# Production environment — composes the modules.
#
# Run `terraform init` with the backend values printed by the bootstrap stack:
#
#   terraform init \
#     -backend-config="bucket=<state_bucket>" \
#     -backend-config="dynamodb_table=<state_lock_table>"
#
# The CI workflow does this for you from repository variables.
###############################################################################

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.23"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = ">= 4.0"
    }
  }

  backend "s3" {
    key     = "prod/terraform.tfstate"
    region  = "us-east-2"
    encrypt = true
    # bucket and dynamodb_table come from -backend-config at init time.
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront certificates must live in us-east-1 no matter where you deploy.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

###############################################################################
# Variables
###############################################################################

variable "project" {
  type    = string
  default = "advisory"
}

variable "region" {
  type    = string
  default = "us-east-2"
}

variable "domain_name" {
  type        = string
  description = "Hostname the site is served at. May be a subdomain."
}

variable "hosted_zone_name" {
  type        = string
  description = <<-EOT
    The Route 53 zone that contains domain_name, when they differ. Serving at
    ai.datapainters.com means the zone is datapainters.com -- looking up a
    zone named after the subdomain finds nothing and fails the plan. Leave
    null when the site sits at the apex of its own zone.
  EOT
  default     = null
}

variable "subject_alternative_names" {
  type    = list(string)
  default = []
}

variable "api_image" {
  type        = string
  description = "ECR image for the API. CI overrides this on every deploy."
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "bootstrap_admin_email" {
  type        = string
  description = <<-EOT
    Email for the first admin account. Only has any effect while the user
    table is empty. The password is generated into Secrets Manager at
    <project>/bootstrap-admin -- read it from there, then change it.
  EOT
  default     = null
}

###############################################################################
# Composition
###############################################################################

data "aws_route53_zone" "primary" {
  name         = coalesce(var.hosted_zone_name, var.domain_name)
  private_zone = false
}

module "network" {
  source = "../../modules/network"

  project    = var.project
  cidr_block = "10.40.0.0/16"

  # Off since 2026-11-19: the API runs in the public subnets and RDS makes no
  # outbound calls, so nothing in a private subnet needs egress. Set this true
  # again before putting a worker, batch task or Kubernetes node back there.
  enable_nat = false
}

module "database" {
  source = "../../modules/database"

  project            = var.project
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  instance_class     = var.db_instance_class
}

module "api" {
  source = "../../modules/api-service"

  project = var.project
  vpc_id  = module.network.vpc_id

  # PUBLIC subnets, deliberately. Express Mode decides the load balancer
  # scheme from the subnets it is given, and private subnets produce an
  # internal ALB that the browser cannot reach -- which is exactly what the
  # first deploy produced. The tasks themselves are still only reachable
  # through the Express-managed load balancer and security group.
  #
  # Postgres stays in the private subnets and is reachable only from this
  # service's security group.
  subnet_ids = module.network.public_subnet_ids

  image          = var.api_image
  cpu            = var.api_cpu
  memory         = var.api_memory
  container_port = 8080

  # api owns the Postgres ingress rule; see the note in modules/database.
  db_secret_arn        = module.database.secret_arn
  db_security_group_id = module.database.security_group_id

  bootstrap_admin_email = var.bootstrap_admin_email

  environment = {
    SPRING_PROFILES_ACTIVE = "prod"

    # The managed secret holds username and password only, so the rest of the
    # connection details come through here. They are not secret, and keeping
    # them out of the secret means a rotation changes only the credential.
    DB_SECRET_ARN = module.database.secret_arn
    DB_HOST       = module.database.host
    DB_PORT       = tostring(module.database.port)
    DB_NAME       = module.database.dbname

    AWS_REGION           = var.region
    CORS_ALLOWED_ORIGINS = join(",", [for n in concat([var.domain_name], var.subject_alternative_names) : "https://${n}"])
  }
}

module "web" {
  source = "../../modules/web-frontend"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  project                   = var.project
  domain_name               = var.domain_name
  subject_alternative_names = var.subject_alternative_names
  hosted_zone_id            = data.aws_route53_zone.primary.zone_id
}

###############################################################################
# Outputs
###############################################################################

output "aws_region" {
  description = "Region this environment is deployed in; used by make rollback."
  value       = var.region
}

output "site_url" {
  value = module.web.site_url
}

output "api_url" {
  value = module.api.service_url
}

output "web_bucket" {
  value = module.web.bucket_name
}

output "cloudfront_distribution_id" {
  value = module.web.distribution_id
}

output "ecs_cluster_name" {
  value = module.api.cluster_name
}

output "ecs_service_name" {
  value = module.api.service_name
}

output "database_endpoint" {
  value = module.database.endpoint
}
