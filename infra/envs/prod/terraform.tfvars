# Production values. No secrets belong in this file -- it is committed.
#
# TODO(wes): set domain_name once you pick between the two candidates.
#   calicheadvisory.com  |  mortisepartners.com
# The Route 53 hosted zone for whichever you choose must exist before the
# first apply; registering the domain through Route 53 creates it for you.

project = "advisory"
region  = "us-east-2"

domain_name               = "example.com"
subject_alternative_names = ["www.example.com"]

# CI overrides this with the immutable image it just pushed. The placeholder
# keeps `terraform plan` runnable from a laptop.
api_image = "public.ecr.aws/docker/library/busybox:latest"

api_cpu    = 512
api_memory = 1024

db_instance_class = "db.t4g.small"

# Flip to true only while you are actually demoing. ~$73/month idle.
enable_eks_lab           = false
lab_admin_principal_arns = []
