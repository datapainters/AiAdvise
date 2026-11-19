# Next steps

Ordered by what would hurt most if left undone.

> ## ⚠ Production readiness gate
>
> Deliberately deferred while this is pre-production and Wes is the only
> admin. **Do these before standing up the production environment**, not
> after:
>
> 1. **MFA on the `wes` IAM user.** It holds `AdministratorAccess` through
>    the `Admins` group and is currently reachable with a password alone.
>    Acceptable for a single-operator sandbox; not acceptable once there is
>    client data, a second admin, or anything a client would ask about.
>    IAM → Users → `wes` → Security credentials → Assign MFA device.
> 2. **Consider enforcing MFA structurally** once it works: a policy on the
>    `Admins` group denying actions when `aws:MultiFactorAuthPresent` is
>    false. Do this only after confirming MFA works, since a mistake locks
>    every admin out at once.
> 3. **Change the portal admin password.** The bootstrap password was read
>    out of Secrets Manager and shared in a chat transcript. It needs the
>    change-password flow (below) to exist first.
> 4. **Remove `noindex`** from `web/index.html` when the site should start
>    being found, and not before.
> 5. **Revisit the deploy role.** It still carries `PowerUserAccess` plus a
>    scoped IAM grant, which was right while the resource set was moving.

## 0. Account access — mostly done 2026-11-18

Audited and acted on:

- **Root MFA**: already enabled. Nothing to do.
- **Root access keys**: none exist. Nothing to delete, and the connector
  does not authenticate with them.
- **`marley`** (IAM user, created 2021-08-31, from the previous business):
  held `AdministratorAccess` via the `Admins` group, with no MFA, an access
  key never used in five years, **and console login still enabled**. The key
  was the visible problem; the unused admin console password was arguably
  the worse one. **Deleted** on 2026-11-18 — key, login profile, policy,
  group membership and user. `wes` is now the only IAM user.
- **`wes`**: created, added to `Admins`, console access with a one-time
  password in Secrets Manager at `admin/wes-initial-console-password`,
  forced reset at first sign-in. **MFA deliberately deferred** to the
  production gate above.

Remaining: switch day-to-day work to `wes` and stop using root. The AWS
connector used for this project authenticates as root, so it would need
reconnecting as `wes` to follow suit.

## 1. Admin flows — clients, engagements and users (now the blocker)

Authentication is done: users live in Postgres, tokens are HS256 signed
with a key from Secrets Manager, and every read and write derives its
engagement from the verified token rather than a request parameter.

What is missing is any way to *create* the things it authorizes. There are
no clients, no engagements, and no client users, so an admin signs in to an
empty portal and the write path has nothing valid to reference. Next
increment, roughly in order: admin endpoints to create a client, open an
engagement against it, and invite a user to that client; then the
corresponding screens behind a `ROLE_ADMIN` check.

Worth deciding at the same time: how a client user first sets their
password. An invite token mailed to them is the usual answer, and it needs
somewhere to send mail from — `datapainters.com` already has Zoho,
so that is probably the path of least resistance.

## 1b. Change password

There is no way to change a password once set. The bootstrap admin
credential is therefore fixed, and it has been through a chat transcript.
A `POST /api/auth/password` taking the current and new password, plus a
small form, is the smallest useful piece of work in this document and
unblocks item 3 of the production gate.

Worth building alongside the admin flows above, since it is the same
screens and the same authorization work.

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

## 4. Drop the NAT gateway — now probably free money

This changed when the API moved to public subnets. The NAT existed so
Fargate tasks in private subnets could reach ECR, Secrets Manager and
CloudWatch. Those tasks are now in public subnets and egress straight
through the internet gateway, and the only thing left in the private
subnets is RDS, which makes no outbound calls.

So the NAT gateway is most likely serving nothing at roughly $33/month
plus data processing. Confirm nothing else routes through it, then remove
it. Note the EKS lab module does place its nodes in the private subnets,
so either restore the NAT or give that module VPC endpoints before
enabling it for a demo.

No interface endpoints needed in the meantime, which is what made this
roughly cost-neutral before and makes it a clear saving now.

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
