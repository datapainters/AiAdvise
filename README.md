# Data Painters platform

Marketing site and client portal for Data Painters. React front end, Spring
Boot API, PostgreSQL, all on AWS, deployed by GitHub Actions.

Live, pre-production, at **https://ai.datapainters.com**. The page carries
`noindex` until it is ready to be found.

## A note on naming

The infrastructure is prefixed `advisory-` — the deploy role, state bucket,
ECR repository, RDS instance, ECS cluster and S3 web bucket all carry it,
and the Java package is `com.advisory.api`. That predates the decision to
trade as Data Painters and is deliberately left alone: the Terraform
`project` variable feeds resource names, so changing it would destroy and
recreate the database, the buckets and the registry rather than rename
them. None of it is customer-visible. If you want the prefix to match the
brand, the moment to do it is a deliberate rebuild, not an incremental
apply.

`datapainters.com` also hosts the previous Tableau consultancy's DNS —
an active apex plus `moodle`, `portal`, `learn`, `edu`, `demos`, `travel`
and others, along with Zoho mail. This stack only ever adds records for
`ai.datapainters.com` and reads the zone through a data source, so none of
that is at risk. Note that `portal.datapainters.com` is already taken by
the old estate, so the client portal cannot move there without retiring it
first.

## Architecture

```
                         ┌──────────────┐
    browser ────TLS────▶ │  CloudFront  │ ──▶ S3 (private, OAC)   static site
                         └──────────────┘
                                │
                                │  (separate origin)
                                ▼
                         ┌──────────────┐
                         │  ECS Express │ ──▶ Fargate tasks       Spring API
                         │  (ALB + TLS) │
                         └──────────────┘
                                │
                                ▼
                         ┌──────────────┐
                         │ RDS Postgres │   private subnets only
                         └──────────────┘
```

The API runs on **ECS Express Mode**, not EKS. Express Mode provisions the
service, load balancer, TLS, autoscaling and health checks from a container
image plus three IAM roles, at no charge above the underlying resources, and
consolidates up to 25 services behind one shared ALB.

Kubernetes is still here, as `infra/modules/eks-lab` — an apply-on-demand
cluster for client demos. It is **off by default**, because an EKS control
plane bills about $73/month idle and about $438/month if its Kubernetes
version slips out of standard support. See
[docs/adr/0001-fargate-now-eks-later.md](docs/adr/0001-fargate-now-eks-later.md).

### Rough monthly cost

| Component | Configuration | Est. |
|---|---|---|
| Fargate | 0.5 vCPU / 1 GB, 1–2 tasks | $20–40 |
| ALB | shared, via Express Mode | ~$17 |
| RDS Postgres | db.t4g.small, single-AZ, 20 GB gp3 | ~$28 |
| NAT gateway | one, not one per AZ | ~$33 |
| CloudFront + S3 | low traffic, PriceClass_100 | $1–5 |
| Secrets, logs, ECR | | $3–8 |
| **Total** | | **~$100–130** |
| *EKS lab, when enabled* | *control plane + Auto Mode nodes* | *+$73 and up* |

The NAT gateway is the line item worth revisiting first: if the API never
needs outbound internet, replacing it with VPC endpoints for ECR, Secrets
Manager and CloudWatch removes it.

## Layout

```
infra/
  bootstrap/        one-time: state backend, OIDC, deploy role, ECR
  modules/
    network/        VPC, subnets, NAT, S3 gateway endpoint
    database/       RDS Postgres + Secrets Manager
    api-service/    ECS Express Mode service, three IAM roles
    web-frontend/   S3 + CloudFront + ACM + Route 53
    eks-lab/        optional on-demand EKS (Auto Mode)
  envs/prod/        composition + tfvars
services/api/       Spring Boot, Flyway migrations, distroless image
web/                React + Vite + TypeScript
.github/workflows/  ci.yml, deploy.yml, eks-lab.yml
```

## First-time setup

### 1. Domain

Currently serving at **`ai.datapainters.com`**, a subdomain of an existing
zone, as an interim home while the real name is decided.

Note the two separate variables. `domain_name` is the hostname the site
answers on; `hosted_zone_name` is the zone that contains it. They differ for
a subdomain, and conflating them fails the plan — a zone lookup for
`ai.datapainters.com` finds nothing.

To cut over to a real domain: register it (through Route 53, which creates
the zone for you), then set `domain_name` to the new apex and
`hosted_zone_name` back to `null`. CloudFront keeps the same distribution;
only the certificate and the alias change. Worth leaving the
`ai.datapainters.com` alias in place for a while so any shared links survive.

### 2. Bootstrap — ALREADY DONE

Applied against account `638646121967` in `us-east-2` on 2026-11-18, via the
AWS API rather than Terraform (the stack that creates the state backend
cannot itself start with one). Twelve resources exist:

| Resource | Name |
|---|---|
| State bucket | `advisory-tfstate-638646121967` (versioned, encrypted, private) |
| Lock table | `advisory-tflock` |
| OIDC provider | `token.actions.githubusercontent.com` |
| Deploy role | `advisory-github-deploy` |
| ECR repository | `advisory/api` (immutable tags, scan on push) |

`infra/bootstrap/imports.tf` holds `import` blocks so Terraform adopts these
into state rather than trying to recreate them. Run it once, then delete that
file — instructions are in its header.

The trust policy is scoped to `repo:datapainters/AiAdvise`. That string is
case-sensitive; if the repo is renamed or the casing differs, every deploy
fails with a confusing `AssumeRoleWithWebIdentity` error.

### 3. Set GitHub repository variables

Settings → Secrets and variables → Actions → *Variables*. None are secrets —
the OIDC trust is what grants access, and it is scoped to this repo.

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE` | `arn:aws:iam::638646121967:role/advisory-github-deploy` |
| `TF_STATE_BUCKET` | `advisory-tfstate-638646121967` |
| `TF_STATE_LOCK_TABLE` | `advisory-tflock` |
| `PROJECT_NAME` | `advisory` |

Create a `production` environment too, and add yourself as a required
reviewer if you want a human gate before each deploy.

### 4. Merge to main

CI runs on the PR; `deploy.yml` takes over on merge. There are no AWS access
keys anywhere in this setup — GitHub presents a short-lived OIDC token and
AWS exchanges it for temporary credentials.

## Local development

```bash
# Postgres
docker run -d --name advisory-db -p 5432:5432 \
  -e POSTGRES_DB=advisory -e POSTGRES_USER=advisory_app \
  -e POSTGRES_PASSWORD=localdev postgres:17

# API — Flyway creates the schema on boot
cd services/api && mvn spring-boot:run -Dspring-boot.run.profiles=local

# Front end
cd web && npm install && npm run dev
```

`make help` lists the shortcuts.

## Known gaps

Read this section before showing the portal to anyone.

- **No authentication.** `TopicController` takes an engagement id from the
  caller and trusts it, so any client could read another client's topics.
  This must be fixed before real data goes in. Options are in
  [docs/next-steps.md](docs/next-steps.md).
- **Two resource argument shapes are still unverified** and are marked
  `>>> VERIFY ON FIRST PLAN <<<` in the source:
  `aws_ecs_express_gateway_service` (provider 6.23.0+) and the EKS Auto Mode
  argument block. Every IAM policy ARN in this repo *has* been checked
  against the live account, so if plan objects it will be an argument name,
  not a permission.
- **You are using root credentials.** The connected identity is
  `arn:aws:iam::<account>:root`. Root cannot be scoped, cannot be revoked
  without rotating everything, and bypasses every guardrail you might add
  later. Create an IAM user or an Identity Center principal with
  `AdministratorAccess`, use that for the bootstrap apply, and put MFA on
  root. This is step 0 in [docs/next-steps.md](docs/next-steps.md).
- **Dependency versions in `pom.xml` are unverified.** This repo was
  scaffolded in a sandbox with Maven Central blocked, so the Java side has
  never been compiled. Expect to bump a version or two on first `mvn verify`.
  The React build *was* verified and passes typecheck.
- **Secrets are read once at startup.** Turning on RDS rotation without
  changing `DataSourceConfig` would break the service one rotation period
  after deploy.
- **No staging environment.** `infra/envs/` has one directory. Copy it to
  `staging/` with its own state key when you want somewhere to break things.
