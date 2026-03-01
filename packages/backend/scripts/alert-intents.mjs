import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const failedThreshold = Number(process.env.INTENT_FAILED_ALERT_THRESHOLD || 5);
const submittedAgeMinutes = Number(process.env.INTENT_SUBMITTED_STALE_MINUTES || 30);
const submittedThreshold = Number(process.env.INTENT_SUBMITTED_STALE_THRESHOLD || 5);

if (!Number.isFinite(failedThreshold) || failedThreshold < 0) {
  throw new Error('INTENT_FAILED_ALERT_THRESHOLD must be >= 0');
}
if (!Number.isFinite(submittedAgeMinutes) || submittedAgeMinutes <= 0) {
  throw new Error('INTENT_SUBMITTED_STALE_MINUTES must be > 0');
}
if (!Number.isFinite(submittedThreshold) || submittedThreshold < 0) {
  throw new Error('INTENT_SUBMITTED_STALE_THRESHOLD must be >= 0');
}

const TABLES = [
  'property_intents',
  'profit_distribution_intents',
  'platform_fee_intents',
];

const countFailed = async (table) =>
  sequelize.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE status = 'failed'`,
    { type: QueryTypes.SELECT }
  );

const countSubmittedStale = async (table) =>
  sequelize.query(
    `
    SELECT COUNT(*)::int AS count
    FROM ${table}
    WHERE status = 'submitted'
      AND submitted_at IS NOT NULL
      AND submitted_at < NOW() - make_interval(mins => :minutes)
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { minutes: submittedAgeMinutes },
    }
  );

const toCount = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }
  return Number(rows[0].count ?? 0);
};

let hasAlert = false;

try {
  for (const table of TABLES) {
    const failedRows = await countFailed(table);
    const staleRows = await countSubmittedStale(table);
    const failed = toCount(failedRows);
    const staleSubmitted = toCount(staleRows);

    console.log(
      JSON.stringify(
        {
          table,
          failed,
          staleSubmitted,
          failedThreshold,
          staleMinutes: submittedAgeMinutes,
          staleThreshold: submittedThreshold,
        },
        null,
        2
      )
    );

    if (failed > failedThreshold || staleSubmitted > submittedThreshold) {
      hasAlert = true;
    }
  }
} finally {
  await sequelize.close();
}

if (hasAlert) {
  console.error('Intent alert threshold exceeded');
  process.exit(1);
}

console.log('Intent alert check passed');
