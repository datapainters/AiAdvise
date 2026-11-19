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
- `GET /api/admin/login-events` (capped at 500 a page)
- An `/admin` screen behind a `ROLE_ADMIN` check, in three tabs: **Clients**
  and **Engagements** are record grids with an Add New button each, and
  **System** is a card grid of tools. Two tools so far: *Sign-in activity*
  and *Portal logins*.

The nav's last item is the signed-in user's name, opening Account and Sign
out beneath it.

**Sign-in activity** reads `login_event` (`V4`), an append-only log of
attempts: who, when, outcome, source address and user agent. It records
failures as well as successes, which is the half worth having, and
`LoginAudit.record` runs in `REQUIRES_NEW` so a failure's row survives the
rollback of the authentication transaction that produced it. The address
comes from `X-Forwarded-For`, which the caller controls — it is displayed as
a claim, and nothing authorizes off it.

Two things to come back to:

- `login_event` only grows, and `POST /api/auth/login` is unauthenticated,
  so anyone can make the table grow. Fine at this size; it wants a retention
  job (or rate limiting on login) before it is left alone for a year.
- There is no rate limiting on login at all yet. The audit log now makes a
  brute-force attempt *visible*, which is a precondition for caring about
  it, but it does not slow one down.

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

## 4. Drop the NAT gateway — done 2026-11-19

The NAT existed so Fargate tasks in private subnets could reach ECR, Secrets
Manager and CloudWatch. Those tasks moved to public subnets when the API had
to be internet-facing (ECS Express Mode derives the load balancer scheme from
the subnet type), so they egress through the internet gateway directly. The
only thing left in the private subnets is RDS, which makes no outbound calls.

The caveat here used to be the EKS lab, whose nodes did sit in private
subnets. That module is now removed (ADR 0001, update 2026-11-19), so the
caveat is gone with it.

Implemented as `enable_nat = false` in the network module rather than by
deleting the resources, because anything placed back in a private subnet
needs egress again — a worker, a batch task, Kubernetes nodes. The default
route moved out of the private route tables into its own `aws_route` so it
disappears with the NAT instead of being a permanent part of the table. The
free S3 gateway endpoint stays for the same reason.

Saving: roughly $33/month plus data processing.

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

## 7. ~~Exercise the Helm path~~ — dropped 2026-11-19

Moot: the EKS lab module is removed and no chart was ever written. A demo
cluster will be stood up separately if an engagement calls for one. See
ADR 0001, update 2026-11-19, for what was kept to make that easy.
