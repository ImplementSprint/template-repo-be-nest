# Tribe Backend Template — NestJS

Reusable NestJS 11 backend template for ImplementSprint tribes. Each tribe clones this repository as their backend service. It comes pre-wired with Supabase, the API Center SDK, security middleware, CI/CD, and Docker — ready to extend with tribe-specific feature modules.

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
| `API_CENTER_API_KEY` | Optional | Bearer token for API Center authentication |

`SUPABASE_SERVICE_ROLE_KEY` and `API_CENTER_API_KEY` are **HIGH sensitivity** — store them in GitHub Secrets or Vault, never in plaintext files committed to version control.

### Strict Env Validation (opt-in)

`src/common/config/env.validation.ts` provides a `validateEnv` function that can be passed to `ConfigModule.forRoot({ validate: validateEnv })` to enforce all required variables at startup. It is commented out by default in `app.module.ts` to avoid breaking local development without a complete `.env`. Enable it in production deployments.

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
      env.validation.ts             Strict env var validation (opt-in)
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
  database/
    migrations/                     Placeholder for Supabase SQL migration files
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

```typescript
constructor(private readonly sdkService: ApiCenterSdkService) {}

// Consume another tribe's registered API
const { data, correlationId } = await this.sdkService.get<User[]>('/tribes/tribe-b/users');

// Consume a shared external service registered in the API Center
const { data } = await this.sdkService.get('/shared/payments/invoice/123');
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

Schema management is handled in the Supabase dashboard or via the Supabase CLI. The `src/database/migrations/` directory is the intended location for SQL migration files. The `migrate:check` CI step passes cleanly without requiring a live database connection.

---

## CI/CD Pipeline

### Branch Flow

```
test → uat → main
```

Push or open a PR to any of these branches to trigger the pipeline. Successful `test` builds automatically create a PR to `uat`. Successful `uat` builds create a PR to `main`.

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

### Pipeline Stages

1. **Quality gates** — lint, typecheck, build, unit tests (80% coverage threshold)
2. **Security scan** — `npm audit` + license compliance check
3. **SonarCloud** — static analysis (requires secrets above)
4. **DB migration check** — validates `migrate:check` script
5. **Docker build** — multi-stage build + Trivy vulnerability scan
6. **Deploy** — staging deploy on `test` and `uat` branches
7. **Versioning** — semantic version tag per branch
8. **Promotion** — auto-creates PR to next branch on success
9. **k6 smoke test** — runs on `test` and `uat` branches against the deployed URL

---

## Replit (Pre-Production Preview)

Replit is used for quick preview deployments on the `test` branch only. UAT and production use Kubernetes.

### Files added

| File | Purpose |
|------|---------|
| `.replit` | Workspace config: Node 22 module, build + start command, port mapping |
| `replit.nix` | Nix environment: provisions Node.js 22 LTS |

### Setup

1. Import the repository into Replit (Import from GitHub)
2. Open **Tools > Secrets** and add all required env vars (do NOT create a `.env` file — see `.env.example` for the full list)
3. Set `ALLOWED_ORIGINS` to your Replit preview URL: `https://<repl-name>.<username>.repl.co`
4. Set `NODE_ENV=production` and `ENABLE_SWAGGER=false`
5. Click **Run** — Replit will execute `npm run build && npm run start:prod`

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
7. **Set your `.env`** — Supabase credentials, API Center URL and key, CORS origins
