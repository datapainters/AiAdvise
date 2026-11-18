.DEFAULT_GOAL := help
SHELL := /bin/bash
ENV_DIR := infra/envs/prod

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ----------------------------------------------------------------- local dev

.PHONY: db-up
db-up: ## Start a local Postgres in Docker
	docker run -d --name advisory-db -p 5432:5432 \
		-e POSTGRES_DB=advisory \
		-e POSTGRES_USER=advisory_app \
		-e POSTGRES_PASSWORD=localdev \
		postgres:17

.PHONY: db-down
db-down: ## Stop and remove the local Postgres
	-docker rm -f advisory-db

.PHONY: api
api: ## Run the API against local Postgres
	cd services/api && mvn spring-boot:run -Dspring-boot.run.profiles=local

.PHONY: web
web: ## Run the Vite dev server
	cd web && npm run dev

# -------------------------------------------------------------------- checks

.PHONY: test
test: ## Run API tests and the web typecheck
	cd services/api && mvn -B verify
	cd web && npm run typecheck

.PHONY: fmt
fmt: ## Format Terraform
	terraform fmt -recursive infra/

.PHONY: validate
validate: ## Validate every Terraform module
	@for dir in infra/modules/*/; do \
		echo "--- $$dir"; \
		terraform -chdir="$$dir" init -backend=false -input=false >/dev/null; \
		terraform -chdir="$$dir" validate || exit 1; \
	done

.PHONY: plan
plan: ## Plan the prod environment (needs AWS credentials)
	cd $(ENV_DIR) && terraform plan

# ----------------------------------------------------------------- eks lab
#
# Prefer the eks-lab GitHub workflow; these are for when you are already in a
# terminal with credentials.

.PHONY: lab-up
lab-up: ## Stand up the demo Kubernetes cluster (~$73/mo while running)
	cd $(ENV_DIR) && terraform apply -var="enable_eks_lab=true"
	cd $(ENV_DIR) && terraform output -raw eks_lab_kubeconfig_command

.PHONY: lab-down
lab-down: ## Tear the demo cluster back down
	cd $(ENV_DIR) && terraform apply -var="enable_eks_lab=false"

# ------------------------------------------------------------------ rollback

.PHONY: rollback
rollback: ## Redeploy a previous image: make rollback SHA=<git-sha>
	@test -n "$(SHA)" || { echo "Usage: make rollback SHA=<git-sha>"; exit 1; }
	@acct=$$(aws sts get-caller-identity --query Account --output text) && \
	region=$$(cd $(ENV_DIR) && terraform output -raw aws_region) && \
	image="$$acct.dkr.ecr.$$region.amazonaws.com/advisory/api:$(SHA)" && \
	echo "Rolling the API back to $$image" && \
	cd $(ENV_DIR) && terraform apply -var="api_image=$$image"
