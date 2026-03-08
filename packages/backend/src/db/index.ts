import { Sequelize } from 'sequelize';
import { env } from '../config/env.js';
import { initModels } from '../models/index.js';

const databaseUrl = env.databaseUrl || '';
if (!databaseUrl) {
  throw new Error(
    'Missing database connection URL. Set DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL / POSTGRES_URL_NON_POOLING).'
  );
}

let parsedDbUrl: URL;
try {
  parsedDbUrl = new URL(databaseUrl);
} catch {
  throw new Error(
    'Invalid database connection URL format. Expected postgres://... or postgresql://...'
  );
}

if (!['postgres:', 'postgresql:'].includes(parsedDbUrl.protocol)) {
  throw new Error(
    `Unsupported database URL protocol "${parsedDbUrl.protocol}". Use postgres:// or postgresql://`
  );
}

const dbUrlLower = databaseUrl.toLowerCase();
const sslModeRequire = dbUrlLower.includes('sslmode=require');
const sslModeVerifyFull = dbUrlLower.includes('sslmode=verify-full');
const rejectUnauthorizedEnv = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
const rejectUnauthorized =
  rejectUnauthorizedEnv === undefined
    ? sslModeVerifyFull
    : rejectUnauthorizedEnv.toLowerCase() !== 'false';

const dialectOptions =
  sslModeRequire || sslModeVerifyFull
    ? {
        ssl: {
          require: true,
          rejectUnauthorized,
        },
      }
    : undefined;

export const sequelize = new Sequelize(databaseUrl, {
  logging: false,
  dialectOptions,
});

export async function initDatabase(): Promise<void> {
  await sequelize.authenticate();
  initModels(sequelize);
}
