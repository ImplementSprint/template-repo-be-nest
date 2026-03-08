# Template Repo Backend — NestJS

Backend template with CI/CD pipeline that calls reusable workflows from **Central-Template-main**.

## Stack

- **Framework:** NestJS (TypeScript)
- **Runtime:** Node.js 20
- **Testing:** Jest (unit + e2e)
- **Linting:** ESLint + Prettier
- **Deployment:** Replit
- **Docker:** Multi-stage build → GHCR
- **CI/CD:** GitHub Actions (reusable workflows)

## Project Structure

```
Template-repo-be-single/
├── src/
│   ├── main.ts                    # Application entry point
│   ├── app.module.ts              # Root module
│   ├── app.controller.ts          # Root controller
│   ├── app.service.ts             # Root service
│   └── health/
│       ├── health.module.ts       # Health check module
│       ├── health.controller.ts   # GET /api/health
│       └── health.service.ts      # Health check logic
├── tests/
│   ├── app.controller.spec.ts     # Controller unit tests
│   ├── app.service.spec.ts        # Service unit tests
│   ├── health.controller.spec.ts  # Health controller tests
│   ├── health.service.spec.ts     # Health service tests
│   ├── app.e2e-spec.ts            # End-to-end tests
│   └── jest-e2e.json              # E2E Jest config
├── .github/
│   └── workflows/
│       └── master-pipeline-be-single.yml  # CI/CD orchestrator
├── Dockerfile                     # Multi-stage Docker build
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── eslint.config.mjs
├── .prettierrc
├── .gitignore
├── .dockerignore
├── .env.example
└── sonar-project.properties
```

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run start:dev

# Run tests
npm run test:cov

# Build for production
npm run build

# Start production server
npm run start:prod
```

## CI/CD Pipeline

The workflow (`master-pipeline-be-single.yml`) calls reusable workflows from **Central-Template-main**:

| Stage | Workflow Called | Description |
|-------|---------------|-------------|
| Backend Pipeline | `backend-workflow.yml` | Tests + Lint + Security scan |
| Versioning | `versioning.yml` | Auto version tags (test/main) |
| Deploy | Replit (inline) | Deploy to test/uat/prod via Replit |
| Production Gate | `production-gate.yml` | Approval + checklist for prod |
| Docker | `docker-build.yml` | Build & push to GHCR (main only) |
| Promotion | `promotion.yml` | Auto-create PRs test→uat, uat→main |
| Summary | `pipeline-summary.yml` | Pipeline results summary |
| Notifications | `notifications.yml` | Slack/Discord alerts |

### Branch Strategy

```
test → uat → main
```

- **test**: Runs tests, deploys to Replit test, creates PR → uat
- **uat**: Runs tests, deploys to Replit uat, creates PR → main
- **main**: Production gate → Replit prod → Docker GHCR → version tag

## Required Secrets & Variables

### Repository Variable

Set `BE_SINGLE_SYSTEM_JSON` as a repository variable:

```json
{
  "name": "MyBackend-API",
  "dir": ".",
  "image": "mybackend-api",
  "replit_deploy_secret": "REPLIT_DEPLOY_URL"
}
```

### Repository Secrets

| Secret | Description |
|--------|-------------|
| `REPLIT_DEPLOY_URL` | Replit deployment webhook URL |
| `REPLIT_API_KEY` | Replit API key (if needed) |
| `GH_PR_TOKEN` | GitHub PAT for PR creation |
| `SONAR_TOKEN` | SonarCloud token |
| `SLACK_WEBHOOK_URL` | Slack notifications (optional) |
| `DISCORD_WEBHOOK_URL` | Discord notifications (optional) |

## Workflow Link

Replace `OWNER/Central-Template-main` in the workflow file with your actual GitHub org/repo path where Central-Template-main is hosted.
