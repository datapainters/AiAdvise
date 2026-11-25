# ADR 0001 — Run the platform on Fargate; keep Kubernetes as a lab

**Status:** accepted · **Date:** 2026-11-17

## Context

The original plan was React + Spring Boot + PostgreSQL on Kubernetes. The
workload is a marketing site plus a client portal handling scheduling and
topic management for a small number of advisory clients. Peak load is
plausibly a few requests per second.

Kubernetes was not an arbitrary choice. The practice sells AI-integration
consulting, largely to enterprises whose own platforms run on Kubernetes, and
there is real value in the firm's own infrastructure being a reference
implementation rather than a toy.

The cost of using EKS for the always-on site:

- The control plane bills $0.10 per cluster-hour — roughly $73/month — before
  a single pod is scheduled.
- That rate becomes $0.60/hour, roughly $438/month, automatically once the
  cluster's Kubernetes version leaves standard support 14 months after
  release. For a one-person firm, that is a recurring upgrade obligation with
  a steep penalty for forgetting.
- Realistic all-in cost for a small EKS cluster with worker nodes, an ALB and
  standard networking lands in the $400–600/month range.

Against roughly $100–130/month for the same application on Fargate.

AWS also shipped ECS Express Mode in November 2025 as the supported answer to
this exact shape of problem — container image in, HTTPS service out — and
closed App Runner to new customers in April 2026, naming Express Mode as the
migration path. So the managed-container story on AWS has a clear centre of
gravity, and it is not EKS.

## Decision

Two separate concerns, two separate lifecycles.

1. **The business's front door runs on ECS Express Mode.** Always on, cheap,
   boring, no cluster upgrades. This is what clients and prospects hit.

2. **Kubernetes lives in `infra/modules/eks-lab`, disabled by default.** It is
   gated behind `enable_eks_lab` and driven by a manual workflow with `up` and
   `down` inputs. It uses EKS Auto Mode so a cold cluster costs the control
   plane fee and nothing more. The same container images run in both places.

## Consequences

**Good.** The site costs about a quarter of the EKS equivalent. There is no
Kubernetes version treadmill attached to production uptime. Express Mode's
shared-ALB behaviour means a second service later adds no load balancer cost.
The demo capability is preserved, and demoing a cluster that gets created and
destroyed on demand is arguably a better story than one that idles.

**Bad.** Two deployment targets to keep working, and the Helm path will rot if
it is never exercised — it needs running at least occasionally, not just
before a demo. Express Mode is opinionated: sidecars, custom listener rules
and non-HTTP workloads will eventually push something onto plain ECS or into
the lab cluster. `aws_ecs_express_gateway_service` is also a young resource,
so provider upgrades warrant more attention than usual here.

**Revisit when** the portal has steady traffic that makes reserved EKS
capacity cheaper than Fargate on-demand, when more than a handful of services
need to talk to each other, or when a client engagement requires the firm to
run production workloads on Kubernetes directly.

---

## Update 2026-11-19 — the lab cluster is removed

The apply-on-demand EKS module and its `eks-lab` workflow are deleted. The
decision above still stands; what changed is the judgement that keeping a
dormant second deployment target in this repository was paying maintenance
for an option nobody had exercised.

"Bad" above predicted the Helm path would rot if it were never exercised. It
was never exercised, and no chart was ever written, so what existed was a
cluster definition with nothing to deploy onto it — the rot arrived before the
feature did.

A demo cluster will be stood up separately if a client engagement needs one.
That is a better fit than a flag in the production stack, because a demo
wants to be disposable and to run whatever version the conversation calls for,
not whatever this repository happens to pin.

Two things were deliberately kept so that remains easy:

- The `kubernetes.io/role/elb` and `kubernetes.io/role/internal-elb` subnet
  tags, which a load-balancer controller needs in order to pick subnets.
- `enable_nat` in the network module, which restores private-subnet egress in
  one line. Nodes in private subnets need it.

To recover the module: `git log --diff-filter=D -- infra/modules/eks-lab`.

**Consequence for the network.** The lab was the last thing that would have
placed workloads in the private subnets, so with it gone the NAT gateway was
routing nothing. It is now off, saving roughly $33/month plus data
processing. See next-steps section 4.
