/**
 * env.validation.ts
 *
 * Environment variable validation for ConfigModule.
 *
 * Usage in AppModule:
 *
 *   ConfigModule.forRoot({ validate: validateEnv })
 *
 * Design notes:
 *   - Uses a plain validate function — no Joi or class-validator runtime
 *     dependency needed. The check runs once at bootstrap.
 *   - Required vars cause a hard crash (fail-fast). Missing required config
 *     in a running service is a security risk: the service may silently fall
 *     back to insecure defaults.
 *   - Optional vars (API_CENTER_BASE_URL) emit a warning so the developer
 *     knows the feature will be unavailable, but local dev is not broken.
 *
 * Threat addressed:
 *   - Service starting with missing secrets and silently degrading to
 *     insecure fallback behaviour (e.g. empty SUPABASE_SERVICE_ROLE_KEY
 *     allowing unauthenticated DB operations, or no ALLOWED_ORIGINS
 *     causing permissive CORS).
 */

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  ENABLE_SWAGGER: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGINS: string;
  API_CENTER_BASE_URL?: string;
  API_CENTER_API_KEY?: string;
}

type RawEnv = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireString(env: RawEnv, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `[env] Missing required environment variable: ${key}. ` +
        `Set it in .env or your deployment secrets before starting the service.`,
    );
  }
  return value.trim();
}

function requireEnum<T extends string>(
  env: RawEnv,
  key: string,
  allowed: readonly T[],
): T {
  const raw = requireString(env, key);
  if (!allowed.includes(raw as T)) {
    throw new Error(
      `[env] Invalid value for ${key}: '${raw}'. ` +
        `Allowed values: ${allowed.join(', ')}.`,
    );
  }
  return raw as T;
}

function requirePort(env: RawEnv, key: string): number {
  const raw = env[key];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `[env] ${key} must be an integer between 1 and 65535. Got: '${String(raw)}'.`,
    );
  }
  return parsed;
}

function warnIfMissing(env: RawEnv, key: string, reason: string): void {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    console.warn(
      `[env] WARNING: Optional variable ${key} is not set. ${reason}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Exported validate function
// ---------------------------------------------------------------------------

/**
 * validateEnv — passed directly to ConfigModule.forRoot({ validate }).
 *
 * Called by NestJS at bootstrap with the raw process.env object.
 * Must return the parsed/typed config or throw to abort startup.
 */
export function validateEnv(env: RawEnv): EnvironmentVariables {
  // --- Required: service identity ---
  const NODE_ENV = requireEnum(env, 'NODE_ENV', [
    'development',
    'test',
    'production',
  ] as const);

  const PORT = requirePort(env, 'PORT');

  // --- Required: Supabase credentials ---
  // All three must be present. An empty SERVICE_ROLE_KEY would allow the
  // service to start but silently bypass row-level security on every query.
  const SUPABASE_URL = requireString(env, 'SUPABASE_URL');
  const SUPABASE_ANON_KEY = requireString(env, 'SUPABASE_ANON_KEY');
  const SUPABASE_SERVICE_ROLE_KEY = requireString(
    env,
    'SUPABASE_SERVICE_ROLE_KEY',
  );

  // --- Required: CORS ---
  // ALLOWED_ORIGINS must be set; corsOptions() will deny all browser-origin
  // requests if empty, which may cause confusing CORS errors in staging.
  // We require it here so misconfiguration is explicit at startup.
  const ALLOWED_ORIGINS = requireString(env, 'ALLOWED_ORIGINS');

  // --- Optional with warnings ---
  const ENABLE_SWAGGER =
    (env['ENABLE_SWAGGER'] as string | undefined) ?? 'false';

  warnIfMissing(
    env,
    'API_CENTER_BASE_URL',
    'Calls to APICenter will fail at runtime. Set this if the service needs to proxy API requests.',
  );

  warnIfMissing(
    env,
    'API_CENTER_API_KEY',
    'APICenter requests will be unauthenticated. Set this together with API_CENTER_BASE_URL.',
  );

  const API_CENTER_BASE_URL = env['API_CENTER_BASE_URL'] as string | undefined;
  const API_CENTER_API_KEY = env['API_CENTER_API_KEY'] as string | undefined;

  return {
    NODE_ENV,
    PORT,
    ENABLE_SWAGGER,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    ALLOWED_ORIGINS,
    ...(API_CENTER_BASE_URL ? { API_CENTER_BASE_URL } : {}),
    ...(API_CENTER_API_KEY ? { API_CENTER_API_KEY } : {}),
  };
}
