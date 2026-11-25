project = "advisory"
region  = "us-east-2"

github_owner  = "datapainters"
github_repo   = "AiAdvise"
deploy_branch = "main"

# This org issues immutable OIDC subject claims, so the subject carries
# numeric IDs rather than names. Without these the trust policy silently
# never matches. Confirmed against the real subject in CloudTrail:
#   repo:datapainters@14142448/AiAdvise@1463218914:environment:production
github_owner_id = "14142448"
github_repo_id  = "1463218914"
