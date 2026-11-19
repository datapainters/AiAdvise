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
> 3. ~~**Change the portal admin password.**~~ Handled 2026-11-18: the
>    change-password flow exists and `V3__password_change.sql` forces the
>    change at the admin's next sign-in. Nothing left to do but sign in.
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

## 1. Admin flows — clients, engagements and users — done 2026-11-18

Built this increment:

- `POST /api/admin/clients`, `GET /api/admin/clients`
- `POST /api/admin/engagements`
- `POST /api/admin/users`, `GET /api/admin/users`
- An `/admin` screen behind a `ROLE_ADMIN` check: create a client, open an
  engagement against it, issue a portal login, and see every client and
  login with last-sign-in.

The whole `/api/admin/**` path is gated in the filter chain rather than
per method, so a missed annotation cannot quietly open an endpoint.

**How a client user first sets their password.** Decided against mailed
invite tokens for now: they need a mail sender, a token table, expiry, and
a resend path, and none of that earns its keep for the first few users. An
admin creates the login, the system shows a 16-character one-time password
exactly once, and the user is forced to change it at first sign-in. The
handoff is manual and deliberately so. Mailed invites can replace the
handoff later without touching the model — the forced-change machinery is
the part that would have had to be built either way.

The forced change is a real boundary, not a redirect. A user with
`must_change_password` set is issued a token whose role claim is
`PASSWORD_RESET` rather than `CLIENT` or `ADMIN`. It authenticates, so
`/api/auth/me` and `/api/auth/password` work, but every other `/api/**`
route requires a real role and rejects it. A one-time password therefore
cannot read a single client record before it has been replaced. Changing
the password returns a fresh token, since tokens are not revocable.

## 1b. Change password — done 2026-11-18

`POST /api/auth/password` re-verifies the current password (a token can be
lifted from a browser left open, and this is the action that would lock the
real owner out), enforces a 12-character minimum, rejects reuse of the
current password, and clears the forced-reset flag. Two front-end entry
points, same component: `/change-password` for the forced case and
`/account` for a voluntary change.

`V3__password_change.sql` sets `must_change_password = true` on existing
ADMIN rows, so **the bootstrap admin password is forced to change at the
next sign-in** — which closes item 3 of the production gate on first use
rather than needing a separate step. `AdminBootstrap` now sets the same
flag on any admin it creates, so a fresh environment inherits the
behaviour.

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
