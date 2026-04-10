# Tribe Backend Template — NestJS

Reusable NestJS 11 backend template for ImplementSprint tribes. Each tribe clones this repository as their backend service. It comes pre-wired with Supabase, the API Center SDK, security middleware, CI/CD, and Docker — ready to extend with tribe-specific feature modules.

Start with `START_HERE_BACKEND.md` for a full onboarding and system-level explanation.

---

## What This Template Provides

- **Production-ready bootstrap** — Helmet, CORS, body size limits, graceful shutdown, global validation, structured error responses, and Swagger (toggled by env var).
- **Supabase integration** — pre-wired `SupabaseService` with connection health check.
- **API Center SDK** — pre-wired `ApiCenterSdkService` for calling the shared API gateway and registering this tribe's own APIs.
- **Correlation ID propagation** — every request gets an `X-Correlation-ID` header, linking tribe backend logs to API Center traces.
- **TypeScript strict mode** — `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module: nodenext`.
- **CI/CD pipeline** — caller workflow delegates to the central `master-pipeline-be.yml` orchestrator (test → uat → main promotion with quality gates, SonarCloud, k6, Docker build).
- **Non-root Docker container** — multi-stage Node 22 alpine build with a least-privilege `nestjs` user.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 |
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5 (strict mode) |
| Database | Supabase (PostgreSQL via `@supabase/supabase-js`) |
| API Gateway | ImplementSprint API Center (via internal SDK) |
| Testing | Jest + Supertest |
| Linting | ESLint + TypeScript ESLint + Prettier |
| CI/CD | GitHub Actions → central-workflow |
| Container | Docker multi-stage (node:22-alpine) |
| Code Quality | SonarCloud |
| Performance | Grafana k6 |

---

## Quick Start

```bash
cp .env.example .env
# Fill in your Supabase and API Center credentials in .env

npm install
npm run start:dev
```

Run quality checks:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:cov
npm run test:e2e
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in real values. Never commit `.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `development` / `test` / `production` |
| `PORT` | Yes | HTTP port (default `3000`) |
| `ENABLE_SWAGGER` | No | Set `true` in dev to enable Swagger UI at `/api/v1/docs` |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key (server-side use with RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key — bypasses RLS, store in Vault/Secrets |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS origins (e.g. `http://localhost:5173`) |
| `API_CENTER_BASE_URL` | Optional | API Center gateway URL — SDK warns and disables if absent |
| `API_CENTER_TRIBE_ID` | Optional | Preferred APICenter auth mode: registered tribe/service id |
| `API_CENTER_TRIBE_SECRET` | Optional | Preferred APICenter auth mode: secret paired with `API_CENTER_TRIBE_ID` |
| `API_CENTER_API_KEY` | Optional | Legacy static bearer token mode (fallback) |
| `API_CENTER_TIMEOUT_MS` | Optional | APICenter HTTP timeout in ms (default `10000`) |

`SUPABASE_SERVICE_ROLE_KEY`, `API_CENTER_TRIBE_SECRET`, and `API_CENTER_API_KEY` are **HIGH sensitivity** — store them in GitHub Secrets or Vault, never in plaintext files committed to version control.

### Strict Env Validation

`src/common/config/env.validation.ts` is enforced automatically when `NODE_ENV=production`, which makes Replit/main deploys fail fast on missing required configuration. Non-production runs keep local developer flexibility.

---

## Project Structure

```text
src/
  main.ts                           Bootstrap: Helmet, CORS, body limits, shutdown hooks, Swagger
  app.module.ts                     Root module: ConfigModule, SupabaseModule, ApiCenterSdkModule
  app.controller.ts                 GET /api/v1 → { service, version }
  app.service.ts
  common/
    config/
      security.config.ts            CISO-owned: Helmet options, CORS factory, body size limit
      env.validation.ts             Strict env var validation (enabled in production)
    filters/
      all-exceptions.filter.ts      Global exception filter — structured error envelope
    middleware/
      correlation-id.middleware.ts  X-Correlation-ID request/response propagation
  api-center/
    api-center-sdk.module.ts        Global module
    api-center-sdk.service.ts       SDK client: get<T>(), post<T>(), ping()
  supabase/
    supabase.module.ts              Global module
    supabase.service.ts             Supabase client: getClient(), ping()
  health/
    health.module.ts
    health.controller.ts            GET /api/v1/health → 200 ok/degraded | 503 error
    health.service.ts               Parallel checks: Supabase + API Center connectivity
tests/
  e2e/                              Supertest e2e specs
  performance/
    smoke.js                        k6 smoke test targeting /api/v1/health
```

---

## Health Endpoint

```
GET /api/v1/health
```

Response when healthy:
```json
{
  "status": "ok",
  "uptimeSeconds": 42,
  "checks": {
    "database": true,
    "apiCenter": true
  }
}
```

| `status` | HTTP | Meaning |
|----------|------|---------|
| `ok` | 200 | Both Supabase and API Center are reachable |
| `degraded` | 200 | One dependency is unreachable — service is still running |
| `error` | 503 | Both dependencies are unreachable |

The Docker container healthcheck targets this endpoint.

---

## API Center SDK

The `ApiCenterSdkService` is the authorized channel for calling the shared API gateway. Any feature module can inject it:

- Preferred auth mode: `API_CENTER_TRIBE_ID` + `API_CENTER_TRIBE_SECRET` (short-lived token lifecycle)
- Legacy fallback mode: `API_CENTER_API_KEY` (static bearer token)
- Paths for APICenter namespaces (`/tribes`, `/shared`, `/external`, `/auth`, `/registry`, `/health`) are normalized to `/api/v1/...` automatically
- Typed Kafka helpers are available: `kafkaListClusters()`, `kafkaListTopics(clusterId)`, `kafkaProduceRecords(clusterId, topic, records)`, and `buildTenantTopic(tribeId, suffix)`

```typescript
constructor(private readonly sdkService: ApiCenterSdkService) {}

// Consume another tribe's registered API
const { data, correlationId } = await this.sdkService.get<User[]>('/tribes/tribe-b/users');

// Consume a shared external service registered in the API Center
const { data } = await this.sdkService.get('/shared/payments/invoice/123');

// Kafka through APICenter external routing
const topic = ApiCenterSdkService.buildTenantTopic('orders-service', 'order-created');
await this.sdkService.kafkaProduceRecords('lkc-123', topic, [
  {
    key: 'order-001',
    value: JSON.stringify({ orderId: 'order-001', status: 'created' }),
  },
]);
```

If `API_CENTER_BASE_URL` is not set, the service logs a warning at startup and all calls throw — it does not crash the application.

**Note:** Service registration (announcing this tribe backend's own APIs to the API Center registry) is not yet automated. See the API Center documentation for the registry registration endpoint.

---

## Supabase

The `SupabaseService` provides a pre-configured Supabase client using the service role key (bypasses RLS for server-side mutations). Inject it in any feature service:

```typescript
constructor(private readonly supabaseService: SupabaseService) {}

const client = this.supabaseService.getClient();
const { data, error } = await client.from('orders').select('*');
```

Schema management is handled in the Supabase dashboard or via the Supabase CLI.

---

## CI/CD Pipeline

### Branch Flow

```
test → uat → main
```

Push to any of these branches to trigger the pipeline. Successful `test` builds automatically create a PR to `uat`. Successful `uat` builds create a PR to `main`, but only when all required quality gates pass.

### Required GitHub Repository Setup

Before the first pipeline run, configure these in your GitHub repository:

**Repository Variables:**

| Variable | Example Value | Purpose |
|----------|--------------|---------|
| `BACKEND_SINGLE_SYSTEMS_JSON` | `{"name":"my-api","dir":".","image":"ghcr.io/org/my-api"}` | Tells the pipeline which service to build |

**Repository Secrets:**

| Secret | Purpose |
|--------|---------|
| `SONAR_TOKEN` | SonarCloud authentication |
| `SONAR_ORGANIZATION` | SonarCloud organization slug |
| `SONAR_PROJECT_KEY` | Unique SonarCloud project key for this tribe |
| `GH_PR_TOKEN` | Token with PR write permissions for auto-promotion |
| `K6_CLOUD_TOKEN` | Grafana Cloud token for k6 execution |
| `K6_CLOUD_PROJECT_ID` | Grafana Cloud project ID for k6 execution |
| `REPLIT_HEALTHCHECK_URL_TEST` | Recommended. Test Replit URL (base URL or full health endpoint) |
| `REPLIT_HEALTHCHECK_URL_PROD` | Recommended. Production Replit URL (base URL or full health endpoint) |
| `REPLIT_HEALTHCHECK_URL` | Optional fallback health URL used when env-specific secrets are missing |
| `REPLIT_DEPLOY_URL` | Optional. Enables webhook-trigger mode for Replit lane; otherwise lane runs verify-only mode |
| `REPLIT_API_KEY` | Optional (currently unused by the reusable deploy workflow) |

### Pipeline Stages

1. **Quality gates** — lint, typecheck, build, unit tests (80% coverage threshold)
2. **Security scan** — `npm audit` + license compliance check
3. **SonarCloud** — static analysis (requires secrets above)
4. **Docker build** — multi-stage build + Trivy vulnerability scan (main branch only)
5. **Deploy** — staging deploy on `uat` branch
6. **Replit deploy (test/main)** — lane always runs on push when deploy lanes are enabled; mode is auto-selected:
  - `webhook` when `REPLIT_DEPLOY_URL` is configured
  - `verify-only` when webhook is absent (health polling via `REPLIT_HEALTHCHECK_URL_*`)
7. **Versioning** — semantic version tag per branch
8. **k6 smoke test** — runs on configured branches and target URL settings
9. **Promotion** — auto-creates PR to next branch only when all required gates pass (tests, security, SonarCloud, Grafana k6)

---

## Replit (Test Preview + Main Deployment)

Replit is used for preview deployments on the `test` branch and production deployment on the `main` branch. UAT uses Kubernetes.

Default behavior in this repository is a dual-mode Replit lane in CI:
- If `REPLIT_DEPLOY_URL` is configured, CI triggers webhook deploy and then verifies health.
- If `REPLIT_DEPLOY_URL` is not configured, CI runs verify-only mode using `REPLIT_HEALTHCHECK_URL_TEST`/`REPLIT_HEALTHCHECK_URL_PROD`.

### Files added

| File | Purpose |
|------|---------|
| `.replit` | Workspace config: Node 22 module, build + start command, port mapping |
| `replit.nix` | Nix environment: provisions Node.js 22 LTS |

### Setup

1. Import the repository into Replit (Import from GitHub)
2. Open **Tools > Secrets** and add all required env vars (do NOT create a `.env` file — see `.env.example` for the full list)
3. Set `ALLOWED_ORIGINS` to your Replit preview URL: `https://<repl-name>.<username>.repl.co`
4. Set APICenter auth mode:
  - Preferred: `API_CENTER_TRIBE_ID` + `API_CENTER_TRIBE_SECRET`
  - Legacy fallback: `API_CENTER_API_KEY`
5. Set `NODE_ENV=production` and `ENABLE_SWAGGER=false`
6. Set GitHub healthcheck secrets so verify-only mode can validate Replit:
  - `REPLIT_HEALTHCHECK_URL_TEST`
  - `REPLIT_HEALTHCHECK_URL_PROD`
  - Optional fallback: `REPLIT_HEALTHCHECK_URL`
7. Optional: set GitHub secret `REPLIT_DEPLOY_URL` if you want webhook-trigger mode from CI
8. Click **Run** — Replit will execute `npm run build && npm run start:prod`

The app binds to `0.0.0.0:3000` so Replit's reverse proxy can reach it. The health endpoint at `/api/v1/health` is available for Replit's health monitor.

> **CORS note:** The CORS factory uses exact-match whitelisting — wildcards are not accepted. Set `ALLOWED_ORIGINS` to the exact Replit preview URL for your repl.

---

## Docker

Build and run locally:

```bash
docker build -t tribe-backend .
docker run --rm -p 3000:3000 --env-file .env tribe-backend
```

The container:
- Uses `node:22-alpine` for both build and runtime stages
- Runs as a non-root `nestjs` user (UID 1001)
- Health-checks `http://127.0.0.1:3000/api/v1/health` every 30 seconds
- Excludes `tests/`, `test/`, `.git`, `.env` from the build context

---

## Strict TypeScript Policy

| Flag | Value |
|------|-------|
| `strict` | `true` |
| `allowJs` | `false` |
| `noImplicitAny` | `true` |
| `noUncheckedIndexedAccess` | `true` |
| `exactOptionalPropertyTypes` | `true` |
| `module` | `nodenext` |
| `moduleResolution` | `nodenext` |

All new feature modules must pass `npm run typecheck` with zero errors. Use type-only imports (`import type`) where no runtime value is needed.

---

## Integrating Into an Existing Tribe Backend

If your tribe already has the NestJS backend, bring these layers across:

1. **Copy the common layer** — `src/common/` (filters, middleware, security config, env validation)
2. **Copy the modules** — `src/supabase/`, `src/api-center/`, `src/health/`
3. **Update `main.ts`** — apply the bootstrap pattern (Helmet, CORS, ValidationPipe, AllExceptionsFilter, global prefix `api/v1`)
4. **Update `app.module.ts`** — import `ConfigModule`, `SupabaseModule`, `ApiCenterSdkModule`, apply `CorrelationIdMiddleware`
5. **Replace the CI caller** — use `.github/workflows/be-pipeline-caller.yml` from this template
6. **Configure GitHub** — set the repository variables and secrets listed above
7. **Set your `.env`** — Supabase credentials, API Center URL, tribe credentials (or legacy key fallback), and CORS origins
