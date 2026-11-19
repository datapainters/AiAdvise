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
