# Development values. No secrets belong in this file -- it is committed.
#
# dev-ai.datapainters.com is the development copy of the site. Changes merge
# to main, deploy here automatically, and are promoted to production
# (ai.datapainters.com, later www.datapainters.com) by hand once tested.

project = "advisory-dev"
region  = "us-east-2"

domain_name      = "dev-ai.datapainters.com"
hosted_zone_name = "datapainters.com"

subject_alternative_names = []

# CI overrides this with the image it just built.
api_image = "public.ecr.aws/docker/library/busybox:latest"

api_cpu    = 512
api_memory = 1024

# Smaller than prod: dev holds test data only.
db_instance_class = "db.t4g.micro"

# The first dev admin, created on an empty database. The password is
# generated into Secrets Manager at advisory-dev/bootstrap-admin and must be
# changed at first sign-in.
bootstrap_admin_email = "wes@schiesz.com"

mail_enabled         = true
mail_from            = "notifications@datapainters.com"
mail_from_name       = "DataPainters (dev)"
mail_admin_recipient = "wes@schiesz.com"

# Dev never emails a real client: everything goes here, with the intended
# recipient in the subject line.
mail_redirect_to = "wes@schiesz.com"
