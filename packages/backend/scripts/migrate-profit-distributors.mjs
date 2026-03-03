import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ContractFactory, Interface, JsonRpcProvider, NonceManager, Wallet } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const propertyIdFilter = args.find((arg) => !arg.startsWith('--')) || null;
const dryRun = args.includes('--dry-run');

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const operatorKey =
  process.env.PROFIT_OPERATOR_PRIVATE_KEY ||
  process.env.PLATFORM_OPERATOR_PRIVATE_KEY ||
  process.env.PRIVATE_KEY ||
  '';
const ZERO_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ADVISORY_LOCK_KEY = 424204005;

if (!rpcUrl) {
  throw new Error('Missing BASE_SEPOLIA_RPC_URL (or BASE_MAINNET_RPC_URL)');
}

if (!operatorKey || operatorKey === ZERO_PRIVATE_KEY) {
  throw new Error(
    'Missing valid PROFIT_OPERATOR_PRIVATE_KEY (or PLATFORM_OPERATOR_PRIVATE_KEY / PRIVATE_KEY)'
  );
}

const provider = new JsonRpcProvider(rpcUrl);
const baseSigner = new Wallet(operatorKey, provider);
const signer = new NonceManager(baseSigner);
const operatorAddress = baseSigner.address.toLowerCase();

const profitDistributorArtifactPath = resolve(
  __dirname,
  '../../contracts/artifacts/contracts/ProfitDistributor.sol/ProfitDistributor.json'
);
const profitDistributorArtifact = JSON.parse(readFileSync(profitDistributorArtifactPath, 'utf8'));
const profitInterface = new Interface([
  'function owner() view returns (address)',
  'function usdcToken() view returns (address)',
  'function equityToken() view returns (address)',
]);

const acquireLock = async () => {
  const rows = await sequelize.query('SELECT pg_try_advisory_lock(:key) AS "locked"', {
    type: QueryTypes.SELECT,
    replacements: { key: ADVISORY_LOCK_KEY },
  });
  return Array.isArray(rows) && rows[0] && rows[0].locked === true;
};

const releaseLock = async () => {
  await sequelize.query('SELECT pg_advisory_unlock(:key)', {
    type: QueryTypes.SELECT,
    replacements: { key: ADVISORY_LOCK_KEY },
  });
};

const loadCandidates = async () =>
  sequelize.query(
    `
    SELECT
      id AS "propertyRowId",
      property_id AS "propertyId",
      chain_id AS "chainId",
      LOWER(profit_distributor_address) AS "profitDistributorAddress",
      LOWER(equity_token_address) AS "equityTokenAddress"
    FROM properties
    WHERE profit_distributor_address IS NOT NULL
      ${propertyIdFilter ? 'AND property_id = :propertyId' : ''}
    ORDER BY created_at ASC
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        propertyId: propertyIdFilter,
      },
    }
  );

const contractCallAddress = async (to, fn) => {
  const data = profitInterface.encodeFunctionData(fn);
  const result = await provider.call({ to, data });
  const [value] = profitInterface.decodeFunctionResult(fn, result);
  return String(value).toLowerCase();
};

const deployDistributor = async ({ usdcAddress, equityAddress }) => {
  const factory = new ContractFactory(
    profitDistributorArtifact.abi,
    profitDistributorArtifact.bytecode,
    signer
  );
  const contract = await factory.deploy(operatorAddress, usdcAddress, equityAddress);
  const tx = contract.deploymentTransaction();
  const receipt = await tx.wait();
  return {
    address: (await contract.getAddress()).toLowerCase(),
    txHash: tx.hash,
    blockNumber: Number(receipt?.blockNumber || 0),
  };
};

const migrateOne = async (row) => {
  const currentAddress = row.profitDistributorAddress;
  const code = await provider.getCode(currentAddress);
  if (!code || code === '0x') {
    console.warn(`skip property=${row.propertyId}: no contract code at ${currentAddress}`);
    return { status: 'skipped' };
  }

  const [ownerAddress, usdcAddress, equityAddress] = await Promise.all([
    contractCallAddress(currentAddress, 'owner'),
    contractCallAddress(currentAddress, 'usdcToken'),
    contractCallAddress(currentAddress, 'equityToken'),
  ]);

  if (ownerAddress === operatorAddress) {
    console.log(`skip property=${row.propertyId}: already operator-owned (${currentAddress})`);
    return { status: 'already-owned' };
  }

  if (row.equityTokenAddress && row.equityTokenAddress !== equityAddress) {
    console.warn(
      `property=${row.propertyId} db equity ${row.equityTokenAddress} differs from distributor equity ${equityAddress}; using onchain value`
    );
  }

  if (dryRun) {
    console.log(
      `dry-run property=${row.propertyId} chain=${row.chainId} old=${currentAddress} owner=${ownerAddress} usdc=${usdcAddress} equity=${equityAddress}`
    );
    return { status: 'dry-run' };
  }

  const deployment = await deployDistributor({ usdcAddress, equityAddress });
  await sequelize.transaction(async (tx) => {
    await sequelize.query(
      `
      UPDATE properties
      SET profit_distributor_address = :newAddress,
          updated_at = NOW()
      WHERE id = :propertyRowId
      `,
      {
        transaction: tx,
        replacements: {
          propertyRowId: row.propertyRowId,
          newAddress: deployment.address,
        },
      }
    );

    await sequelize.query(
      `
      INSERT INTO profit_distributors (
        id,
        property_id,
        chain_id,
        contract_address,
        usdc_token_address,
        equity_token_address,
        created_tx_hash,
        created_log_index,
        created_block_number,
        created_at
      )
      VALUES (
        :id,
        :propertyRowId,
        :chainId,
        :contractAddress,
        :usdcTokenAddress,
        :equityTokenAddress,
        :createdTxHash,
        :createdLogIndex,
        :createdBlockNumber,
        NOW()
      )
      ON CONFLICT (contract_address) DO NOTHING
      `,
      {
        transaction: tx,
        replacements: {
          id: randomUUID(),
          propertyRowId: row.propertyRowId,
          chainId: Number(row.chainId),
          contractAddress: deployment.address,
          usdcTokenAddress: usdcAddress,
          equityTokenAddress: equityAddress,
          createdTxHash: deployment.txHash,
          createdLogIndex: 0,
          createdBlockNumber: deployment.blockNumber,
        },
      }
    );

    await sequelize.query(
      `
      UPDATE profit_distribution_intents
      SET profit_distributor_address = :newAddress,
          status = CASE WHEN status = 'confirmed' THEN status ELSE 'pending' END,
          tx_hash = CASE WHEN status = 'confirmed' THEN tx_hash ELSE NULL END,
          error_message = CASE WHEN status = 'confirmed' THEN error_message ELSE NULL END,
          submitted_at = CASE WHEN status = 'confirmed' THEN submitted_at ELSE NULL END,
          confirmed_at = CASE WHEN status = 'confirmed' THEN confirmed_at ELSE NULL END,
          updated_at = NOW()
      WHERE property_id = :propertyId
        AND status IN ('pending', 'failed')
      `,
      {
        transaction: tx,
        replacements: {
          propertyId: row.propertyId,
          newAddress: deployment.address,
        },
      }
    );
  });

  console.log(
    `migrated property=${row.propertyId} old=${currentAddress} new=${deployment.address} tx=${deployment.txHash}`
  );
  return { status: 'migrated' };
};

const run = async () => {
  const locked = await acquireLock();
  if (!locked) {
    throw new Error('Could not acquire migration lock. Another migration may be running.');
  }

  const network = await provider.getNetwork();
  const connectedChainId = Number(network.chainId);
  const rows = await loadCandidates();
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('no properties with profit distributor found');
    return;
  }

  console.log(
    `profit distributor migration candidates=${rows.length} chain=${connectedChainId} operator=${operatorAddress} dryRun=${dryRun}`
  );

  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    if (Number(row.chainId) !== connectedChainId) {
      console.log(`skip property=${row.propertyId}: chain mismatch intent=${row.chainId} provider=${connectedChainId}`);
      skipped += 1;
      continue;
    }

    try {
      const result = await migrateOne(row);
      if (result.status === 'migrated') migrated += 1;
      else skipped += 1;
    } catch (error) {
      console.error(
        `failed property=${row.propertyId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log(`migration complete: migrated=${migrated} skipped=${skipped}`);
};

try {
  await run();
} finally {
  try {
    await releaseLock();
  } catch (_error) {
    // Ignore unlock errors in shutdown path.
  }
  await sequelize.close();
}

