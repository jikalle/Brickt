import { Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { sendError } from '../../lib/apiError.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  ValidationError,
  normalizeAddress,
  parseEventCursor,
  parseLimit,
} from '../../validators/v1.js';

const handleError = (res: Response, error: unknown) => {
  if (error instanceof ValidationError) {
    return sendError(res, error.status, error.message, 'validation_error');
  }
  console.error(error);
  return sendError(res, 500, 'Internal server error', 'internal_error');
};

const requireUserAddress = (req: AuthenticatedRequest): string => {
  if (!req.user?.address) {
    throw new ValidationError('Unauthorized', 401);
  }
  return normalizeAddress(req.user.address, 'address');
};

type InvestmentRow = {
  propertyId: string;
  campaignAddress: string;
  investorAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
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

export const listMyInvestments = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const investorAddress = requireUserAddress(req);
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: InvestmentRow[] = await sequelize.query<InvestmentRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(c.contract_address) AS "campaignAddress",
        LOWER(ci.investor_address) AS "investorAddress",
        ci.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        ci.tx_hash AS "txHash",
        ci.log_index AS "logIndex",
        ci.block_number::text AS "blockNumber",
        ci.created_at AS "createdAt"
      FROM campaign_investments ci
      JOIN campaigns c ON c.id = ci.campaign_id
      JOIN properties p ON p.id = ci.property_id
      WHERE ci.chain_id = :chainId
        AND c.chain_id = :chainId
        AND ci.investor_address = :investorAddress
        ${
          cursor
            ? 'AND (ci.block_number, ci.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY ci.block_number ASC, ci.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          investorAddress,
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

    return res.json({ investments: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listMyEquityClaims = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const claimantAddress = requireUserAddress(req);
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
        ec.block_number::text AS "blockNumber",
        ec.created_at AS "createdAt"
      FROM equity_claims ec
      JOIN equity_tokens et ON et.id = ec.equity_token_id
      JOIN properties p ON p.id = ec.property_id
      LEFT JOIN campaigns c ON c.id = ec.campaign_id
      WHERE ec.chain_id = :chainId
        AND ec.claimant_address = :claimantAddress
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
          claimantAddress,
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

export const listMyProfitClaims = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const claimerAddress = requireUserAddress(req);
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
        pc.block_number::text AS "blockNumber",
        pc.created_at AS "createdAt"
      FROM profit_claims pc
      JOIN profit_distributors pdistr ON pdistr.id = pc.profit_distributor_id
      JOIN properties p ON p.id = pc.property_id
      WHERE pc.chain_id = :chainId
        AND pc.claimer_address = :claimerAddress
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
          claimerAddress,
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
