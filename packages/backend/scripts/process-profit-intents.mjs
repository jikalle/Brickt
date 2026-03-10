import { Contract, Interface, JsonRpcProvider, MaxUint256, NonceManager, Wallet } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');
const { upsertOnchainActivity } = await import('../dist/lib/onchainActivity.js');

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const operatorKey =
  process.env.PROFIT_OPERATOR_PRIVATE_KEY ||
  process.env.PLATFORM_OPERATOR_PRIVATE_KEY ||
  process.env.PRIVATE_KEY ||
  '';
const batchSize = Number(process.env.PROFIT_INTENT_BATCH_SIZE || 10);
const maxAttempts = Number(process.env.PROFIT_INTENT_MAX_ATTEMPTS || 3);
const pollIntervalMs = Number(process.env.PROFIT_INTENT_POLL_INTERVAL_MS || 15000);
const continuousMode = process.env.PROFIT_INTENT_CONTINUOUS === 'true';
const approveMode = process.env.PROFIT_INTENT_APPROVE_MODE === 'exact' ? 'exact' : 'max';
const ZERO_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ADVISORY_LOCK_KEY = 424204003;

if (!rpcUrl) {
  throw new Error('Missing BASE_SEPOLIA_RPC_URL (or BASE_MAINNET_RPC_URL)');
}

if (!operatorKey || operatorKey === ZERO_PRIVATE_KEY) {
  throw new Error(
    'Missing valid PROFIT_OPERATOR_PRIVATE_KEY (or PLATFORM_OPERATOR_PRIVATE_KEY / PRIVATE_KEY)'
  );
}

if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
  throw new Error('PROFIT_INTENT_MAX_ATTEMPTS must be a positive integer');
}

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error('PROFIT_INTENT_POLL_INTERVAL_MS must be > 0');
}

const provider = new JsonRpcProvider(rpcUrl);
const baseSigner = new Wallet(operatorKey, provider);
const signer = new NonceManager(baseSigner);
const operatorAddress = baseSigner.address.toLowerCase();
const profitInterface = new Interface([
  'function deposit(uint256 amountUSDC)',
  'function owner() view returns (address)',
  'function usdcToken() view returns (address)',
]);
const erc20Abi = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const acquireWorkerLock = async () => {
  const rows = await sequelize.query('SELECT pg_try_advisory_lock(:key) AS "locked"', {
    type: QueryTypes.SELECT,
    replacements: { key: ADVISORY_LOCK_KEY },
  });
  return Array.isArray(rows) && rows[0] && rows[0].locked === true;
};

const releaseWorkerLock = async () => {
  await sequelize.query('SELECT pg_advisory_unlock(:key)', {
    type: QueryTypes.SELECT,
    replacements: { key: ADVISORY_LOCK_KEY },
  });
};

const loadPendingIntents = async () =>
  sequelize.query(
    `
    SELECT
      id,
      chain_id AS "chainId",
      property_id AS "propertyId",
      LOWER(profit_distributor_address) AS "profitDistributorAddress",
      usdc_amount_base_units::text AS "usdcAmountBaseUnits",
      attempt_count AS "attemptCount"
    FROM profit_distribution_intents
    WHERE status IN ('pending', 'failed')
      AND attempt_count < :maxAttempts
    ORDER BY created_at ASC
    LIMIT :limit
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { limit: batchSize, maxAttempts },
    }
  );

const markAttempt = async (id) => {
  await sequelize.query(
    `
    UPDATE profit_distribution_intents
    SET attempt_count = attempt_count + 1,
        last_attempt_at = NOW(),
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id } }
  );
};

const markSubmitted = async (id, txHash) => {
  await sequelize.query(
    `
    UPDATE profit_distribution_intents
    SET status = 'submitted',
        tx_hash = :txHash,
        submitted_at = NOW(),
        error_message = NULL,
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id, txHash } }
  );
  const rows = await sequelize.query(
    `
    SELECT
      chain_id AS "chainId",
      property_id AS "propertyId",
      created_by_address AS "createdByAddress",
      LOWER(profit_distributor_address) AS "profitDistributorAddress"
    FROM profit_distribution_intents
    WHERE id = :id
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { id },
    }
  );
  const intent = Array.isArray(rows) ? rows[0] : null;
  if (intent) {
    await upsertOnchainActivity(sequelize, {
      chainId: Number(intent.chainId),
      txHash,
      activityType: 'profit-deposit',
      status: 'submitted',
      actorRole: 'worker',
      actorAddress: intent.createdByAddress?.toLowerCase?.() ?? null,
      propertyId: intent.propertyId,
      intentType: 'profit',
      intentId: id,
      metadata: { profitDistributorAddress: intent.profitDistributorAddress },
    });
  }
};

const markConfirmed = async (id) => {
  await sequelize.query(
    `
    UPDATE profit_distribution_intents
    SET status = 'confirmed',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id } }
  );
  const rows = await sequelize.query(
    `
    SELECT
      chain_id AS "chainId",
      property_id AS "propertyId",
      created_by_address AS "createdByAddress",
      LOWER(profit_distributor_address) AS "profitDistributorAddress",
      tx_hash AS "txHash"
    FROM profit_distribution_intents
    WHERE id = :id
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { id },
    }
  );
  const intent = Array.isArray(rows) ? rows[0] : null;
  if (intent?.txHash) {
    await upsertOnchainActivity(sequelize, {
      chainId: Number(intent.chainId),
      txHash: intent.txHash,
      activityType: 'profit-deposit',
      status: 'confirmed',
      actorRole: 'worker',
      actorAddress: intent.createdByAddress?.toLowerCase?.() ?? null,
      propertyId: intent.propertyId,
      intentType: 'profit',
      intentId: id,
      metadata: { profitDistributorAddress: intent.profitDistributorAddress },
    });
  }
};

const markFailed = async (id, message) => {
  await sequelize.query(
    `
    UPDATE profit_distribution_intents
    SET status = 'failed',
        error_message = :message,
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id, message: message.slice(0, 500) } }
  );
};

const assertDistributorDeployed = async (address) => {
  if (!/^0x[a-f0-9]{40}$/.test(address || '')) {
    throw new Error('Invalid profit distributor address');
  }
  const code = await provider.getCode(address);
  if (!code || code === '0x') {
    throw new Error(`No contract deployed at profitDistributorAddress=${address}`);
  }
};

const assertOperatorOwnsDistributor = async (address) => {
  const data = profitInterface.encodeFunctionData('owner');
  const raw = await provider.call({ to: address, data });
  const [owner] = profitInterface.decodeFunctionResult('owner', raw);
  const distributorOwner = String(owner).toLowerCase();
  if (distributorOwner !== operatorAddress) {
    throw new Error(
      `ProfitDistributor owner mismatch (${distributorOwner}); expected operator ${operatorAddress}. ` +
      'Legacy distributor likely owner-controlled. Use owner wallet for deposits or redeploy property to operator-owned distributor.'
    );
  }
};

const callProfitAddress = async (to, fnName) => {
  const data = profitInterface.encodeFunctionData(fnName, []);
  const raw = await provider.call({ to, data });
  const [address] = profitInterface.decodeFunctionResult(fnName, raw);
  return String(address).toLowerCase();
};

const sendErc20TxWithNonceRetry = async (requestFactory) => {
  try {
    return await requestFactory();
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('nonce has already been used') || message.includes('nonce too low')) {
      signer.reset();
      return requestFactory();
    }
    throw error;
  }
};

const compactErrorMessage = (error) => {
  const raw = error instanceof Error ? error.message : String(error);
  let message = raw.replace(/\s+/g, ' ').trim();

  // Remove frequently huge serialized transaction blobs.
  message = message.replace(/\(transaction="0x[a-f0-9]+".*?\)/gi, '').trim();
  message = message.replace(/\(action="estimateGas".*?\)/gi, '').trim();
  message = message.replace(/\s+\(code=[A-Z_]+.*$/i, '').trim();

  const normalized = message.toLowerCase();
  if (normalized.includes('transfer amount exceeds allowance')) {
    return 'erc20-allowance-too-low: distributor transferFrom exceeded approved amount';
  }
  if (normalized.includes('insufficient funds for gas')) {
    return 'operator-insufficient-gas-funds: top up operator native balance';
  }
  if (normalized.includes('nonce too low') || normalized.includes('nonce has already been used')) {
    return 'nonce-conflict: concurrent sender used same nonce';
  }
  if (normalized.includes('quorum not met')) {
    return 'rpc-quorum-not-met: provider backends disagree';
  }
  if (normalized.includes('failed to detect network')) {
    return 'rpc-network-detect-failed: cannot detect chain from rpc endpoint';
  }
  if (normalized.includes('request timeout') || normalized.includes('etimedout')) {
    return 'rpc-timeout: upstream rpc request timed out';
  }

  return message || 'unknown-error';
};

const ensureUsdcAllowanceForDeposit = async (profitDistributorAddress, amountBaseUnits) => {
  const usdcAddress = await callProfitAddress(profitDistributorAddress, 'usdcToken');
  const owner = operatorAddress;
  const usdc = new Contract(usdcAddress, erc20Abi, signer);

  const balance = await usdc.balanceOf(owner);
  if (balance < amountBaseUnits) {
    throw new Error(
      `Insufficient operator USDC balance for profit deposit. required=${amountBaseUnits.toString()} balance=${balance.toString()} token=${usdcAddress}`
    );
  }

  const allowanceBefore = await usdc.allowance(owner, profitDistributorAddress);
  if (allowanceBefore >= amountBaseUnits) {
    return {
      usdcAddress,
      balance,
      allowanceBefore,
      allowanceAfter: allowanceBefore,
      approveTxHash: null,
      resetTxHash: null,
      usedResetFlow: false,
    };
  }

  const approveAmount = approveMode === 'exact' ? amountBaseUnits : MaxUint256;
  let approveTxHash = null;
  let resetTxHash = null;
  let usedResetFlow = false;

  try {
    const approveTx = await sendErc20TxWithNonceRetry(() =>
      usdc.approve(profitDistributorAddress, approveAmount)
    );
    await approveTx.wait();
    approveTxHash = approveTx.hash;
  } catch (approveError) {
    usedResetFlow = true;
    console.warn(
      `[profit-worker] initial approve failed token=${usdcAddress} spender=${profitDistributorAddress} error=${compactErrorMessage(
        approveError
      )}`
    );
    // Some ERC20s require setting allowance to 0 before a new approval value.
    const resetTx = await sendErc20TxWithNonceRetry(() => usdc.approve(profitDistributorAddress, 0n));
    await resetTx.wait();
    resetTxHash = resetTx.hash;

    const approveTx = await sendErc20TxWithNonceRetry(() =>
      usdc.approve(profitDistributorAddress, approveAmount)
    );
    await approveTx.wait();
    approveTxHash = approveTx.hash;
  }

  const allowanceAfter = await usdc.allowance(owner, profitDistributorAddress);
  if (allowanceAfter < amountBaseUnits) {
    throw new Error(
      `Allowance still insufficient after approval. before=${allowanceBefore.toString()} after=${allowanceAfter.toString()} required=${amountBaseUnits.toString()} token=${usdcAddress} spender=${profitDistributorAddress}`
    );
  }

  return {
    usdcAddress,
    balance,
    allowanceBefore,
    allowanceAfter,
    approveTxHash,
    resetTxHash,
    usedResetFlow,
  };
};

const buildStageError = (stage, error) => {
  const compact = compactErrorMessage(error);
  return `[${stage}] ${compact}`;
};

const sendDepositTx = async (intent) => {
  const data = profitInterface.encodeFunctionData('deposit', [BigInt(intent.usdcAmountBaseUnits)]);
  return signer.sendTransaction({
    to: intent.profitDistributorAddress,
    data,
  });
};

const processIntent = async (intent) => {
  await markAttempt(intent.id);
  await assertDistributorDeployed(intent.profitDistributorAddress);
  await assertOperatorOwnsDistributor(intent.profitDistributorAddress);
  const amountBaseUnits = BigInt(intent.usdcAmountBaseUnits);
  let allowanceSummary = null;

  try {
    allowanceSummary = await ensureUsdcAllowanceForDeposit(intent.profitDistributorAddress, amountBaseUnits);
  } catch (approveError) {
    throw new Error(buildStageError('allowance-stage', approveError));
  }

  let tx;
  try {
    tx = await sendDepositTx(intent);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('nonce has already been used') || message.includes('nonce too low')) {
      signer.reset();
      tx = await sendDepositTx(intent);
    } else {
      throw new Error(buildStageError('deposit-stage', error));
    }
  }

  await markSubmitted(intent.id, tx.hash);
  const receipt = await tx.wait();
  if (!receipt || Number(receipt.status) !== 1) {
    throw new Error(
      `[deposit-stage] transaction-reverted: tx=${tx.hash} status=${receipt?.status ?? 'unknown'}`
    );
  }

  await markConfirmed(intent.id);
  console.log(
    `confirmed profit intent=${intent.id} propertyId=${intent.propertyId} distributor=${intent.profitDistributorAddress} tx=${tx.hash} approveMode=${approveMode} allowanceBefore=${allowanceSummary?.allowanceBefore?.toString?.() ?? 'n/a'} allowanceAfter=${allowanceSummary?.allowanceAfter?.toString?.() ?? 'n/a'}`
  );
};

const processOnce = async () => {
  const network = await provider.getNetwork();
  const connectedChainId = Number(network.chainId);
  const intents = await loadPendingIntents();

  if (!Array.isArray(intents) || intents.length === 0) {
    console.log('no retry-eligible profit intents');
    return;
  }

  console.log(
    `processing ${intents.length} profit intent(s) with maxAttempts=${maxAttempts} rpc=${rpcUrl}`
  );
  for (const intent of intents) {
    try {
      const intentChainId = Number(intent.chainId);
      if (!Number.isInteger(intentChainId) || intentChainId !== connectedChainId) {
        const message = `Intent chain ${intent.chainId} does not match provider chain ${connectedChainId}`;
        await markFailed(intent.id, message);
        console.error(`failed profit intent=${intent.id}: ${message}`);
        continue;
      }
      await processIntent(intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await markFailed(intent.id, message);
      const attempts = Number(intent.attemptCount ?? 0) + 1;
      if (attempts >= maxAttempts) {
        console.error(
          `failed profit intent=${intent.id}: ${message} (dead-lettered after ${attempts} attempts)`
        );
      } else {
        console.error(
          `failed profit intent=${intent.id}: ${message} (attempt ${attempts}/${maxAttempts})`
        );
      }
    }
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const locked = await acquireWorkerLock();
  if (!locked) {
    console.log('profit worker lock not acquired (another worker is running). exiting.');
    return;
  }

  if (!continuousMode) {
    try {
      await processOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[profit-worker] run failed. Check RPC reachability and BASE_*_RPC_URL settings. rpc=${rpcUrl} error=${message}`
      );
      process.exitCode = 1;
    } finally {
      await releaseWorkerLock();
    }
    return;
  }

  console.log(`profit intent worker started (continuous mode, interval=${pollIntervalMs}ms)`);
  while (true) {
    try {
      await processOnce();
    } catch (error) {
      console.error(
        `[profit-worker] loop error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    await sleep(pollIntervalMs);
  }
};

try {
  await run();
} finally {
  try {
    await releaseWorkerLock();
  } catch (_error) {
    // Ignore unlock errors in shutdown path.
  }
  await sequelize.close();
}
