import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const usage = () => {
  console.log(`Usage:
  pnpm --filter @homeshare/backend profit:check-flow -- <propertyId> [limit]
`);
};

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const [propertyId, limitRaw] = args;
const limit = Number(limitRaw || 5);

if (!propertyId) {
  usage();
  process.exit(1);
}

if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
  throw new Error('limit must be an integer between 1 and 100');
}

try {
  await sequelize.authenticate();

  const [indexerState, profitIntents, deposits, claims] = await Promise.all([
    sequelize.query(
      `
      SELECT chain_id::text AS "chainId", last_block::text AS "lastBlock"
      FROM indexer_state
      ORDER BY chain_id ASC
      `,
      { type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT
        id,
        property_id AS "propertyId",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        status,
        tx_hash AS "txHash",
        error_message AS "errorMessage",
        attempt_count AS "attemptCount",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        updated_at AS "updatedAt"
      FROM profit_distribution_intents
      WHERE property_id = :propertyId
      ORDER BY created_at DESC
      LIMIT :limit
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { propertyId, limit },
      }
    ),
    sequelize.query(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(pdistr.contract_address) AS "profitDistributorAddress",
        LOWER(pd.depositor_address) AS "depositorAddress",
        pd.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        pd.tx_hash AS "txHash",
        pd.block_number::text AS "blockNumber",
        pd.log_index AS "logIndex",
        pd.created_at AS "createdAt"
      FROM profit_deposits pd
      JOIN properties p ON p.id = pd.property_id
      JOIN profit_distributors pdistr ON pdistr.id = pd.profit_distributor_id
      WHERE p.property_id = :propertyId
      ORDER BY pd.block_number DESC, pd.log_index DESC
      LIMIT :limit
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { propertyId, limit },
      }
    ),
    sequelize.query(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(pdistr.contract_address) AS "profitDistributorAddress",
        LOWER(pc.claimer_address) AS "claimerAddress",
        pc.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        pc.tx_hash AS "txHash",
        pc.block_number::text AS "blockNumber",
        pc.log_index AS "logIndex",
        pc.created_at AS "createdAt"
      FROM profit_claims pc
      JOIN properties p ON p.id = pc.property_id
      JOIN profit_distributors pdistr ON pdistr.id = pc.profit_distributor_id
      WHERE p.property_id = :propertyId
      ORDER BY pc.block_number DESC, pc.log_index DESC
      LIMIT :limit
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { propertyId, limit },
      }
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        propertyId,
        indexerState,
        profitIntents,
        deposits,
        claims,
      },
      null,
      2
    )
  );
} finally {
  await sequelize.close();
}
