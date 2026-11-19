###############################################################################
# Network — VPC with public and private subnets across two AZs.
#
# NAT is OFF by default (2026-11-19). It existed so Fargate tasks in private
# subnets could reach ECR, Secrets Manager and CloudWatch. Those tasks now run
# in public subnets -- ECS Express Mode derives its load balancer scheme from
# the subnet type, and the API has to be internet-facing -- so they egress
# through the internet gateway directly. The only thing left in the private
# subnets is RDS, which makes no outbound calls, so the NAT was billing
# roughly $33/month plus data processing to route nothing.
#
# It is kept as a flag rather than deleted because anything placed back in the
# private subnets needs it again: EKS nodes, a worker, a batch task. Set
# enable_nat = true and the default route returns. Nothing else in this module
# has to change.
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
  type        = string
  description = "Resource name prefix."
}

variable "cidr_block" {
  type        = string
  description = "VPC CIDR."
  default     = "10.40.0.0/16"
}

variable "enable_nat" {
  type        = bool
  description = <<-EOT
    Give the private subnets a route to the internet via a NAT gateway.
    Only needed when something that makes outbound calls runs in a private
    subnet. RDS does not. Costs ~$33/month per gateway plus data processing.
  EOT
  default     = false
}

variable "single_nat" {
  type        = bool
  description = "With enable_nat, run one NAT gateway instead of one per AZ."
  default     = true
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  public_subnets  = [for i in range(2) : cidrsubnet(var.cidr_block, 8, i)]
  private_subnets = [for i in range(2) : cidrsubnet(var.cidr_block, 8, i + 10)]

  nat_count = var.enable_nat ? (var.single_nat ? 1 : 2) : 0
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.project}-igw" }
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  # The kubernetes.io tags are what a Kubernetes load-balancer controller
  # looks for when choosing subnets. Nothing uses them today, but they are
  # free and they are exactly what a throwaway demo cluster in this VPC would
  # need, so they stay.
  tags = {
    Name                     = "${var.project}-public-${local.azs[count.index]}"
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name                              = "${var.project}-private-${local.azs[count.index]}"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"

  tags = { Name = "${var.project}-nat-${count.index}" }
}

resource "aws_nat_gateway" "this" {
  count = local.nat_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  depends_on = [aws_internet_gateway.this]

  tags = { Name = "${var.project}-nat-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count = 2

  vpc_id = aws_vpc.this.id

  # No inline route. The default route lives in aws_route.private_nat below so
  # it can disappear with the NAT instead of being an unavoidable part of the
  # table. With NAT off these tables carry only the VPC-local route, which is
  # all RDS needs.
  tags = { Name = "${var.project}-private-${local.azs[count.index]}" }
}

# A separate resource rather than an inline route block, for two reasons.
#
# The S3 gateway endpoint below writes its own prefix-list route into these
# same tables via route_table_ids, so a table that manages its routes inline
# would fight the endpoint on every apply.
#
# And inline routes are not removed by deleting the block: with no `route`
# argument present the provider stops managing inline routes rather than
# emptying them. When the NAT was turned off on 2026-11-19 the old inline
# route survived as a blackhole to the deleted gateway and had to be removed
# by hand. As its own resource it disappears with the NAT instead.
resource "aws_route" "private_nat" {
  count = var.enable_nat ? 2 : 0

  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[var.single_nat ? 0 : count.index].id
}

resource "aws_route_table_association" "private" {
  count = 2

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Gateway endpoint for S3. This used to matter because it kept ECR layer pulls
# off the NAT on every deploy; with the tasks in public subnets it no longer
# carries that traffic. Kept because it costs nothing and is needed again the
# moment anything is placed back in a private subnet.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = { Name = "${var.project}-s3-endpoint" }
}

data "aws_region" "current" {}

output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}
