# Production values. No secrets belong in this file -- it is committed.

project = "advisory"
region  = "us-east-2"

###############################################################################
# Interim hostname.
#
# Serving at a subdomain of an existing zone until the real domain is chosen
# (Caliche Advisory or Mortise Partners). datapainters.com is a LIVE zone --
# Zoho mail, an active apex, and ten working subdomains. This stack only ADDS
# records to it (one ACM validation CNAME, one A alias) and reads the zone
# through a data source rather than managing it, so nothing existing moves.
#
# To cut over later: set domain_name to the new apex, set hosted_zone_name
# back to null, and apply. CloudFront keeps the same distribution; only the
# certificate and the alias change. Leave the ai.datapainters.com record in
# place for a while so old links keep working.
###############################################################################

domain_name      = "ai.datapainters.com"
hosted_zone_name = "datapainters.com"

# No www variant for a subdomain.
subject_alternative_names = []

# CI overrides this with the immutable image it just pushed. The placeholder
# keeps `terraform plan` runnable from a laptop.
api_image = "public.ecr.aws/docker/library/busybox:latest"

api_cpu    = 512
api_memory = 1024

db_instance_class = "db.t4g.small"

# The first admin. Created on startup only while the user table is empty, so
# changing this later has no effect -- the account would have to be added
# through an admin flow, or by hand in the database.
#
# Read the generated password once, then change it:
#   aws secretsmanager get-secret-value --secret-id advisory/bootstrap-admin \
#     --query SecretString --output text
bootstrap_admin_email = "wes@schiesz.com"

# Flip to true only while you are actually demoing. ~$73/month idle.

# Mail. On as of 2026-11-19, while SES is still in the sandbox.
#
# In the sandbox only verified recipients receive anything, so right now
# this means the firm-side notifications reach wes@schiesz.com and any
# client-facing message is rejected and logged. That is a strictly better
# state than disabled: the half that can work, works, and MailSender
# swallows the rejections rather than failing the action that triggered
# them. Nothing changes here when production access is granted -- the
# client-facing half simply starts arriving.
mail_enabled         = true
mail_from            = "notifications@datapainters.com"
mail_from_name       = "DataPainters"
mail_admin_recipient = "wes@schiesz.com"
