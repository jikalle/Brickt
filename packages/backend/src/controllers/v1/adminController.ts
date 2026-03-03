import { Response } from 'express';
import { randomUUID } from 'crypto';
import { Interface, JsonRpcProvider, Wallet } from 'ethers';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { sendError } from '../../lib/apiError.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  ValidationError,
  normalizeAddress,
  parseBaseUnits,
  parseFeeBps,
  parseLimit,
  validateChainId,
  validatePropertyId,
} from '../../validators/v1.js';

const handleError = (res: Response, error: unknown) => {
  if (error instanceof ValidationError) {
    return sendError(res, error.status, error.message, 'validation_error');
  }
  console.error(error);
  return sendError(res, 500, 'Internal server error', 'internal_error');
};

const requireAdminAddress = (req: AuthenticatedRequest): string => {
  if (!req.user?.address) {
    throw new ValidationError('Unauthorized', 401);
  }
  return normalizeAddress(req.user.address, 'address');
};

const parseIntentStatus = (value: unknown): 'pending' | 'submitted' | 'confirmed' | 'failed' | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (
    normalized !== 'pending' &&
    normalized !== 'submitted' &&
    normalized !== 'confirmed' &&
    normalized !== 'failed'
  ) {
    throw new ValidationError('Invalid status filter');
  }
  return normalized;
};

const parseOptionalTimestamp = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = new Date(value.toString());
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Invalid ${field}`);
  }
  return parsed.toISOString();
};

const profitReadInterface = new Interface([
  'function owner() view returns (address)',
  'function usdcToken() view returns (address)',
]);

const erc20ReadInterface = new Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

const getOperatorAddress = (): string | null => {
  const key =
    process.env.PROFIT_OPERATOR_PRIVATE_KEY ||
    process.env.PLATFORM_OPERATOR_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    '';
  const ZERO_PRIVATE_KEY =
    '0x0000000000000000000000000000000000000000000000000000000000000000';
  if (!key || key === ZERO_PRIVATE_KEY) {
    return null;
  }
  try {
    return new Wallet(key).address.toLowerCase();
  } catch {
    return null;
  }
};

export const createPropertyIntent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId);
    const propertyId = validatePropertyId(req.body.propertyId);
    const name = req.body.name?.toString().trim();
    const location = req.body.location?.toString().trim();
    const description = req.body.description?.toString().trim();
    const targetUsdcBaseUnits = parseBaseUnits(req.body.targetUsdcBaseUnits, 'targetUsdcBaseUnits');
    const startTime = parseOptionalTimestamp(req.body.startTime, 'startTime');
    const endTime = parseOptionalTimestamp(req.body.endTime, 'endTime');
    const crowdfundContractAddress = req.body.crowdfundAddress ?? req.body.crowdfundContractAddress;
    const crowdfundAddress = crowdfundContractAddress
      ? normalizeAddress(crowdfundContractAddress.toString(), 'crowdfundAddress')
      : null;

    if ((startTime && !endTime) || (!startTime && endTime)) {
      throw new ValidationError('Provide both startTime and endTime together');
    }
    if (startTime && endTime && new Date(endTime).getTime() <= new Date(startTime).getTime()) {
      throw new ValidationError('endTime must be after startTime');
    }

    if (!name) {
      throw new ValidationError('Missing name');
    }

    if (!location) {
      throw new ValidationError('Missing location');
    }

    if (!description) {
      throw new ValidationError('Missing description');
    }

    const [rows] = await sequelize.query(
      `
      INSERT INTO property_intents (
        id,
        chain_id,
        property_id,
        name,
        location,
        description,
        target_usdc_base_units,
        start_time,
        end_time,
        crowdfund_contract_address,
        created_by_address
      )
      VALUES (
        :id,
        :chainId,
        :propertyId,
        :name,
        :location,
        :description,
        :targetUsdcBaseUnits,
        :startTime,
        :endTime,
        :crowdfundContractAddress,
        :createdByAddress
      )
      RETURNING
        property_id AS "propertyId",
        name,
        location,
        description,
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        start_time AS "startTime",
        end_time AS "endTime",
        LOWER(crowdfund_contract_address) AS "crowdfundAddress",
        status,
        tx_hash AS "txHash",
        error_message AS "errorMessage",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      {
        replacements: {
          id: randomUUID(),
          chainId,
          propertyId,
          name,
          location,
          description,
          targetUsdcBaseUnits,
          startTime,
          endTime,
          crowdfundContractAddress: crowdfundAddress,
          createdByAddress: adminAddress,
        },
      }
    );

    const intent = Array.isArray(rows) ? rows[0] : null;
    return res.status(201).json({ intent });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createProfitDistributionIntent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId);
    const propertyId = validatePropertyId(req.body.propertyId);
    const profitDistributorAddress = normalizeAddress(
      req.body.profitDistributorAddress?.toString(),
      'profitDistributorAddress'
    );
    const usdcAmountBaseUnits = parseBaseUnits(req.body.usdcAmountBaseUnits, 'usdcAmountBaseUnits');

    const [rows] = await sequelize.query(
      `
      INSERT INTO profit_distribution_intents (
        id,
        chain_id,
        property_id,
        profit_distributor_address,
        usdc_amount_base_units,
        created_by_address
      )
      VALUES (
        :id,
        :chainId,
        :propertyId,
        :profitDistributorAddress,
        :usdcAmountBaseUnits,
        :createdByAddress
      )
      RETURNING
        property_id AS "propertyId",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        status,
        tx_hash AS "txHash",
        error_message AS "errorMessage",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      {
        replacements: {
          id: randomUUID(),
          chainId,
          propertyId,
          profitDistributorAddress,
          usdcAmountBaseUnits,
          createdByAddress: adminAddress,
        },
      }
    );

    const intent = Array.isArray(rows) ? rows[0] : null;
    return res.status(201).json({ intent });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createPlatformFeeIntent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId);
    const campaignAddress = normalizeAddress(
      req.body.campaignAddress?.toString(),
      'campaignAddress'
    );
    const platformFeeBps = parseFeeBps(req.body.platformFeeBps, 'platformFeeBps');
    const recipientRaw = req.body.platformFeeRecipient ?? req.body.feeRecipient;
    const platformFeeRecipient =
      platformFeeBps === 0
        ? null
        : normalizeAddress(recipientRaw?.toString(), 'platformFeeRecipient');

    const [rows] = await sequelize.query(
      `
      INSERT INTO platform_fee_intents (
        id,
        chain_id,
        campaign_address,
        platform_fee_bps,
        platform_fee_recipient,
        created_by_address
      )
      VALUES (
        :id,
        :chainId,
        :campaignAddress,
        :platformFeeBps,
        :platformFeeRecipient,
        :createdByAddress
      )
      RETURNING
        LOWER(campaign_address) AS "campaignAddress",
        platform_fee_bps AS "platformFeeBps",
        LOWER(platform_fee_recipient) AS "platformFeeRecipient",
        status,
        tx_hash AS "txHash",
        error_message AS "errorMessage",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      {
        replacements: {
          id: randomUUID(),
          chainId,
          campaignAddress,
          platformFeeBps,
          platformFeeRecipient,
          createdByAddress: adminAddress,
        },
      }
    );

    const intent = Array.isArray(rows) ? rows[0] : null;
    return res.status(201).json({ intent });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listPropertyIntents = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const limit = parseLimit(req.query.limit, 20, 200);
    const status = parseIntentStatus(req.query.status);

    const intents = await sequelize.query(
      `
      SELECT
        id,
        chain_id AS "chainId",
        property_id AS "propertyId",
        name,
        location,
        description,
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        start_time AS "startTime",
        end_time AS "endTime",
        LOWER(crowdfund_contract_address) AS "crowdfundAddress",
        status,
        tx_hash AS "txHash",
        error_message AS "errorMessage",
        attempt_count AS "attemptCount",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM property_intents
      WHERE created_by_address = :createdByAddress
        ${status ? 'AND status = :status' : ''}
      ORDER BY created_at DESC
      LIMIT :limit
      `,
      {
        replacements: {
          createdByAddress: adminAddress,
          status,
          limit,
        },
      }
    );

    return res.json({ intents: Array.isArray(intents[0]) ? intents[0] : [] });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listProfitDistributionIntents = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const limit = parseLimit(req.query.limit, 20, 200);
    const status = parseIntentStatus(req.query.status);

    const intents = await sequelize.query(
      `
      SELECT
        id,
        chain_id AS "chainId",
        property_id AS "propertyId",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        status,
        tx_hash AS "txHash",
        error_message AS "errorMessage",
        attempt_count AS "attemptCount",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM profit_distribution_intents
      WHERE created_by_address = :createdByAddress
        ${status ? 'AND status = :status' : ''}
      ORDER BY created_at DESC
      LIMIT :limit
      `,
      {
        replacements: {
          createdByAddress: adminAddress,
          status,
          limit,
        },
      }
    );

    return res.json({ intents: Array.isArray(intents[0]) ? intents[0] : [] });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listPlatformFeeIntents = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const limit = parseLimit(req.query.limit, 20, 200);
    const status = parseIntentStatus(req.query.status);

    const intents = await sequelize.query(
      `
      SELECT
        id,
        chain_id AS "chainId",
        LOWER(campaign_address) AS "campaignAddress",
        platform_fee_bps AS "platformFeeBps",
        LOWER(platform_fee_recipient) AS "platformFeeRecipient",
        status,
        tx_hash AS "txHash",
        error_message AS "errorMessage",
        attempt_count AS "attemptCount",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM platform_fee_intents
      WHERE created_by_address = :createdByAddress
        ${status ? 'AND status = :status' : ''}
      ORDER BY created_at DESC
      LIMIT :limit
      `,
      {
        replacements: {
          createdByAddress: adminAddress,
          status,
          limit,
        },
      }
    );

    return res.json({ intents: Array.isArray(intents[0]) ? intents[0] : [] });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getProfitPreflight = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const propertyId = validatePropertyId(req.query.propertyId?.toString() || '');
    const usdcAmountBaseUnits =
      req.query.usdcAmountBaseUnits !== undefined && req.query.usdcAmountBaseUnits !== null
        ? parseBaseUnits(req.query.usdcAmountBaseUnits, 'usdcAmountBaseUnits')
        : '0';

    const propertyRows = await sequelize.query<{
      propertyId: string;
      profitDistributorAddress: string;
    }>(
      `
      SELECT
        property_id AS "propertyId",
        LOWER(profit_distributor_address) AS "profitDistributorAddress"
      FROM properties
      WHERE chain_id = :chainId
        AND property_id = :propertyId
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { chainId: BASE_SEPOLIA_CHAIN_ID, propertyId },
      }
    );
    const property = propertyRows[0] ?? null;
    if (!property?.profitDistributorAddress) {
      return sendError(res, 404, 'Property or profit distributor not found', 'not_found');
    }

    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const operatorAddress = getOperatorAddress();

    const ownerData = profitReadInterface.encodeFunctionData('owner', []);
    const ownerRaw = await provider.call({ to: property.profitDistributorAddress, data: ownerData });
    const [distributorOwner] = profitReadInterface.decodeFunctionResult('owner', ownerRaw);

    const usdcData = profitReadInterface.encodeFunctionData('usdcToken', []);
    const usdcRaw = await provider.call({ to: property.profitDistributorAddress, data: usdcData });
    const [usdcTokenAddress] = profitReadInterface.decodeFunctionResult('usdcToken', usdcRaw);

    const normalizedDistributorOwner = String(distributorOwner).toLowerCase();
    const normalizedUsdcTokenAddress = String(usdcTokenAddress).toLowerCase();

    let operatorUsdcBalance = '0';
    let operatorAllowance = '0';
    if (operatorAddress) {
      const balanceData = erc20ReadInterface.encodeFunctionData('balanceOf', [operatorAddress]);
      const balanceRaw = await provider.call({ to: normalizedUsdcTokenAddress, data: balanceData });
      const [balance] = erc20ReadInterface.decodeFunctionResult('balanceOf', balanceRaw);
      operatorUsdcBalance = balance.toString();

      const allowanceData = erc20ReadInterface.encodeFunctionData('allowance', [
        operatorAddress,
        property.profitDistributorAddress,
      ]);
      const allowanceRaw = await provider.call({ to: normalizedUsdcTokenAddress, data: allowanceData });
      const [allowance] = erc20ReadInterface.decodeFunctionResult('allowance', allowanceRaw);
      operatorAllowance = allowance.toString();
    }

    const required = BigInt(usdcAmountBaseUnits);
    const hasSufficientBalance = BigInt(operatorUsdcBalance) >= required;
    const hasSufficientAllowance = BigInt(operatorAllowance) >= required;
    const ownerMatchesOperator =
      operatorAddress !== null && normalizedDistributorOwner === operatorAddress;

    const stateRows = await sequelize.query<{ last_block: string }>(
      'SELECT last_block::text AS last_block FROM indexer_state WHERE chain_id = :chainId LIMIT 1',
      {
        type: QueryTypes.SELECT,
        replacements: { chainId: BASE_SEPOLIA_CHAIN_ID },
      }
    );
    const indexerLastBlock = stateRows[0] ? Number(stateRows[0].last_block) : 0;

    const staleMinutes = 5;
    const staleRows = await sequelize.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM (
        SELECT id, submitted_at FROM property_intents WHERE status = 'submitted'
        UNION ALL
        SELECT id, submitted_at FROM profit_distribution_intents WHERE status = 'submitted'
        UNION ALL
        SELECT id, submitted_at FROM platform_fee_intents WHERE status = 'submitted'
      ) AS intents
      WHERE submitted_at IS NOT NULL
        AND submitted_at < NOW() - (:staleMinutes::text || ' minutes')::interval
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { staleMinutes },
      }
    );
    const staleSubmittedIntents = Number(staleRows[0] ? staleRows[0].count : '0');

    return res.json({
      propertyId,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      profitDistributorAddress: property.profitDistributorAddress,
      usdcTokenAddress: normalizedUsdcTokenAddress,
      operatorAddress,
      distributorOwner: normalizedDistributorOwner,
      requiredUsdcAmountBaseUnits: usdcAmountBaseUnits,
      operatorUsdcBalanceBaseUnits: operatorUsdcBalance,
      operatorAllowanceBaseUnits: operatorAllowance,
      checks: {
        operatorConfigured: Boolean(operatorAddress),
        ownerMatchesOperator,
        hasSufficientBalance,
        hasSufficientAllowance,
        indexerHealthy: indexerLastBlock > 0,
        workersHealthy: staleSubmittedIntents === 0,
      },
      observability: {
        indexerLastBlock,
        staleSubmittedIntents,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getProfitFlowStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const propertyId = validatePropertyId(req.query.propertyId?.toString() || '');

    const intentRows = await sequelize.query<{
      id: string;
      status: string;
      submittedAt: string | null;
      confirmedAt: string | null;
      txHash: string | null;
    }>(
      `
      SELECT
        id,
        status,
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        tx_hash AS "txHash"
      FROM profit_distribution_intents
      WHERE property_id = :propertyId
      ORDER BY created_at DESC
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { propertyId },
      }
    );

    const depositRows = await sequelize.query<{
      txHash: string;
      createdAt: string;
      amountBaseUnits: string;
    }>(
      `
      SELECT
        pd.tx_hash AS "txHash",
        pd.created_at AS "createdAt",
        pd.usdc_amount_base_units::text AS "amountBaseUnits"
      FROM profit_deposits pd
      JOIN properties p ON p.id = pd.property_id
      WHERE p.property_id = :propertyId
      ORDER BY pd.block_number DESC, pd.log_index DESC
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { propertyId },
      }
    );

    const poolRows = await sequelize.query<{ unclaimedBaseUnits: string }>(
      `
      SELECT (
        COALESCE((
          SELECT SUM(pd.usdc_amount_base_units)
          FROM profit_deposits pd
          JOIN properties p ON p.id = pd.property_id
          WHERE p.property_id = :propertyId
        ), 0)
        -
        COALESCE((
          SELECT SUM(pc.usdc_amount_base_units)
          FROM profit_claims pc
          JOIN properties p ON p.id = pc.property_id
          WHERE p.property_id = :propertyId
        ), 0)
      )::text AS "unclaimedBaseUnits"
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { propertyId },
      }
    );

    const latestIntent = intentRows[0] ?? null;
    const latestDeposit = depositRows[0] ?? null;
    const unclaimedBaseUnits = BigInt(poolRows[0] ? poolRows[0].unclaimedBaseUnits : '0');

    return res.json({
      propertyId,
      flags: {
        intentSubmitted: Boolean(latestIntent),
        intentConfirmed: latestIntent?.status === 'confirmed',
        depositIndexed: Boolean(latestDeposit),
        claimablePoolPositive: unclaimedBaseUnits > 0n,
      },
      latestIntent,
      latestDeposit,
      unclaimedPoolBaseUnits: unclaimedBaseUnits.toString(),
    });
  } catch (error) {
    return handleError(res, error);
  }
};
