# Next steps

Ordered by what would hurt most if left undone.

## 0. Stop using root (do this first, it takes ten minutes)

The identity connected to this account is the account root user. Root is the
one principal in AWS whose permissions cannot be reduced, whose access cannot
be scoped to a resource, and which ignores SCPs, permission boundaries and
every other guardrail. If a root access key leaks, the blast radius is the
entire account including the billing console, and the only remediation is
rotating it and auditing everything.

Fix: create an administrative principal — an IAM Identity Center user is the
current recommendation, a plain IAM user with `AdministratorAccess` is the
five-minute version — use that for the bootstrap apply and day-to-day work,
enable MFA on root, and delete any root access keys. The GitHub deploy role
this repo creates is already correctly scoped and does not involve root.

## 1. Authentication (blocking — do this before real client data)

`TopicController` accepts an `engagementId` from the caller and trusts it.
Any client who can reach the API can read and modify any other client's
topics. The portal is unusable with real engagements until this is fixed.

Three options, cheapest first:

- **Cognito user pool.** Hosted sign-in and JWT issuance, free below 50k
  monthly active users, and it integrates with Spring Security as a standard
  OAuth2 resource server. Least code, and the right default for a handful of
  client logins.
- **Spring Security with a local user table.** No new AWS service, full
  control over the invite flow, but you own password reset, session handling
  and the inevitable MFA request.
- **An OIDC provider** (Auth0, WorkOS). Fastest to a polished invite and SSO
  story, and enterprise clients increasingly ask for SAML. Costs real money
  per month.

Whichever you pick, the fix in the API is the same shape: derive the
engagement from the authenticated principal rather than the request body, and
add a `client_user` table joining a subject identifier to an engagement.

## 2. Collapse to a single origin

Today the browser loads the site from CloudFront and calls the API on its ECS
Express hostname, which needs CORS. Serving the API at `/api/*` through the
same distribution removes CORS entirely and shortens the trust story.

It is not done yet because the CloudFront origin must have a stable domain
name with a matching TLS certificate, and the Express-managed ALB presents a
certificate for `*.ecs.<region>.on.aws`. The path forward is to issue an ACM
certificate for `api.<domain>`, attach it to a listener in front of the
service, point a Route 53 record at it, then add it as a second origin with
an `/api/*` cache behaviour using the managed `CachingDisabled` and
`AllViewerExceptHostHeader` policies.

## 3. Secret rotation

`DataSourceConfig` reads the RDS credentials once at startup. If RDS-managed
rotation is enabled, the service keeps using the old password and starts
failing authentication one rotation period after deploy — a failure that
looks like a database outage and is not.

Fix before enabling rotation: wrap credential retrieval in a refreshing
provider, or move to IAM database authentication and drop the stored password
entirely. IAM auth is the better end state and removes a secret from the
system.

## 4. Drop the NAT gateway

At roughly $33/month plus data processing it is the largest fixed line item
after the database. It exists so Fargate tasks can reach ECR, Secrets Manager
and CloudWatch. Interface VPC endpoints for those three services cost about
$7/month each per AZ, so with one AZ the arithmetic is close to neutral — but
removing the NAT also removes the only route from the private subnets to the
open internet, which is a security improvement worth having on its own.

Check first whether the application makes any outbound calls (model APIs,
webhooks, SMTP) that would break.

## 5. Observability beyond CloudWatch

Container Insights is on and the Spring actuator exposes a Prometheus
endpoint that nothing currently scrapes. Before the portal matters: an alarm
on API 5xx rate, one on RDS CPU and free storage, and one on Fargate task
restarts. A CloudWatch dashboard with those three is an afternoon.

## 6. Tighten the deploy role

`PowerUserAccess` plus a scoped IAM grant is deliberate while the resource
set is still changing shape — narrowing it now means re-narrowing it after
every structural change. Once the stack settles, replace it with a policy
generated from the access advisor data for the role.

## 7. Exercise the Helm path

The EKS lab is only useful if it works when you need it. Add a scheduled
monthly workflow that brings the cluster up, deploys the current image,
smoke-tests it and tears it down. Otherwise the first time it gets exercised
will be the morning of a client demo.
