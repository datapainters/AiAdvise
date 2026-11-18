###############################################################################
# Web front end — React static build in a private S3 bucket, served through
# CloudFront with Origin Access Control. No public bucket, no website
# endpoint, no CORS archaeology.
#
# CloudFront only accepts ACM certificates issued in us-east-1, regardless of
# where the rest of the stack lives. That is why this module takes a second,
# aliased provider rather than inheriting one.
###############################################################################

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = ">= 6.23"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

variable "project" {
  type = string
}

variable "domain_name" {
  type        = string
  description = "Apex domain, e.g. calicheadvisory.com"
}

variable "subject_alternative_names" {
  type        = list(string)
  description = "Extra names on the certificate, e.g. [\"www.example.com\"]."
  default     = []
}

variable "hosted_zone_id" {
  type        = string
  description = "Route 53 zone hosting domain_name."
}

# Serving the API under the same origin at /api/* is the nicer end state, but
# it is deliberately NOT done here. Two reasons, both learned the hard way:
#
#   1. The Express service URL is not known until apply, and a `dynamic`
#      origin block whose for_each depends on it fails to plan.
#   2. CloudFront validates the origin's TLS certificate against the origin
#      domain name. Pointing it at a CNAME of the Express-managed ALB gets a
#      certificate for *.ecs.<region>.on.aws and a hostname mismatch.
#
# So the browser calls the API directly and Spring sets CORS for the site
# origin. To collapse to one origin later, give the API its own ACM
# certificate on api.<domain> and add it as a second origin with a static
# domain name. See docs/next-steps.md.

locals {
  name      = "${var.project}-web"
  all_names = concat([var.domain_name], var.subject_alternative_names)
  s3_origin = "s3-origin"
}

###############################################################################
# Certificate (us-east-1, validated by DNS)
###############################################################################

resource "aws_acm_certificate" "cdn" {
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = var.subject_alternative_names
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cdn.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cdn" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cdn.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

###############################################################################
# Origin bucket
###############################################################################

data "aws_caller_identity" "current" {}

# S3 bucket names are globally unique across every AWS account on earth, so a
# plain "advisory-web" would collide with a stranger's bucket and fail apply
# with a misleading AccessDenied. Suffixing the account id makes it ours.
resource "aws_s3_bucket" "web" {
  bucket = "${local.name}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = local.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}

###############################################################################
# Distribution
###############################################################################

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${local.name}-security-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = local.name
  default_root_object = "index.html"
  aliases             = local.all_names
  price_class         = "PriceClass_100"

  origin {
    origin_id                = local.s3_origin
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = local.s3_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed policies: CachingOptimized / SecurityHeaders passthrough.
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # A single-page app serves its own routes; S3 404s on /portal must come
  # back as index.html with a 200 or client-side routing breaks on refresh.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cdn.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = local.name }
}

###############################################################################
# DNS
###############################################################################

resource "aws_route53_record" "alias" {
  for_each = toset(local.all_names)

  zone_id = var.hosted_zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

output "bucket_name" {
  description = "Sync the built front end here."
  value       = aws_s3_bucket.web.id
}

output "distribution_id" {
  description = "Invalidate this after each front-end deploy."
  value       = aws_cloudfront_distribution.web.id
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "site_url" {
  value = "https://${var.domain_name}"
}
