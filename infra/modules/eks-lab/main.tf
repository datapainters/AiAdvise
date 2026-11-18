###############################################################################
# EKS lab — an apply-on-demand Kubernetes cluster for client demos and for
# running the same containers under Kubernetes when that is the point.
#
# WHY THIS IS A SEPARATE MODULE, GATED BY A FLAG:
# The EKS control plane bills $0.10/cluster/hour (~$73/month) whether or not a
# pod ever runs, and jumps to $0.60/hour (~$438/month) the moment the cluster's
# Kubernetes version ages out of standard support at 14 months. For a cluster
# you use a few days a month, the right answer is to destroy it between uses:
#
#   make lab-up      # terraform apply -var=enable_eks_lab=true
#   make lab-down    # terraform destroy -target=module.eks_lab
#
# Auto Mode is used deliberately: it manages the node lifecycle for you, so a
# cold cluster costs the control plane fee and nothing else.
#
# >>> VERIFY ON FIRST PLAN <<<
# The Auto Mode argument shape (compute_config / storage_config /
# kubernetes_network_config) is recent. If plan objects, reconcile against the
# aws_eks_cluster docs for your provider version.
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

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnets for the cluster ENIs and Auto Mode nodes."
}

variable "kubernetes_version" {
  type        = string
  description = "Keep this current. Falling to extended support costs 6x."
  # 1.37 is the newest in standard support, which runs to 2027-12-01.
  # Checked against DescribeClusterVersions on 2026-11-17. For reference,
  # 1.34 standard support ends 2026-12-02 -- two weeks out -- so do not
  # pin anything older than this without re-checking.
  default = "1.37"
}

variable "admin_principal_arns" {
  type        = list(string)
  description = "IAM principals granted cluster-admin via EKS access entries."
  default     = []
}

locals {
  name = "${var.project}-lab"
}

###############################################################################
# Cluster role
###############################################################################

data "aws_iam_policy_document" "cluster_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${local.name}-cluster"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume.json
}

# Auto Mode needs more than the classic AmazonEKSClusterPolicy: the control
# plane provisions compute, storage and load balancers on your behalf.
resource "aws_iam_role_policy_attachment" "cluster" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
    "arn:aws:iam::aws:policy/AmazonEKSComputePolicy",
    "arn:aws:iam::aws:policy/AmazonEKSBlockStoragePolicy",
    "arn:aws:iam::aws:policy/AmazonEKSLoadBalancingPolicy",
    "arn:aws:iam::aws:policy/AmazonEKSNetworkingPolicy",
  ])

  role       = aws_iam_role.cluster.name
  policy_arn = each.value
}

###############################################################################
# Node role for Auto Mode managed instances
###############################################################################

data "aws_iam_policy_document" "node_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${local.name}-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodeMinimalPolicy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPullOnly",
  ])

  role       = aws_iam_role.node.name
  policy_arn = each.value
}

###############################################################################
# Cluster
###############################################################################

resource "aws_eks_cluster" "this" {
  name     = local.name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  bootstrap_self_managed_addons = false

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true
  }

  vpc_config {
    subnet_ids              = var.subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  compute_config {
    enabled       = true
    node_pools    = ["general-purpose"]
    node_role_arn = aws_iam_role.node.arn
  }

  storage_config {
    block_storage {
      enabled = true
    }
  }

  kubernetes_network_config {
    elastic_load_balancing {
      enabled = true
    }
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  tags = { Name = local.name }

  depends_on = [aws_iam_role_policy_attachment.cluster]
}

resource "aws_eks_access_entry" "admins" {
  for_each = toset(var.admin_principal_arns)

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "admins" {
  for_each = toset(var.admin_principal_arns)

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.admins]
}

output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "kubeconfig_command" {
  description = "Run this to point kubectl at the lab cluster."
  value       = "aws eks update-kubeconfig --name ${aws_eks_cluster.this.name}"
}
