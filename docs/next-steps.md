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

## 3. Secret rotation — done 2026-11-19

`DataSourceConfig` used to read the RDS credentials once at startup. With
rotation enabled, the service would have kept presenting the startup password
and begun failing authentication one rotation period later — a failure that
looks exactly like a database outage and is not one.

**RDS now owns the master password** (`manage_master_user_password = true`)
and rotates it in Secrets Manager every seven days by default. This is
*managed* rotation, which uses no Lambda. That mattered: a Secrets Manager
rotation Lambda has to run inside the VPC to reach Postgres, and with the NAT
gateway gone (section 4) that would have meant adding a Secrets Manager
interface endpoint at roughly $7/month per AZ in order to rotate one
password. Managed rotation needs neither.

The hand-rolled `advisory/database` secret is gone. It held a generated
password plus a `jdbc_url`, and the moment RDS took over the password the
copy in it became both wrong and misleading. The managed secret holds
username and password only; host, port and database name now arrive as plain
environment variables. That split is deliberate — a rotation then changes
only the credential, never the connection target.

### The part that would have silently failed

HikariCP can change a pool's password at runtime via
`HikariConfigMXBean.setPassword`, but its contract is narrow: the change
applies to new connections only, and it **only works for DataSource-based
pools, not for Driver-class or JDBC URL-based ones**. This pool was built
with `setJdbcUrl` — precisely the case where a runtime password change is
accepted and then ignored. Wiring the refresher against it would have
compiled, logged success, and failed a week later.

So the pool is now built around an explicit `PGSimpleDataSource`. The
Postgres driver also had to move from `runtime` to compile scope, since the
code now names the driver's DataSource class.

### Probe before apply

`DbCredentialRefresher` polls the secret every 60 seconds. The obvious
implementation — read, `setPassword`, evict — has a nasty failure mode: a
secret read midway through a rotation would evict working connections and
replace them with ones that cannot authenticate. Instead a candidate
password is opened as a real connection first, and applied only if that
succeeds. A failed probe changes nothing and retries on the next tick.

Residual exposure is about one minute: if RDS changes the password at the
worst moment, *new* physical connections can fail until the next poll.
Existing ones are unaffected, because Postgres does not invalidate live
sessions when a role's password changes. `maxLifetime` of 10 minutes is the
backstop — the pool fully turns over far inside a seven-day period even if
the refresher never fired.

Refresh state is exposed in `/actuator/health` details, so a quietly stuck
rotation is visible before the pool next needs a connection. Health stays UP
on a failed refresh: while the current credential still works the service is
healthy, and failing a task over a secret read would turn a recoverable
condition into an outage. Details are `when-authorized` because the load
balancer polls that endpoint unauthenticated.

### Verified live, 2026-11-19

Not assumed — forced a real rotation with
`modify-db-instance --rotate-master-user-password --apply-immediately`,
which is the same operation RDS runs on its own schedule:

- The password in the managed secret genuinely changed.
- `17:09:00  DbCredentialRefresher : Database credential in ...:*** has
  changed; verifying before applying`
- `17:09:00  DbCredentialRefresher : Applied rotated database credential for
  user advisory_app and evicted the connections holding the previous one`
- Zero probe failures, zero authentication failures on the healthy task,
  zero ERROR lines in the window, service steady at 1/1 with a healthy
  target.

The authentication failures visible in CloudWatch between 16:51 and 17:08:35
are the *previous* task, which was holding the pre-transition password while
it drained. They stop when it does, and they are the thing this change
exists to prevent recurring.

### What this costs

- **No read replicas.** You cannot create one while credentials are managed
  this way (every engine except SQL Server and Db2). None exist or are
  planned on a db.t4g.small. If one is needed, turn
  `manage_master_user_password` off first.
- **`apply_immediately = true`** on the instance now. Deliberate: the
  alternative is changes landing in the Sunday 09:30 maintenance window, so
  breakage would happen when nobody is watching instead of during a deploy
  someone is.
- **Deleting the instance deletes the managed secret.** Nothing orphaned,
  and nothing to recover it from either.

### Still worth doing

- The app connects as the **master user**. A least-privilege application role
  would be better, and is a prerequisite for IAM database authentication,
  which would remove the stored password entirely. The ordering is awkward —
  creating an IAM-authenticated role requires connecting as master — so it
  wants its own change rather than riding along with this one.
- `sslMode` is `require`, which encrypts but does not verify the server
  certificate. `verify-full` needs the RDS CA bundle in the image.

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

Verified before applying: the private subnets held exactly one network
interface, an RDS one, and the NAT had logged 18 consecutive hours of zero
bytes out — its only traffic in three days was 20:09–21:09 UTC on 11-18,
the window when the API tasks were still in private subnets.

Verified after: NAT `deleted`, its Elastic IP released, private route tables
down to the VPC-local route plus the S3 endpoint prefix list, and the API
back up at 16:13:50 with Hikari connected to Postgres — so the image pull,
the Secrets Manager read and the database all still work without it.

One wrinkle worth knowing if `enable_nat` is ever set back to true: removing
the old inline `route` block did **not** delete the route. With no `route`
argument present the provider stops managing inline routes rather than
emptying them, so the route survived as a blackhole pointing at the deleted
gateway and had to be deleted by hand. Traffic-wise a blackhole and no route
behave the same, but it would have collided with `aws_route.private_nat` on
the way back. That is why the default route now lives in its own resource.

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

## 8. Deploys kill a task on ELB health checks every time

Noticed while verifying section 3, not caused by it. Every deploy today left
a task stopped with `Task failed ELB health checks`, across task definition
revisions 12 through 15 — including deploys that completed successfully and
passed their smoke test. The pattern is consistent: a task runs fine for
roughly eight minutes, logs no application errors at all, then gets a
graceful shutdown.

The service ends up healthy and steady each time, so this is not currently
breaking anything, which is exactly why it is worth writing down before it
is load-bearing. Express Mode runs two taskSets and two target groups during
a rollout and drains the old one, so some of this is normal blue/green
churn being reported in alarming language. But eight minutes is a strange
number for that, and the health check is `/actuator/health/readiness` with
`healthy_threshold: 5` at a 30-second interval — 150 seconds of consecutive
passes against an application that takes ~51 seconds to boot.

Worth an hour with target-group health-check history to find out whether
tasks are actually flapping or ECS is just narrating a normal drain badly.
If they are flapping, deploys are slower and less reliable than they look,
and the first real symptom will be a deploy that does not converge.

## 9. Email — SES, done 2026-11-19 (two manual steps outstanding)

Chosen over Resend, Postmark and SendGrid on cost and credential surface.
A la carte SES is $0.10 per 1,000 emails, so this platform's volume is
roughly two cents a month; the others reach $15–20/month past their free
tiers and each adds an API key to store. The task role already has an IAM
identity, so there is no secret involved at all.

**Do not opt into the bundled SES plans.** AWS introduced
Essentials/Pro/Enterprise in July 2026 starting at $0.16 per 1,000 plus a
fixed monthly fee per account per region. The legacy à la carte rate is
cheaper and applies unless the account opts in.

### What it touched, and what it did not

datapainters.com runs Zoho Mail. Its MX records, `zoho._domainkey` key and
`zmverify` CNAME are all untouched and verified so after the deploy — SES
needs no MX change and its DKIM uses its own selectors.

One existing record was corrected. The zone published its SPF as a
**type-SPF record** (RR type 99), which RFC 7208 deprecated in 2014;
receivers read only TXT, and there was no TXT SPF at the apex. So the
domain effectively had no SPF at all, and the Zoho mail had been paying for
it. The apex now carries
`v=spf1 include:zoho.com include:amazonses.com ~all`.

Softfail rather than `-all`: a hard fail on a domain whose sending sources
were never enforced is how legitimate mail starts disappearing. Tighten
once DMARC reports confirm nothing else sends as this domain. The old
type-SPF record was left in place — receivers ignore it, and editing a
working mail configuration beyond what the task needs is risk without
reward.

DMARC is published at `p=none`, which is monitoring only and cannot cause a
rejection.

### Design

Sending never fails the thing that triggered it. Every send is a side
effect of an action the user already completed, so a throttle, an
unreachable endpoint or a suppressed recipient is logged and swallowed, not
rolled back. All three notifications fire *after* their transaction
commits — announcing something that then rolls back is worse than
announcing it late, and an email cannot be unsent. The trade is that a lost
email is quiet, which is why every send logs on the way out.

The account-ready email carries **no password**. The credential and the
door do not belong in the same envelope. See the follow-up below.

IAM is scoped to the one verified identity rather than `*`, so a bug cannot
send as another domain this account verifies later.

### Verified live, 2026-11-19

A real send arrived in the inbox, not spam, with the headers Google wrote
on it reading `dkim=pass header.i=@datapainters.com` on the new selector,
`spf=pass`, and `dmarc=pass header.from=datapainters.com`. DMARC passes on
DKIM alignment; SPF aligns to `amazonses.com` because the envelope sender
is theirs, which is expected without a custom MAIL FROM.

**Production access granted the same day.** The account moved from the
sandbox (200/day, 1/sec, verified recipients only) to 50,000/day at 14/sec,
enforcement HEALTHY. No code or configuration changed for that — the
client-facing half simply started arriving, which is what `mail_enabled`
being independent of sandbox state was for.

### Still worth doing

- **Tighten SPF and DMARC.** Once aggregate reports confirm nothing
  unexpected sends as the domain, move SPF from `~all` to `-all` and DMARC
  from `p=none` to quarantine. Do not do it before the reports.
- **Custom MAIL FROM subdomain** would align SPF as well as DKIM. Optional:
  it adds an MX record and a failure mode, and DKIM alignment alone already
  passes DMARC.
- **The DMARC `rua` address** is `dmarc@datapainters.com`. Create that
  alias in Zoho or the reports bounce.

## 10. Invite links — done 2026-11-19

The one-time password handoff is gone. The invitation email carries a
single-use link that expires in seven days; the recipient sets their own
password, so no password the firm knows ever exists for a client account.

- Accounts are created with a BCrypt of two random UUIDs. `password_hash`
  is NOT NULL and an account awaiting its invite must not be reachable by
  any password; a well-formed hash matching nothing beats a sentinel some
  later comparison might treat as empty.
- `invite_token` stores a **SHA-256 of the token, never the token**. Fast
  digest rather than BCrypt on purpose: 256 bits of CSPRNG output has no
  dictionary to resist, and a per-row salt would make lookup by token
  impossible without scanning the table.
- Issuing an invite deletes the user's outstanding ones, so re-inviting
  cannot leave an earlier link live in a forwarded mailbox. That makes
  "Resend invite" double as a revoke.
- Expired, already redeemed and never existed all answer **404**.
  Distinguishing them would tell someone holding a stale link whether it
  was ever real.
- Redemption sets the password and marks the token used in one
  transaction. A failure between the two would consume the token without
  setting a password and lock the account out permanently.
- The two invite routes are unauthenticated by necessity — the person
  using them has no password yet — and permitted explicitly in the filter
  chain. Acceptance is recorded in the sign-in audit.

The admin still sees the link even when the email sent, because mail goes
missing and a working fallback beats re-issuing. When it did not send, the
copy says so rather than letting an admin assume it did.

**Exercised end to end on 2026-11-19.** Wes followed a real invite link, the
account was created, and the portal opened signed in. The flow works.

What the test surfaced: the second user under a client could see the first
user's topics. Not a cross-client leak — authorisation was being applied
consistently, and correctly, to the rule as written. The rule was the
problem. See below.

## Topic ownership (V8, 2026-11-19)

Topics are now private to the user who created them, including from other
users of the same client.

Before V8 a topic belonged to an engagement, and an engagement belongs to a
client, so "may this caller see this topic" resolved to "is this caller at
this client". Every user invited under a client therefore saw that client's
entire topic backlog and could close any of it. Three client-facing paths
relied on that rule and all three were changed:

| Path | Was | Now |
| --- | --- | --- |
| `GET /api/topics` | engagement ∈ caller's client | ...and topic created by caller |
| `PATCH /api/topics/{id}/status` | engagement ∈ caller's client | ...and topic created by caller |
| `POST /api/appointments` → `attach` | topic ∈ engagement | ...and topic created by caller |

The third mattered as much as the first. Making topics private to read but
not private to *use* would have left a hole: naming a colleague's topic id
when booking moves that topic onto an agenda the caller can then open.

Admin paths are deliberately unscoped — the engineer running a meeting needs
the whole agenda, whoever on the client side raised each item.

Refusals are 404, not 403, and `attach` reuses the "does not exist" wording.
Ids are sequential, so a 403 on a guessed id would let one user count a
colleague's topics without reading any of them.

Backfill: rows predating the column were attributed to the earliest CLIENT
user of the engagement's client. That cannot widen visibility, since those
users could all already see the row. Where a client had no users the row is
left null; null never matches a caller, so it is admin-visible only.

### Two open questions this raises

1. **An admin creating a topic now owns it**, so no client user can see it.
   There is no admin UI that creates topics, so this is only reachable by
   direct API call — but if engineers should be able to add agenda items a
   client can see, that needs its own rule.
2. **Appointments and notes are still client-scoped, not per-user.** User B
   can see that a meeting User A booked exists, and its topic *count*, though
   not the topics. Meeting notes are admin-only. Worth deciding whether a
   meeting is a personal or a company-level thing before more users land on
   one client.

## Browser test sweep (2026-11-20)

Drove the admin and portal screens in Chrome against the live site as an
admin, with test records created through the UI. Five clients, two
engagements, one appointment, two topics, one meeting note, one invited
user (`client3@schiesz.com`, "QA Tester", under client 1).

### Fixed in this pass

| Defect | Cause |
| --- | --- |
| Grid sorting was case-sensitive | `String` is `Comparable`, so the generic branch in `Grid.compareValues` claimed every text column; the `compareToIgnoreCase` below it was unreachable |
| Descending sorts put empty cells first | `Comparator.nullsLast(..).reversed()` reverses the null handling too |
| Redeeming an invite recorded no sign-in | `InviteService.accept` issues a session but never set `last_login_at` |
| A client's "Portal logins" counted accounts | It rendered `users.length` under a label that reads as activity |

The sort bug mattered more than it looks: filters have always matched
case-insensitively, so the two halves of the same grid disagreed about
what case means. The nulls bug came out of writing the test, not off the
screen — the seed data has no empty cells.

`GridTest` is new and covers sorting, filtering and paging. Paging had
never been exercised at all: every grid has only ever been seen with five
rows against a minimum page size of ten.

### Confirmed working

Filter tagging (type-aware operators, multi-tag AND, removal, clear all,
per-tab reset), sortable headers with a single-column indicator, create
and edit for clients and engagements, the client detail popup and its tab
counts, add-user with first/last/email/company/phone, the invite email,
the full booking flow in 30-minute blocks with correct end times, the
Meeting Manager with per-topic notes and dirty-state tracking, the agenda
`n/m noted` counter, confirm, the sign-in audit log, and the three
notification emails.

### Open

1. **A meeting confirmation reached one of a client's two users.**
   `Notifications.meetingConfirmed` loads every enabled user for the
   client and `MailSender.sendAll` loops over them, and both users are
   enabled on the same client — but only `client2@schiesz.com` got the
   mail, not `client3@schiesz.com`, which had received its invite
   minutes earlier. `MailSender` swallows failures by design, so a send
   that threw would leave no trace in the response. Needs the service
   logs to tell an un-attempted send from a failed one. **Not yet
   diagnosed; do not assume the code is wrong.**
2. **A topic can strand in `scheduled` with no appointment.** `topic 1`
   is in that state, and because the portal offers only `proposed`
   topics, it cannot be scheduled and cannot be dropped from any
   meeting — it just sits there. The "Schedule a meeting" button stays
   disabled whenever every topic is stranded. Worth a migration to
   return orphaned `scheduled` topics to `proposed`, plus whatever
   created the state in the first place.
3. **Date filters compare in UTC; the grids render local dates.** A row
   displaying 11/18 is excluded by "Added less than 2026-11-19" when its
   instant is early on the 19th UTC. The engine is right and the filter
   works; the two halves just disagree about the timezone.
4. **The filter value box is `type=text` even for date columns**, so the
   format is a guess. The operators go type-aware already; the input
   should too.
5. **Booking offers all 48 half-hour slots**, midnight included. No
   business-hours constraint.
6. Stale notices persist across admin tab switches.
7. Dates render `11/20/2026` in Clients and `2026-11-20` in Engagements.
8. Sortable headers are plain `generic` elements, so sorting is not
   reachable from the keyboard.

## Browser test sweep and UI pass (2026-11-21)

Two halves. The **client portal** was driven in headless Chromium against
the live site as `client3@schiesz.com` (QA Tester, client 1), after
redeeming its invite. The **admin console** was driven against a local
stack (Postgres 16 + the API jar on the `local` profile + Vite), because
the invite issues a CLIENT account and admin screens need an ADMIN one.

Records left on the live site by the test: topic 3 *QA: Data warehouse
readiness* (now scheduled), topic 4 *QA: Topic to drop* (dropped), and
appointment 2 on 2026-12-01 10:00 UTC (requested), which will also have
sent the admin a meeting-request email.

### Confirmed working

Invite redemption and the 12-character rule, sign-in, add topic, drop
topic, the booking flow end to end, the admin redirect for a client
account, forced password change for the bootstrap admin, client and
engagement create/edit, duplicate-email rejection (409), HTML5 email
validation, filtering, sorting, paging, the client detail popup and all
its tabs, portal login invites, the Meeting Manager's notes and confirm,
editing a meeting's length, and the sign-in audit.

### Fixed in this pass (web only, no API changes)

| Was | Now |
| --- | --- |
| Admin was the marketing page with tabs | Full-screen console: sidebar navigation, page header, an **Overview** dashboard (client count, active engagements, meetings awaiting confirmation, upcoming meetings, and both lists clickable into the Meeting Manager), view kept in the URL (`/admin?view=clients`) |
| No confirmation after a save | Toasts on create and edit |
| Errors rendered `409 Conflict: {"timestamp":…}` | `friendlyError` in `api.ts` maps status to a sentence; a server `message`/`detail` still wins |
| Admins landed on the empty client portal after sign-in and after the forced password change | They land on `/admin` |
| Open item 5: 48 slots, midnight included, weekends open | Weekdays, 8:00 AM–5:30 PM local start times (`OPEN_HOUR`/`CLOSE_HOUR` in `scheduling.tsx`). The API still accepts any boundary, so admins can override |
| Clients could book against a paused or closed engagement | Booking lists active engagements only, and preselects the one chosen on the topics tab |
| Open item 6: stale notices across tab switches | Cleared on every view change; notices are dismissible |
| Open item 7: `11/20/2026` vs `2026-11-20` | One format, `Nov 20, 2026`, with bare dates read as calendar days |
| Open item 8: sort headers unreachable by keyboard | Each sortable header is a `<button>` |
| `1 topics` | `plural()` helper |
| Drop topic and cancel meeting had no confirmation | `confirm()` before both |
| Native, mismatched selects and inputs | One control style: height, radius, chevron, focus ring; sentence-case labels; primary/secondary buttons |

### API fixes in the same pass

| Was | Now |
| --- | --- |
| Every create response had `createdAt: null` (and engagements `startedOn: null`) — the column default filled the row but the entity never read it back | Entities set `createdAt = Instant.now()` (and `startedOn` to today in UTC) before insert |
| Bookings on a paused or closed engagement were accepted by the API | `SchedulingService.book` refuses them with 409 "Engagement n is paused and not open for new meetings", admins included |
| Every `ResponseStatusException` reason was dropped; clients saw only `{"error":"Conflict"}` | `spring.mvc.problemdetails.enabled`: reasons arrive as `detail` and the web client shows them. Unhandled exceptions still go to the default error body with no message |

### Still open

1. **Client names are not unique.** Two clients called *Northwind
   Traders* with different emails are accepted. Either a unique index on
   `lower(name)` or a "did you mean" warning in the form — a product call.
2. **Business hours are enforced in the browser only.** The server does
   not know the client's time zone, so it cannot apply 8–5:30 local;
   admins rely on that freedom when editing. Leave unless it is abused.
3. Items 1–4 of the 2026-11-20 list are untouched.

## Billing, accounting, inquiries and the new marketing site (2026-11-21)

### What shipped

- **Marketing site** (`web/src/marketing.tsx`, `marketing.css`): Home,
  Services, Approach and a `/book` consultation flow, built around the three
  practices (Corporate AI Development, AI Data Development, Development Team
  AI Enablement). Every page drives to a free 30-minute consultation. The
  hourly rate shown comes from `GET /api/public/info`.
- **Website inquiries** (`publicsite/`): `POST /api/public/consultations`
  creates or reuses the client (by primary email), an engagement in the new
  `inquiry` status, a 30-minute **non-billable** appointment and its topics,
  then emails the firm (the *Inquiry notification email* option, else
  `MAIL_ADMIN_RECIPIENT`) and the person who asked. Honeypot field, 5
  requests per address per hour, double-booking refused with 409.
- **System options** (`system_option` table, admin *System → System
  options*): hourly rate, payment terms, invoice prefix, invoice footer,
  inquiry email. Values are validated by type.
- **Time tracker** in the Meeting Manager: start/stop timer (one running per
  meeting), manual entries, delete. **Marking a meeting complete compiles
  its time into a charge**: total minutes rounded up to 30-minute blocks, at
  half the hourly rate per block. The rate is copied onto the charge.
  Re-completing recalculates unless the charge is already invoiced.
- **Meeting Summary Report**: printable page per meeting (agenda, notes,
  time, charge).
- **Accounting tab** on the client record: balance, unbilled, invoiced and
  paid; record payments (applied to an invoice or on account); charge/credit
  adjustments; invoice all unbilled charges; void with a reason; printable
  statement.
- **Billing**: Invoices and Payments lists. Invoices number from a sequence
  (`INV-0001`), are due after the payment terms, and can be voided only
  while no payment is applied — voiding releases the charges.
- **Reports**: Accounts receivable (aged current / 1–30 / 31–60 / 61–90 /
  90+, with unbilled and credits so Balance = charges − payments), Revenue &
  hours (by month and client, billed vs collected), Unbilled work (plus
  meetings whose billing needs attention). CSV export and print on each.

### Decisions worth knowing

- **The hourly rate ships at $0.00.** Set it in *System options* after the
  deploy. Until then charges compile at $0 and the website says "contact us
  for rates"; the admin Overview shows a warning.
- Financial rows are never deleted, only voided; billing tables reference
  `client` with `ON DELETE RESTRICT`.
- Billing uses `JdbcClient` rather than JPA entities: it is almost all
  aggregates.
- Print pages open in a new tab **without `noopener`**, because the session
  token is in `sessionStorage` and only an opener-linked tab inherits it.

### Still open

1. Invoices are printed/PDF'd from the browser; nothing emails them yet.
2. No online card payments; payments are recorded by hand.
3. The public rate limit is in memory per task.
4. Converting an inquiry into a client relationship is manual: set the
   engagement to *active* and invite a portal user.

## Client portal redesign and client billing (2026-11-21)

- `/portal` is now a full-screen application like the admin console, with
  a light sidebar: **Overview** (next meeting, open topics, amount due, time
  billed, coming up, recent invoices), **Topics** (open / on a meeting /
  closed board, add in a dialog), **Meetings** (upcoming and past, book in a
  dialog, cancel) and **Billing**. The view is kept in `?view=`.
- **Billing for clients** (`GET /api/billing`, `/api/billing/invoices/{id}`,
  `/api/billing/statement`), always scoped to the client in the token:
  amount due (open invoice balances less credit on account), overdue, paid
  to date, time billed in 30-minute blocks, invoices with View / PDF,
  payments, billed time by month, a downloadable statement, how billing
  works (rate, increments, terms) and the payment instructions from the
  *Invoice footer* option. Voided records and internal fields are never
  returned; another client's invoice reads as 404.
- An admin previewing `/portal` does not call the client billing endpoint:
  the API client treats 403 as an expired session and would sign them out.

## Video meetings on Daily (2026-11-21)

- **Rooms.** Confirming a meeting creates a private Daily room
  (`dp-m<id>-<random>`) that expires two hours after the scheduled end.
  Rescheduling moves the expiry; cancelling (by the firm or the client)
  deletes the room. Daily being unreachable never blocks confirming or
  cancelling: the Meeting Manager shows "No video room" with a *Create
  video room* button.
- **Joining.** Links are issued per person on click, never stored. Clients
  get a non-owner token that works from 15 minutes before the start until
  the room closes, and only for their own confirmed meetings; the firm gets
  an owner token at any time (*Join as host*).
- **Email.** Clients with portal logins are pointed at the portal to join.
  A client with no logins — a website inquiry — gets a direct, personal
  join link at the client's primary email when the meeting is confirmed.
- **Billing.** *Import call time* in the time tracker replaces the meeting's
  single `video` time entry with the measured length of finished calls that
  had **two or more participants** (a host waiting alone is not billed).
  Completing a meeting with no time recorded imports it automatically.
- **Configuration.** The API reads the key from Secrets Manager
  (`advisory/daily-api-key`, `DAILY_API_KEY_SECRET_ARN`), or `DAILY_API_KEY`
  locally. Terraform creates the secret but never its value. Without a
  value, video is simply off, and the API re-checks every five minutes, so
  setting the key needs no redeploy:

  ```
  aws secretsmanager put-secret-value --secret-id advisory/daily-api-key \
    --secret-string '{"key":"<Daily API key>"}'
  ```

- Not verifiable from the build sandbox: a real two-person call (the
  browser cannot reach `*.daily.co` from there). The call-time rule is
  covered by `CallTimeTest` against the documented `/meetings` fields.

## Calendar, hours of operation and engagement costs (2026-11-21)

- **Calendar** (admin *Workspace → Calendar*): month and week views of
  every client meeting from `GET /api/admin/calendar?from&to` (window capped
  at 100 days), coloured by status, cancelled hidden by default. The week
  view shades business hours converted into the viewer's time zone and
  marks the current time. Clicking a meeting opens the Meeting Manager.
- **Hours of operation** (*System options*, option `business_hours`, type
  `hours`): per-weekday open/close in half-hour steps plus the business
  time zone, seeded with the rule that was hard-coded before (Mon–Fri
  8:00–18:00, America/Chicago). The editor shows the current hours in
  words and whether the business is open now. Published in
  `/api/public/info`; the portal booking form and the website `/book`
  page offer only starts that fit the meeting inside the hours, shown in
  the visitor's local time. **Enforced on the server** for client and
  website bookings (`BusinessHours.contains`); admins can still book or move
  meetings outside hours.
- **Engagement costs** (*Reports → Engagement costs*): per engagement,
  billed revenue against costs and margin. Video cost is Daily usage
  copied into `video_session` (participant-seconds per call) at the
  `video_cost_per_participant_minute` option (default $0.004 — check your
  Daily plan). Usage is synced when call time is imported, when a meeting
  with a room is completed, before a room is deleted, and on demand with
  *Sync video usage*. Other costs (software, subcontractor, travel, other)
  are entered per engagement and voided rather than deleted.

## Meeting room toolbar, video billing report, dev and production (2026-11-21)

### Meeting room

Joining a call now opens **our** page, `/meet/<id>`, with the Daily call
embedded (daily-js `createFrame`) and a Data Painters toolbar under it:

| | Host | Client / guest |
| --- | --- | --- |
| Share from library (templates as PDF or image, pre-recorded video, images) | yes | |
| Share screen (Daily) | yes | yes |
| Share a screenshot (one frame of a chosen window or tab) | yes | yes |
| Share an image (upload) | yes | yes |
| Shared items (history; hosts can show an item again) | yes | yes |

Shared items appear on a **stage** beside the video for everyone. The
stage is kept in step with Daily app messages; the host replays the
current item to late joiners and drives video playback for everyone.
Files live in a private S3 bucket per environment
(`<project>-media-<account>`), reached only through presigned URLs the API
issues after checking the caller. Meeting screenshots expire after a year.

Access: `POST /api/meet/{id}/session` takes a login (client or admin) or a
**guest key**. The link in a website inquiry's confirmation email now
points at `/meet/<id>?k=…` rather than at Daily. The session returns the
Daily URL and a meeting token (`X-Meet-Token`) for the share endpoints.
Meeting tokens are signed with a key derived from, but different to, the
login key, so neither can stand in for the other.

The **Media library** (admin Workspace) manages what hosts can share.

### System reporting → Video conference billing

Per customer per month: meetings held over video (a room that recorded at
least one call), calls, call minutes, participant-minutes, the amount
billed for those meetings and the video cost. Pivot by month plus detail,
CSV and print.

### Environments

| | Development | Production |
| --- | --- | --- |
| Site | https://dev-ai.datapainters.com | https://ai.datapainters.com (moving to www.datapainters.com) |
| Terraform | `infra/envs/dev`, project `advisory-dev` | `infra/envs/prod`, project `advisory` |
| Deploys | automatically on every merge to `main` (*Deploy development*) | **by hand**: Actions, *Deploy production*, Run workflow, on the commit tested in dev |
| Database | its own, `db.t4g.micro`, test data | production data |
| Email | every message redirected to `mail_redirect_to` (dev tfvars), intended recipient in the subject | real recipients |
| Daily rooms | prefixed `dev-` | prefixed `dp-` |
| Banner | yellow "Development site" ribbon | none |

Production reuses the image dev built for the same commit, so it runs
exactly what was tested. Each environment has its own secrets
(`advisory-dev/...`), including its own Daily key secret.

## Team roles, engagement manager and in-call tools (V13, 2026-11-25)

**Team members.** Staff accounts are still `role = ADMIN` ("is staff") and
now carry a `team_role`: `admin`, `billing`, `relations` or `engineer`.
Admin → System → **Team** invites people with the same single-use link
clients get, changes roles and disables accounts. Existing admins were
migrated to `admin`.

What each role reaches is enforced by path in `SecurityConfig` and mirrored
in the console's navigation:

| | admin | billing | relations | engineer |
|---|---|---|---|---|
| Clients, engagements, meetings, media, calendar | yes | yes | yes | yes |
| Invoices, payments, charges, financial reports | yes | yes | no | no |
| Client portal logins screen | yes | no | yes | no |
| Team, sign-in activity, changing system options | yes | no | no | no |

Authorities are read from the account row on every request rather than from
the token (`SecurityConfig.jwtAuthenticationConverter`). One primary-key
lookup per request buys immediate effect: disabling someone locks them out
on their next call, and a role change does not wait for their 12-hour token
to expire. The same change closes the old gap for disabled client logins.

Guard rails in `TeamController`: nobody changes their own role or disables
themselves; the last enabled administrator cannot be demoted or disabled;
only an administrator can send a reset link for a staff account (otherwise a
link to an administrator's account would be a way to become one).

**Engagements.** An engagement has a `goal`. Clicking a row in the
Engagements list opens the Engagement Manager: Overview (goal, title,
status), Meetings, Agenda & notes (every topic, grouped by the meeting it was
discussed in), Media (everything put on screen in its meetings), Team, and
Billing. Billing shows what the engagement has been charged, invoiced and
has unbilled, and can raise an invoice for just this engagement's unbilled
charges. The billing figures are omitted from the response for roles that
do not handle money.

**People.** `engagement_member` and `appointment_participant` hold people
from both sides with the part they play. A client contact must belong to the
engagement's client and take a client-side role; staff take a Data Painters
role. A meeting adds two flags per person: on the call, and sent the summary.
"Add the engagement team" copies the engagement's team onto a meeting.

**Meeting summary email.** Marking a meeting complete mails the agenda, the
notes and the recorded time to participants flagged "sent the summary". It
goes once per meeting (`appointment.summary_sent_at`), and a mail failure
never fails the completion.

**Meeting Manager** now has tabs: Agenda & notes, Users, Time & billing,
Media.

**In the call window.** The host sees an Agenda and notes panel beside the
video with a note field per topic, and the meeting timer. The timer starts
when a host joins the call and stops when the last host leaves or closes the
tab; Start and Stop are there for anything the automatic rule gets wrong.
These endpoints live under `/api/meet/{id}` and accept only the room's host
token, so clients and guests cannot read notes or touch the clock.

Left open:

- **The automatic timer has not been watched in a live call.** The start and
  stop endpoints were exercised directly and the panel was checked in a
  browser, but the test environment could not join a Daily call, so the
  join/leave wiring needs one real call on dev to confirm.
- A host whose browser crashes leaves the timer running until someone stops
  it or the meeting is completed. Completing a meeting with a running timer
  bills up to that moment.
- Roles are fixed in code. If the split above turns out wrong for how the
  team actually works, change the matchers in `SecurityConfig` and `canSee`
  in `web/src/App.tsx` together.
- Payments are recorded against invoices, not engagements, so "paid" is not
  shown per engagement; an invoice raised from an engagement carries the
  engagement's title in its notes.

## Engagement dates, notes and files; meetings created in the console (V14, 2026-11-25)

- **Dates.** An engagement's start date is now editable and it has an
  optional target date (`due_on`), shown in the list and flagged "Past due"
  in the Engagement Manager once it passes on an open engagement. The target
  date cannot be before the start date.
- **Notes.** `engagement_note` holds notes about the engagement as a whole,
  added, edited and deleted from the new Notes tab. An edit keeps the
  original author and shows when it was edited. The tab that lists notes
  taken in meetings is now called Meeting notes, and each of those can be
  edited in place.
- **Files.** `engagement_media` attaches files to an engagement: a new upload
  (PDF, image or MP4/WebM video, stored under `engagements/{id}/`) or an item
  from the media library. Removing a file detaches it; the stored object is
  left in the bucket, and nothing sweeps those up yet.
- **Meetings.** Meetings have an optional `title`. Add New on the Meetings
  list creates one by client, then engagement, then title, time, length,
  status and billable; Add meeting inside an engagement skips the first two.
  A meeting created as confirmed gets its video room and the client is told,
  exactly as when a request is confirmed, unless it is already over.
- **Agenda items.** The Meeting Manager can add agenda items, because a
  meeting the firm creates has no client-chosen topics and notes hang off
  topics. Topics are private to their creator (V8), so an item added here is
  not shown in the client's own topic list.
