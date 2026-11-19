###############################################################################
# Email — Amazon SES for outbound transactional mail.
#
# Why SES: the service already runs in this account with an IAM task role, so
# there is no API key to store anywhere, and à la carte pricing is $0.10 per
# 1,000 emails. At this platform's volume that is a couple of cents a month.
# Resend, Postmark and SendGrid all become $15-20/month past their free tiers
# and each adds a credential and a vendor.
#
# Note AWS introduced bundled SES plans (Essentials/Pro/Enterprise) in July
# 2026, starting at $0.16 per 1,000 plus a fixed monthly fee per account per
# region. The legacy à la carte rate is cheaper and is what an account uses
# unless it opts into a plan. Do not opt in.
#
# ---------------------------------------------------------------------------
# IMPORTANT: this domain already carries live mail.
#
# datapainters.com has Zoho Mail on it: MX records, a zoho._domainkey DKIM
# key, and a zmverify CNAME. Nothing here touches any of those. SES sending
# needs no MX change, and its DKIM keys live under their own selectors, so
# the two coexist.
#
# The one existing record this module corrects is SPF. The zone publishes
# "v=spf1 include:zoho.com ~all" as a type-SPF record (RR type 99), which
# RFC 7208 deprecated in 2014 -- receivers only read TXT. There is no TXT SPF
# at the apex, so the domain effectively has no SPF at all today, which is
# already costing the Zoho mail deliverability. The TXT record below fixes
# that and covers both senders. The old type-SPF record is left alone:
# receivers ignore it, and editing someone's working mail configuration
# beyond what the task needs is risk without reward.
###############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}

variable "domain" {
  type        = string
  description = "Domain to verify for sending, e.g. datapainters.com."
}

variable "hosted_zone_id" {
  type        = string
  description = "Route 53 zone hosting that domain."
}

variable "extra_spf_includes" {
  type        = list(string)
  description = <<-EOT
    SPF includes that must be preserved alongside SES. Anything already
    sending as this domain belongs here or its mail starts failing SPF.
  EOT
  default     = []
}

variable "dmarc_report_to" {
  type        = string
  description = <<-EOT
    Address for DMARC aggregate reports. Keep it on the same domain:
    reporting to another domain additionally requires an authorisation
    record in that domain's zone, which is a second thing to get wrong.
  EOT
}

###############################################################################
# Identity and DKIM
###############################################################################

resource "aws_sesv2_email_identity" "this" {
  email_identity = var.domain

  dkim_signing_attributes {
    # Easy DKIM with a 2048-bit key. AWS rotates it; we publish three CNAMEs
    # pointing at keys AWS holds, so there is no private key in this repo or
    # in state.
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_route53_record" "dkim" {
  count = 3

  zone_id = var.hosted_zone_id
  name    = "${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 600
  records = [
    "${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  ]
}

###############################################################################
# SPF and DMARC
###############################################################################

locals {
  # Order matters only for readability; receivers evaluate all includes.
  # Keep the lookup count low -- SPF allows ten DNS lookups total and each
  # include costs at least one.
  spf_includes = join(" ", [for i in concat(var.extra_spf_includes, ["amazonses.com"]) :
  "include:${i}"])
}

resource "aws_route53_record" "spf" {
  zone_id = var.hosted_zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = 600

  # ~all (softfail), not -all. A hard fail on a domain whose sending sources
  # were previously unenforced is how legitimate mail starts disappearing.
  # Tighten to -all after DMARC reports confirm nothing else sends as this
  # domain.
  records = ["v=spf1 ${local.spf_includes} ~all"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = var.hosted_zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 600

  # p=none is monitoring only: it cannot cause a message to be rejected.
  # It exists to collect reports showing who sends as this domain before
  # anyone considers quarantine or reject.
  records = [
    "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_to}; fo=1; adkim=r; aspf=r"
  ]
}

###############################################################################
# Configuration set — where sending events are counted.
###############################################################################

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = replace(var.domain, ".", "-")

  delivery_options {
    # Refuse to deliver over an unencrypted connection downgrade.
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    # Stop sending to addresses that hard-bounced or complained, account
    # wide. This is the cheap version of bounce handling and the thing that
    # protects a sending reputation at low volume.
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

output "identity_arn" {
  value = aws_sesv2_email_identity.this.arn
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.this.configuration_set_name
}

output "verification_status_note" {
  description = "DKIM verification is asynchronous; check with sesv2 get-email-identity."
  value       = "DKIM CNAMEs published for ${var.domain}; verification completes within minutes"
}
