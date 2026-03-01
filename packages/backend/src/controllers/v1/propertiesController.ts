import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { getCrowdfundFeeInfo } from './crowdfundFee.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  ValidationError,
  parseEventCursor,
  parseLimit,
  parsePropertyCursor,
  validatePropertyId,
} from '../../validators/v1.js';

const handleError = (res: Response, error: unknown) => {
  if (error instanceof ValidationError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: 'Internal server error' });
};

type PropertyRow = {
  propertyId: string;
  name: string;
  location: string;
  description: string;
  crowdfundAddress: string;
  equityTokenAddress: string;
  profitDistributorAddress: string;
  targetUsdcBaseUnits: string;
  createdAt: string;
  updatedAt: string;
};

type EquityClaimRow = {
  propertyId: string;
  equityTokenAddress: string;
  campaignAddress: string | null;
  claimantAddress: string;
  equityAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

type ProfitDepositRow = {
  propertyId: string;
  profitDistributorAddress: string;
  depositorAddress: string;
  usdcAmountBaseUnits: string;
  accProfitPerShare: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

type ProfitClaimRow = {
  propertyId: string;
  profitDistributorAddress: string;
  claimerAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

export const listProperties = async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit);
    const cursorPropertyId = parsePropertyCursor(req.query);
    const limitPlus = limit + 1;

    const rows: PropertyRow[] = await sequelize.query<PropertyRow>(
      `
      SELECT
        property_id AS "propertyId",
        name,
        location,
        description,
        LOWER(crowdfund_contract_address) AS "crowdfundAddress",
        LOWER(equity_token_address) AS "equityTokenAddress",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM properties
      WHERE chain_id = :chainId
        ${cursorPropertyId ? 'AND property_id > :cursorPropertyId' : ''}
      ORDER BY property_id ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          cursorPropertyId,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const feeInfo = await getCrowdfundFeeInfo(item.crowdfundAddress);
        return { ...item, ...feeInfo };
      })
    );
    const nextCursor = rows.length > limit ? items[items.length - 1]?.propertyId : null;

    return res.json({ properties: enrichedItems, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getProperty = async (req: Request, res: Response) => {
  try {
    const propertyId = validatePropertyId(req.params.propertyId);

    const rows: PropertyRow[] = await sequelize.query<PropertyRow>(
      `
      SELECT
        property_id AS "propertyId",
        name,
        location,
        description,
        LOWER(crowdfund_contract_address) AS "crowdfundAddress",
        LOWER(equity_token_address) AS "equityTokenAddress",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM properties
      WHERE chain_id = :chainId AND property_id = :propertyId
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          propertyId,
        },
      }
    );

    const property = rows[0];
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const feeInfo = await getCrowdfundFeeInfo(property.crowdfundAddress);
    return res.json({ property: { ...property, ...feeInfo } });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listEquityClaims = async (req: Request, res: Response) => {
  try {
    const propertyId = validatePropertyId(req.params.propertyId);
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: EquityClaimRow[] = await sequelize.query<EquityClaimRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(et.contract_address) AS "equityTokenAddress",
        LOWER(c.contract_address) AS "campaignAddress",
        LOWER(ec.claimant_address) AS "claimantAddress",
        ec.equity_amount_base_units::text AS "equityAmountBaseUnits",
        ec.tx_hash AS "txHash",
        ec.log_index AS "logIndex",
        ec.block_number AS "blockNumber",
        ec.created_at AS "createdAt"
      FROM equity_claims ec
      JOIN properties p ON p.id = ec.property_id
      JOIN equity_tokens et ON et.id = ec.equity_token_id
      LEFT JOIN campaigns c ON c.id = ec.campaign_id
      WHERE ec.chain_id = :chainId
        AND p.property_id = :propertyId
        ${
          cursor
            ? 'AND (ec.block_number, ec.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY ec.block_number ASC, ec.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          propertyId,
          cursorBlockNumber: eventCursor?.blockNumber,
          cursorLogIndex: eventCursor?.logIndex,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? {
            cursorBlockNumber: items[items.length - 1]?.blockNumber,
            cursorLogIndex: items[items.length - 1]?.logIndex,
          }
        : null;

    return res.json({ equityClaims: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listProfitDeposits = async (req: Request, res: Response) => {
  try {
    const propertyId = validatePropertyId(req.params.propertyId);
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: ProfitDepositRow[] = await sequelize.query<ProfitDepositRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(pdistr.contract_address) AS "profitDistributorAddress",
        LOWER(pd.depositor_address) AS "depositorAddress",
        pd.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        pd.acc_profit_per_share::text AS "accProfitPerShare",
        pd.tx_hash AS "txHash",
        pd.log_index AS "logIndex",
        pd.block_number AS "blockNumber",
        pd.created_at AS "createdAt"
      FROM profit_deposits pd
      JOIN properties p ON p.id = pd.property_id
      JOIN profit_distributors pdistr ON pdistr.id = pd.profit_distributor_id
      WHERE pd.chain_id = :chainId
        AND p.property_id = :propertyId
        ${
          cursor
            ? 'AND (pd.block_number, pd.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY pd.block_number ASC, pd.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          propertyId,
          cursorBlockNumber: eventCursor?.blockNumber,
          cursorLogIndex: eventCursor?.logIndex,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? {
            cursorBlockNumber: items[items.length - 1]?.blockNumber,
            cursorLogIndex: items[items.length - 1]?.logIndex,
          }
        : null;

    return res.json({ profitDeposits: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listProfitClaims = async (req: Request, res: Response) => {
  try {
    const propertyId = validatePropertyId(req.params.propertyId);
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: ProfitClaimRow[] = await sequelize.query<ProfitClaimRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(pdistr.contract_address) AS "profitDistributorAddress",
        LOWER(pc.claimer_address) AS "claimerAddress",
        pc.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        pc.tx_hash AS "txHash",
        pc.log_index AS "logIndex",
        pc.block_number AS "blockNumber",
        pc.created_at AS "createdAt"
      FROM profit_claims pc
      JOIN properties p ON p.id = pc.property_id
      JOIN profit_distributors pdistr ON pdistr.id = pc.profit_distributor_id
      WHERE pc.chain_id = :chainId
        AND p.property_id = :propertyId
        ${
          cursor
            ? 'AND (pc.block_number, pc.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY pc.block_number ASC, pc.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          propertyId,
          cursorBlockNumber: eventCursor?.blockNumber,
          cursorLogIndex: eventCursor?.logIndex,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? {
            cursorBlockNumber: items[items.length - 1]?.blockNumber,
            cursorLogIndex: items[items.length - 1]?.logIndex,
          }
        : null;

    return res.json({ profitClaims: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};
