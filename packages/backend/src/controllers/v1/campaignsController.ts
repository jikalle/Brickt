import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { getCrowdfundFeeInfo } from './crowdfundFee.js';
import { sendError } from '../../lib/apiError.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  ValidationError,
  normalizeAddress,
  parseCampaignCursor,
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

type CampaignRow = {
  propertyId: string;
  campaignAddress: string;
  startTime: string;
  endTime: string | null;
  state: string;
  targetUsdcBaseUnits: string;
  raisedUsdcBaseUnits: string;
  finalizedTxHash: string | null;
  finalizedLogIndex: number | null;
  finalizedBlockNumber: string | null;
  createdAt: string;
  updatedAt: string;
};

type CampaignInvestmentRow = {
  propertyId: string;
  campaignAddress: string;
  investorAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

type CampaignRefundRow = {
  propertyId: string;
  campaignAddress: string;
  investorAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

export const listCampaigns = async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit);
    const cursor = parseCampaignCursor(req.query);
    const campaignCursor = cursor
      ? { startTime: cursor.cursorStartTime, contractAddress: cursor.cursorContractAddress }
      : null;
    const limitPlus = limit + 1;

    const rows: CampaignRow[] = await sequelize.query<CampaignRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(c.contract_address) AS "campaignAddress",
        c.start_time AS "startTime",
        c.end_time AS "endTime",
        c.state AS "state",
        c.target_usdc_base_units::text AS "targetUsdcBaseUnits",
        (
          CASE
            WHEN EXISTS (SELECT 1 FROM campaign_investments ci0 WHERE ci0.campaign_id = c.id)
              OR EXISTS (SELECT 1 FROM campaign_refunds cr0 WHERE cr0.campaign_id = c.id)
            THEN (
              COALESCE(
                (SELECT SUM(ci.usdc_amount_base_units) FROM campaign_investments ci WHERE ci.campaign_id = c.id),
                0
              )
              -
              COALESCE(
                (SELECT SUM(cr.usdc_amount_base_units) FROM campaign_refunds cr WHERE cr.campaign_id = c.id),
                0
              )
            )
            ELSE c.raised_usdc_base_units
          END
        )::text AS "raisedUsdcBaseUnits",
        c.finalized_tx_hash AS "finalizedTxHash",
        c.finalized_log_index AS "finalizedLogIndex",
        c.finalized_block_number::text AS "finalizedBlockNumber",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt"
      FROM campaigns c
      JOIN properties p ON p.id = c.property_id
      WHERE c.chain_id = :chainId
        AND p.archived_at IS NULL
        ${
          cursor
            ? 'AND (c.start_time, c.contract_address) > (:cursorStartTime, :cursorContractAddress)'
            : ''
        }
      ORDER BY c.start_time ASC, c.contract_address ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          cursorStartTime: campaignCursor?.startTime,
          cursorContractAddress: campaignCursor?.contractAddress,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const feeInfo = await getCrowdfundFeeInfo(item.campaignAddress);
        return { ...item, ...feeInfo };
      })
    );
    const nextCursor =
      rows.length > limit
        ? {
            cursorStartTime: items[items.length - 1]?.startTime,
            cursorContractAddress: items[items.length - 1]?.campaignAddress,
          }
        : null;

    return res.json({ campaigns: enrichedItems, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getCampaign = async (req: Request, res: Response) => {
  try {
    const campaignAddress = normalizeAddress(req.params.campaignAddress, 'campaignAddress');

    const rows: CampaignRow[] = await sequelize.query<CampaignRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(c.contract_address) AS "campaignAddress",
        c.start_time AS "startTime",
        c.end_time AS "endTime",
        c.state AS "state",
        c.target_usdc_base_units::text AS "targetUsdcBaseUnits",
        (
          CASE
            WHEN EXISTS (SELECT 1 FROM campaign_investments ci0 WHERE ci0.campaign_id = c.id)
              OR EXISTS (SELECT 1 FROM campaign_refunds cr0 WHERE cr0.campaign_id = c.id)
            THEN (
              COALESCE(
                (SELECT SUM(ci.usdc_amount_base_units) FROM campaign_investments ci WHERE ci.campaign_id = c.id),
                0
              )
              -
              COALESCE(
                (SELECT SUM(cr.usdc_amount_base_units) FROM campaign_refunds cr WHERE cr.campaign_id = c.id),
                0
              )
            )
            ELSE c.raised_usdc_base_units
          END
        )::text AS "raisedUsdcBaseUnits",
        c.finalized_tx_hash AS "finalizedTxHash",
        c.finalized_log_index AS "finalizedLogIndex",
        c.finalized_block_number::text AS "finalizedBlockNumber",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt"
      FROM campaigns c
      JOIN properties p ON p.id = c.property_id
      WHERE c.chain_id = :chainId
        AND c.contract_address = :campaignAddress
        AND p.archived_at IS NULL
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          campaignAddress,
        },
      }
    );

    const campaign = rows[0];
    if (!campaign) {
      return sendError(res, 404, 'Campaign not found', 'not_found');
    }

    const feeInfo = await getCrowdfundFeeInfo(campaign.campaignAddress);
    return res.json({ campaign: { ...campaign, ...feeInfo } });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listCampaignInvestments = async (req: Request, res: Response) => {
  try {
    const campaignAddress = normalizeAddress(req.params.campaignAddress, 'campaignAddress');
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: CampaignInvestmentRow[] = await sequelize.query<CampaignInvestmentRow>(
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
        AND p.archived_at IS NULL
        AND c.contract_address = :campaignAddress
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
          campaignAddress,
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

export const listCampaignRefunds = async (req: Request, res: Response) => {
  try {
    const campaignAddress = normalizeAddress(req.params.campaignAddress, 'campaignAddress');
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: CampaignRefundRow[] = await sequelize.query<CampaignRefundRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(c.contract_address) AS "campaignAddress",
        LOWER(cr.investor_address) AS "investorAddress",
        cr.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        cr.tx_hash AS "txHash",
        cr.log_index AS "logIndex",
        cr.block_number::text AS "blockNumber",
        cr.created_at AS "createdAt"
      FROM campaign_refunds cr
      JOIN campaigns c ON c.id = cr.campaign_id
      JOIN properties p ON p.id = cr.property_id
      WHERE cr.chain_id = :chainId
        AND c.chain_id = :chainId
        AND p.archived_at IS NULL
        AND c.contract_address = :campaignAddress
        ${
          cursor
            ? 'AND (cr.block_number, cr.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY cr.block_number ASC, cr.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          campaignAddress,
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

    return res.json({ refunds: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};
