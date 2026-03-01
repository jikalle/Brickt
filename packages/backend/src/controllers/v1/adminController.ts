import { Response } from 'express';
import { randomUUID } from 'crypto';
import { sequelize } from '../../db/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import {
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
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: 'Internal server error' });
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

export const createPropertyIntent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId);
    const propertyId = validatePropertyId(req.body.propertyId);
    const name = req.body.name?.toString().trim();
    const location = req.body.location?.toString().trim();
    const description = req.body.description?.toString().trim();
    const targetUsdcBaseUnits = parseBaseUnits(req.body.targetUsdcBaseUnits, 'targetUsdcBaseUnits');
    const crowdfundContractAddress = req.body.crowdfundAddress ?? req.body.crowdfundContractAddress;
    const crowdfundAddress = crowdfundContractAddress
      ? normalizeAddress(crowdfundContractAddress.toString(), 'crowdfundAddress')
      : null;

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
        :crowdfundContractAddress,
        :createdByAddress
      )
      RETURNING
        property_id AS "propertyId",
        name,
        location,
        description,
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
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
