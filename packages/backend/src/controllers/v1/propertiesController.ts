import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { getCrowdfundFeeInfo } from './crowdfundFee.js';
import { sendError } from '../../lib/apiError.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  ValidationError,
  parseEventCursor,
  parseLimit,
  validatePropertyId,
} from '../../validators/v1.js';

const handleError = (res: Response, error: unknown) => {
  if (error instanceof ValidationError) {
    return sendError(res, error.status, error.message, 'validation_error');
  }
  console.error(error);
  return sendError(res, 500, 'Internal server error', 'internal_error');
};

type PropertyRow = {
  propertyUuid?: string;
  propertyId: string;
  name: string;
  location: string;
  description: string;
  bestFor: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  youtubeEmbedUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  crowdfundAddress: string;
  equityTokenAddress: string;
  profitDistributorAddress: string;
  targetUsdcBaseUnits: string;
  estimatedSellUsdcBaseUnits: string | null;
  conservativeSellUsdcBaseUnits: string | null;
  baseSellUsdcBaseUnits: string | null;
  optimisticSellUsdcBaseUnits: string | null;
  conservativeMultiplierBps: number | null;
  baseMultiplierBps: number | null;
  optimisticMultiplierBps: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
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

const PROPERTY_BEST_FOR_VALUES = new Set(['sell', 'rent', 'build_and_sell', 'build_and_rent']);

export const listProperties = async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit);
    const limitPlus = limit;

    const rows: PropertyRow[] = await sequelize.query<PropertyRow>(
      `
      SELECT
        property_id AS "propertyId",
        name,
        location,
        description,
        best_for AS "bestFor",
        image_url AS "imageUrl",
        COALESCE(
          (
            SELECT json_agg(pi.image_url ORDER BY pi.sort_order ASC, pi.created_at ASC)
            FROM property_images pi
            WHERE pi.property_id = properties.id
          ),
          '[]'::json
        ) AS "imageUrls",
        youtube_embed_url AS "youtubeEmbedUrl",
        latitude::double precision AS "latitude",
        longitude::double precision AS "longitude",
        LOWER(crowdfund_contract_address) AS "crowdfundAddress",
        LOWER(equity_token_address) AS "equityTokenAddress",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        estimated_sell_usdc_base_units::text AS "estimatedSellUsdcBaseUnits",
        conservative_sell_usdc_base_units::text AS "conservativeSellUsdcBaseUnits",
        base_sell_usdc_base_units::text AS "baseSellUsdcBaseUnits",
        optimistic_sell_usdc_base_units::text AS "optimisticSellUsdcBaseUnits",
        conservative_multiplier_bps AS "conservativeMultiplierBps",
        base_multiplier_bps AS "baseMultiplierBps",
        optimistic_multiplier_bps AS "optimisticMultiplierBps",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM properties
      WHERE chain_id = :chainId
        AND archived_at IS NULL
      ORDER BY created_at DESC, property_id DESC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          limitPlus,
        },
      }
    );

    const items = rows;
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const feeInfo = await getCrowdfundFeeInfo(item.crowdfundAddress);
        return { ...item, ...feeInfo };
      })
    );
    const nextCursor = null;

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
        best_for AS "bestFor",
        image_url AS "imageUrl",
        COALESCE(
          (
            SELECT json_agg(pi.image_url ORDER BY pi.sort_order ASC, pi.created_at ASC)
            FROM property_images pi
            WHERE pi.property_id = properties.id
          ),
          '[]'::json
        ) AS "imageUrls",
        youtube_embed_url AS "youtubeEmbedUrl",
        latitude::double precision AS "latitude",
        longitude::double precision AS "longitude",
        LOWER(crowdfund_contract_address) AS "crowdfundAddress",
        LOWER(equity_token_address) AS "equityTokenAddress",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        estimated_sell_usdc_base_units::text AS "estimatedSellUsdcBaseUnits",
        conservative_sell_usdc_base_units::text AS "conservativeSellUsdcBaseUnits",
        base_sell_usdc_base_units::text AS "baseSellUsdcBaseUnits",
        optimistic_sell_usdc_base_units::text AS "optimisticSellUsdcBaseUnits",
        conservative_multiplier_bps AS "conservativeMultiplierBps",
        base_multiplier_bps AS "baseMultiplierBps",
        optimistic_multiplier_bps AS "optimisticMultiplierBps",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM properties
      WHERE chain_id = :chainId
        AND property_id = :propertyId
        AND archived_at IS NULL
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
      return sendError(res, 404, 'Property not found', 'not_found');
    }

    const feeInfo = await getCrowdfundFeeInfo(property.crowdfundAddress);
    return res.json({ property: { ...property, ...feeInfo } });
  } catch (error) {
    return handleError(res, error);
  }
};

const parseOptionalText = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = value.toString().trim();
  if (!text) {
    throw new ValidationError(`${field} cannot be empty`);
  }
  return text;
};

const parseOptionalUrl = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const raw = value.toString().trim();
  if (!raw) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`Invalid ${field}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError(`Invalid ${field}`);
  }
  return parsed.toString();
};

const parseOptionalBaseUnits = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const asString = value.toString();
  if (!/^[0-9]+$/.test(asString)) {
    throw new ValidationError(`Invalid ${field}`);
  }
  if (BigInt(asString) <= 0n) {
    throw new ValidationError(`${field} must be greater than 0`);
  }
  return asString;
};

const parseOptionalMultiplierBps = (value: unknown, field: string): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100000) {
    throw new ValidationError(`Invalid ${field}. Use an integer between 1 and 100000`);
  }
  return parsed;
};

const parseOptionalBestFor = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (!PROPERTY_BEST_FOR_VALUES.has(normalized)) {
    throw new ValidationError(
      'Invalid bestFor. Use one of: sell, rent, build_and_sell, build_and_rent'
    );
  }
  return normalized;
};

const parseOptionalImageUrls = (value: unknown): string[] | null => {
  if (value === undefined) {
    return null;
  }
  if (value === null || value === '') {
    return [];
  }
  let rawValues: string[];
  if (Array.isArray(value)) {
    rawValues = value.map((entry) => entry?.toString?.() ?? '');
  } else if (typeof value === 'string') {
    rawValues = value.split(/\n|,/g);
  } else {
    throw new ValidationError('Invalid imageUrls. Provide an array of URLs');
  }
  const urls: string[] = [];
  for (const raw of rawValues) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = parseOptionalUrl(trimmed, 'imageUrls');
    if (normalized && !urls.includes(normalized)) {
      urls.push(normalized);
    }
  }
  if (urls.length > 30) {
    throw new ValidationError('imageUrls cannot exceed 30 items');
  }
  return urls;
};

const normalizeYoutubeEmbedUrl = (value: unknown): string | null => {
  const normalizedUrl = parseOptionalUrl(value, 'youtubeEmbedUrl');
  if (!normalizedUrl) {
    return null;
  }
  const parsed = new URL(normalizedUrl);
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = '';
  if (hostname === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  } else if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
    if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v') ?? '';
    } else if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/')[2] ?? '';
    }
  }
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new ValidationError(
      'Invalid youtubeEmbedUrl. Use a valid YouTube watch/share/embed URL'
    );
  }
  return `https://www.youtube.com/embed/${videoId}`;
};

const parseOptionalCoordinate = (
  value: unknown,
  field: 'latitude' | 'longitude'
): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`Invalid ${field}`);
  }
  if (field === 'latitude' && (parsed < -90 || parsed > 90)) {
    throw new ValidationError('latitude must be between -90 and 90');
  }
  if (field === 'longitude' && (parsed < -180 || parsed > 180)) {
    throw new ValidationError('longitude must be between -180 and 180');
  }
  return Number(parsed.toFixed(6));
};

const selectPropertyById = async (propertyId: string): Promise<PropertyRow | null> => {
  const rows: PropertyRow[] = await sequelize.query<PropertyRow>(
    `
    SELECT
      id AS "propertyUuid",
      property_id AS "propertyId",
      name,
      location,
      description,
      best_for AS "bestFor",
      image_url AS "imageUrl",
      COALESCE(
        (
          SELECT json_agg(pi.image_url ORDER BY pi.sort_order ASC, pi.created_at ASC)
          FROM property_images pi
          WHERE pi.property_id = properties.id
        ),
        '[]'::json
      ) AS "imageUrls",
      youtube_embed_url AS "youtubeEmbedUrl",
      latitude::double precision AS "latitude",
      longitude::double precision AS "longitude",
      LOWER(crowdfund_contract_address) AS "crowdfundAddress",
      LOWER(equity_token_address) AS "equityTokenAddress",
      LOWER(profit_distributor_address) AS "profitDistributorAddress",
      target_usdc_base_units::text AS "targetUsdcBaseUnits",
      estimated_sell_usdc_base_units::text AS "estimatedSellUsdcBaseUnits",
      conservative_sell_usdc_base_units::text AS "conservativeSellUsdcBaseUnits",
      base_sell_usdc_base_units::text AS "baseSellUsdcBaseUnits",
      optimistic_sell_usdc_base_units::text AS "optimisticSellUsdcBaseUnits",
      conservative_multiplier_bps AS "conservativeMultiplierBps",
      base_multiplier_bps AS "baseMultiplierBps",
      optimistic_multiplier_bps AS "optimisticMultiplierBps",
      archived_at AS "archivedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM properties
    WHERE chain_id = :chainId
      AND property_id = :propertyId
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
  return rows[0] ?? null;
};

export const listAdminProperties = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const includeArchived = req.query.includeArchived !== 'false';
    const rows: PropertyRow[] = await sequelize.query<PropertyRow>(
      `
      SELECT
        property_id AS "propertyId",
        name,
        location,
        description,
        best_for AS "bestFor",
        image_url AS "imageUrl",
        COALESCE(
          (
            SELECT json_agg(pi.image_url ORDER BY pi.sort_order ASC, pi.created_at ASC)
            FROM property_images pi
            WHERE pi.property_id = properties.id
          ),
          '[]'::json
        ) AS "imageUrls",
        youtube_embed_url AS "youtubeEmbedUrl",
        latitude::double precision AS "latitude",
        longitude::double precision AS "longitude",
        LOWER(crowdfund_contract_address) AS "crowdfundAddress",
        LOWER(equity_token_address) AS "equityTokenAddress",
        LOWER(profit_distributor_address) AS "profitDistributorAddress",
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        estimated_sell_usdc_base_units::text AS "estimatedSellUsdcBaseUnits",
        conservative_sell_usdc_base_units::text AS "conservativeSellUsdcBaseUnits",
        base_sell_usdc_base_units::text AS "baseSellUsdcBaseUnits",
        optimistic_sell_usdc_base_units::text AS "optimisticSellUsdcBaseUnits",
        conservative_multiplier_bps AS "conservativeMultiplierBps",
        base_multiplier_bps AS "baseMultiplierBps",
        optimistic_multiplier_bps AS "optimisticMultiplierBps",
        archived_at AS "archivedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM properties
      WHERE chain_id = :chainId
        ${includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY created_at DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { chainId: BASE_SEPOLIA_CHAIN_ID },
      }
    );
    return res.json({ properties: rows });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateAdminProperty = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = validatePropertyId(req.params.propertyId);
    const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
    const hasLocation = Object.prototype.hasOwnProperty.call(req.body, 'location');
    const hasDescription = Object.prototype.hasOwnProperty.call(req.body, 'description');
    const hasBestFor = Object.prototype.hasOwnProperty.call(req.body, 'bestFor');
    const hasImageUrl = Object.prototype.hasOwnProperty.call(req.body, 'imageUrl');
    const hasImageUrls = Object.prototype.hasOwnProperty.call(req.body, 'imageUrls');
    const hasYoutubeEmbedUrl = Object.prototype.hasOwnProperty.call(req.body, 'youtubeEmbedUrl');
    const hasLatitude = Object.prototype.hasOwnProperty.call(req.body, 'latitude');
    const hasLongitude = Object.prototype.hasOwnProperty.call(req.body, 'longitude');
    const hasEstimatedSellUsdcBaseUnits = Object.prototype.hasOwnProperty.call(
      req.body,
      'estimatedSellUsdcBaseUnits'
    );
    const hasConservativeSellUsdcBaseUnits = Object.prototype.hasOwnProperty.call(
      req.body,
      'conservativeSellUsdcBaseUnits'
    );
    const hasBaseSellUsdcBaseUnits = Object.prototype.hasOwnProperty.call(
      req.body,
      'baseSellUsdcBaseUnits'
    );
    const hasOptimisticSellUsdcBaseUnits = Object.prototype.hasOwnProperty.call(
      req.body,
      'optimisticSellUsdcBaseUnits'
    );
    const hasConservativeMultiplierBps = Object.prototype.hasOwnProperty.call(
      req.body,
      'conservativeMultiplierBps'
    );
    const hasBaseMultiplierBps = Object.prototype.hasOwnProperty.call(req.body, 'baseMultiplierBps');
    const hasOptimisticMultiplierBps = Object.prototype.hasOwnProperty.call(
      req.body,
      'optimisticMultiplierBps'
    );

    if (
      !hasName &&
      !hasLocation &&
      !hasDescription &&
      !hasBestFor &&
      !hasImageUrl &&
      !hasImageUrls &&
      !hasYoutubeEmbedUrl &&
      !hasLatitude &&
      !hasLongitude &&
      !hasEstimatedSellUsdcBaseUnits &&
      !hasConservativeSellUsdcBaseUnits &&
      !hasBaseSellUsdcBaseUnits &&
      !hasOptimisticSellUsdcBaseUnits &&
      !hasConservativeMultiplierBps &&
      !hasBaseMultiplierBps &&
      !hasOptimisticMultiplierBps
    ) {
      throw new ValidationError(
        'Provide at least one field to update: name, location, description, bestFor, imageUrl, imageUrls, youtubeEmbedUrl, latitude, longitude, estimatedSellUsdcBaseUnits, conservative/base/optimistic scenario values'
      );
    }

    const updates: string[] = [];
    const replacements: Record<string, unknown> = {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      propertyId,
    };

    if (hasName) {
      const value = parseOptionalText(req.body.name, 'name');
      if (!value) throw new ValidationError('name is required');
      updates.push('name = :name');
      replacements.name = value;
    }
    if (hasLocation) {
      const value = parseOptionalText(req.body.location, 'location');
      if (!value) throw new ValidationError('location is required');
      updates.push('location = :location');
      replacements.location = value;
    }
    if (hasDescription) {
      const value = parseOptionalText(req.body.description, 'description');
      if (!value) throw new ValidationError('description is required');
      updates.push('description = :description');
      replacements.description = value;
    }
    if (hasBestFor) {
      const value = parseOptionalBestFor(req.body.bestFor);
      updates.push('best_for = :bestFor');
      replacements.bestFor = value;
    }
    if (hasImageUrl) {
      const value = parseOptionalUrl(req.body.imageUrl, 'imageUrl');
      updates.push('image_url = :imageUrl');
      replacements.imageUrl = value;
    }
    const imageUrls = hasImageUrls ? parseOptionalImageUrls(req.body.imageUrls) : null;
    if (hasYoutubeEmbedUrl) {
      const value = normalizeYoutubeEmbedUrl(req.body.youtubeEmbedUrl);
      updates.push('youtube_embed_url = :youtubeEmbedUrl');
      replacements.youtubeEmbedUrl = value;
    }
    if (hasLatitude) {
      const value = parseOptionalCoordinate(req.body.latitude, 'latitude');
      updates.push('latitude = :latitude');
      replacements.latitude = value;
    }
    if (hasLongitude) {
      const value = parseOptionalCoordinate(req.body.longitude, 'longitude');
      updates.push('longitude = :longitude');
      replacements.longitude = value;
    }
    if (hasEstimatedSellUsdcBaseUnits) {
      const value = parseOptionalBaseUnits(
        req.body.estimatedSellUsdcBaseUnits,
        'estimatedSellUsdcBaseUnits'
      );
      updates.push('estimated_sell_usdc_base_units = :estimatedSellUsdcBaseUnits');
      replacements.estimatedSellUsdcBaseUnits = value;
    }
    if (hasConservativeSellUsdcBaseUnits) {
      const value = parseOptionalBaseUnits(
        req.body.conservativeSellUsdcBaseUnits,
        'conservativeSellUsdcBaseUnits'
      );
      updates.push('conservative_sell_usdc_base_units = :conservativeSellUsdcBaseUnits');
      replacements.conservativeSellUsdcBaseUnits = value;
    }
    if (hasBaseSellUsdcBaseUnits) {
      const value = parseOptionalBaseUnits(req.body.baseSellUsdcBaseUnits, 'baseSellUsdcBaseUnits');
      updates.push('base_sell_usdc_base_units = :baseSellUsdcBaseUnits');
      replacements.baseSellUsdcBaseUnits = value;
    }
    if (hasOptimisticSellUsdcBaseUnits) {
      const value = parseOptionalBaseUnits(
        req.body.optimisticSellUsdcBaseUnits,
        'optimisticSellUsdcBaseUnits'
      );
      updates.push('optimistic_sell_usdc_base_units = :optimisticSellUsdcBaseUnits');
      replacements.optimisticSellUsdcBaseUnits = value;
    }
    if (hasConservativeMultiplierBps) {
      const value = parseOptionalMultiplierBps(
        req.body.conservativeMultiplierBps,
        'conservativeMultiplierBps'
      );
      updates.push('conservative_multiplier_bps = :conservativeMultiplierBps');
      replacements.conservativeMultiplierBps = value;
    }
    if (hasBaseMultiplierBps) {
      const value = parseOptionalMultiplierBps(req.body.baseMultiplierBps, 'baseMultiplierBps');
      updates.push('base_multiplier_bps = :baseMultiplierBps');
      replacements.baseMultiplierBps = value;
    }
    if (hasOptimisticMultiplierBps) {
      const value = parseOptionalMultiplierBps(
        req.body.optimisticMultiplierBps,
        'optimisticMultiplierBps'
      );
      updates.push('optimistic_multiplier_bps = :optimisticMultiplierBps');
      replacements.optimisticMultiplierBps = value;
    }

    await sequelize.transaction(async (tx) => {
      if (updates.length > 0) {
        await sequelize.query(
          `
          UPDATE properties
          SET ${updates.join(', ')},
              updated_at = NOW()
          WHERE chain_id = :chainId
            AND property_id = :propertyId
          `,
          { replacements, transaction: tx }
        );
      }

      if (imageUrls !== null) {
        const property = await selectPropertyById(propertyId);
        const propertyUuid = property?.propertyUuid;
        if (!propertyUuid) {
          return;
        }
        await sequelize.query(
          `
          DELETE FROM property_images
          WHERE property_id = :propertyUuid
          `,
          {
            replacements: { propertyUuid },
            transaction: tx,
          }
        );
        for (let index = 0; index < imageUrls.length; index += 1) {
          const imageUrl = imageUrls[index];
          await sequelize.query(
            `
            INSERT INTO property_images (
              id,
              property_id,
              image_url,
              sort_order,
              created_at
            )
            VALUES (
              :id,
              :propertyUuid,
              :imageUrl,
              :sortOrder,
              NOW()
            )
            `,
            {
              replacements: {
                id: randomUUID(),
                propertyUuid,
                imageUrl,
                sortOrder: index,
              },
              transaction: tx,
            }
          );
        }
      }
    });

    const property = await selectPropertyById(propertyId);
    if (!property) {
      return sendError(res, 404, 'Property not found', 'not_found');
    }
    return res.json({ property });
  } catch (error) {
    return handleError(res, error);
  }
};

export const archiveAdminProperty = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = validatePropertyId(req.params.propertyId);
    await sequelize.query(
      `
      UPDATE properties
      SET archived_at = NOW(),
          updated_at = NOW()
      WHERE chain_id = :chainId
        AND property_id = :propertyId
      `,
      {
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          propertyId,
        },
      }
    );
    const property = await selectPropertyById(propertyId);
    if (!property) {
      return sendError(res, 404, 'Property not found', 'not_found');
    }
    return res.json({ property });
  } catch (error) {
    return handleError(res, error);
  }
};

export const restoreAdminProperty = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = validatePropertyId(req.params.propertyId);
    await sequelize.query(
      `
      UPDATE properties
      SET archived_at = NULL,
          updated_at = NOW()
      WHERE chain_id = :chainId
        AND property_id = :propertyId
      `,
      {
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          propertyId,
        },
      }
    );
    const property = await selectPropertyById(propertyId);
    if (!property) {
      return sendError(res, 404, 'Property not found', 'not_found');
    }
    return res.json({ property });
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
