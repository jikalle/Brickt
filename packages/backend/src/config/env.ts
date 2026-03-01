import dotenv from 'dotenv';

dotenv.config();

const PLACEHOLDER_VALUES = new Set([
  'your-secret-key-here',
  'postgresql://user:password@localhost:5432/homeshare',
]);

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'] as const;

function warnMissing(key: string): void {
  console.warn(`⚠️  Missing required environment variable: ${key}`);
}

function warnPlaceholder(key: string, value: string): void {
  console.warn(`⚠️  ${key} is still set to a placeholder value.`);
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function validateEnv(): void {
  REQUIRED_ENV.forEach((key) => {
    const value = process.env[key];
    if (!value) {
      warnMissing(key);
      return;
    }

    if (PLACEHOLDER_VALUES.has(value)) {
      warnPlaceholder(key, value);
    }
  });
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  rateLimitWindowMs: parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMaxRequests: parseIntEnv(process.env.RATE_LIMIT_MAX_REQUESTS, 120),
  authRateLimitWindowMs: parseIntEnv(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
  authRateLimitMaxRequests: parseIntEnv(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 20),
  ownerAllowlist: (process.env.OWNER_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
};

export type EnvConfig = typeof env;
