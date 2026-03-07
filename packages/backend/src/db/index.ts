import { Sequelize } from 'sequelize';
import { env } from '../config/env.js';
import { initModels } from '../models/index.js';

const databaseUrl = env.databaseUrl || '';
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
