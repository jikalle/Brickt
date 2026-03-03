import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const TABLES = new Set([
  'property_intents',
  'profit_distribution_intents',
  'platform_fee_intents',
]);

const usage = () => {
  console.log(`Usage:
  node scripts/manage-intents.mjs list <table> [status] [limit]
  node scripts/manage-intents.mjs inspect <table> <id>
  node scripts/manage-intents.mjs retry <table> <id>
  node scripts/manage-intents.mjs reset <table> <id>
  node scripts/manage-intents.mjs set-crowdfund <intent_id> <crowdfund_address>

Valid <table> values:
  property_intents
  profit_distribution_intents
  platform_fee_intents
`);
};

const assertTable = (table) => {
  if (!TABLES.has(table)) {
    throw new Error(`Unsupported table: ${table}`);
  }
};

const listIntents = async (table, status, limitRaw) => {
  assertTable(table);
  const limit = Number(limitRaw || 20);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error('limit must be an integer between 1 and 500');
  }

  const rows = await sequelize.query(
    `
    SELECT
      id,
      status,
      tx_hash AS "txHash",
      error_message AS "errorMessage",
      attempt_count AS "attemptCount",
      created_at AS "createdAt",
      submitted_at AS "submittedAt",
      confirmed_at AS "confirmedAt",
      updated_at AS "updatedAt"
    FROM ${table}
    ${status ? 'WHERE status = :status' : ''}
    ORDER BY created_at DESC
    LIMIT :limit
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        status,
        limit,
      },
    }
  );

  console.log(JSON.stringify(rows, null, 2));
};

const inspectIntent = async (table, id) => {
  assertTable(table);
  if (!id) {
    throw new Error('id is required');
  }

  const rows = await sequelize.query(
    `
    SELECT *
    FROM ${table}
    WHERE id = :id
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { id },
    }
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`No intent found for id=${id}`);
    return;
  }

  console.log(JSON.stringify(rows[0], null, 2));
};

const retryIntent = async (table, id) => {
  assertTable(table);
  if (!id) {
    throw new Error('id is required');
  }

  const [result] = await sequelize.query(
    `
    UPDATE ${table}
    SET status = 'pending',
        tx_hash = NULL,
        error_message = NULL,
        submitted_at = NULL,
        confirmed_at = NULL,
        updated_at = NOW()
    WHERE id = :id
      AND status = 'failed'
    RETURNING id, status, attempt_count AS "attemptCount", updated_at AS "updatedAt"
    `,
    {
      replacements: { id },
    }
  );

  if (!Array.isArray(result) || result.length === 0) {
    console.log(`No failed intent updated for id=${id}`);
    return;
  }

  console.log(JSON.stringify(result[0], null, 2));
};

const resetIntent = async (table, id) => {
  assertTable(table);
  if (!id) {
    throw new Error('id is required');
  }

  const [result] = await sequelize.query(
    `
    UPDATE ${table}
    SET status = 'pending',
        tx_hash = NULL,
        error_message = NULL,
        submitted_at = NULL,
        confirmed_at = NULL,
        attempt_count = 0,
        updated_at = NOW()
    WHERE id = :id
      AND status <> 'confirmed'
    RETURNING id, status, attempt_count AS "attemptCount", updated_at AS "updatedAt"
    `,
    {
      replacements: { id },
    }
  );

  if (!Array.isArray(result) || result.length === 0) {
    console.log(`No non-confirmed intent updated for id=${id}`);
    return;
  }

  console.log(JSON.stringify(result[0], null, 2));
};

const setCrowdfund = async (id, crowdfundAddressRaw) => {
  const table = 'property_intents';
  assertTable(table);
  if (!id) {
    throw new Error('id is required');
  }
  if (!crowdfundAddressRaw) {
    throw new Error('crowdfund address is required');
  }
  const crowdfundAddress = crowdfundAddressRaw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(crowdfundAddress)) {
    throw new Error('crowdfund address must be a valid 0x-prefixed 20-byte hex address');
  }

  const [result] = await sequelize.query(
    `
    UPDATE property_intents
    SET crowdfund_contract_address = :crowdfundAddress,
        status = CASE WHEN status = 'confirmed' THEN status ELSE 'pending' END,
        tx_hash = NULL,
        error_message = NULL,
        submitted_at = NULL,
        confirmed_at = NULL,
        updated_at = NOW()
    WHERE id = :id
    RETURNING
      id,
      property_id AS "propertyId",
      LOWER(crowdfund_contract_address) AS "crowdfundAddress",
      status,
      attempt_count AS "attemptCount",
      updated_at AS "updatedAt"
    `,
    {
      replacements: { id, crowdfundAddress },
    }
  );

  if (!Array.isArray(result) || result.length === 0) {
    console.log(`No property intent updated for id=${id}`);
    return;
  }

  console.log(JSON.stringify(result[0], null, 2));
};

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const [command, table, arg3, arg4] = args;

try {
  if (!command) {
    usage();
    process.exit(1);
  }

  if (command === 'list') {
    await listIntents(table, arg3, arg4);
  } else if (command === 'inspect') {
    await inspectIntent(table, arg3);
  } else if (command === 'retry') {
    await retryIntent(table, arg3);
  } else if (command === 'reset') {
    await resetIntent(table, arg3);
  } else if (command === 'set-crowdfund') {
    await setCrowdfund(table, arg3);
  } else {
    usage();
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
