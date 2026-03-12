import { Request, Response } from 'express';
import { CdpClient } from '@coinbase/cdp-sdk';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { env } from '../../config/env.js';
import { sendError } from '../../lib/apiError.js';
import { BASE_SEPOLIA_CHAIN_ID, ValidationError, normalizeAddress } from '../../validators/v1.js';

type FaucetToken = 'eth' | 'usdc';

type FaucetRequestRow = {
  requestedAt: string;
};

const SUPPORTED_TOKENS: FaucetToken[] = ['eth', 'usdc'];

const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

const parseToken = (value: unknown): FaucetToken => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!SUPPORTED_TOKENS.includes(normalized as FaucetToken)) {
    throw new ValidationError('Unsupported faucet token');
  }
  return normalized as FaucetToken;
};

const buildCooldownMessage = (remainingMs: number, scope: 'wallet' | 'ip') => {
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Faucet ${scope} cooldown active. Retry in about ${remainingMinutes} minute(s).`;
};

const requireCdpClient = (): CdpClient => {
  try {
    return new CdpClient();
  } catch (error) {
    throw new ValidationError('CDP faucet is not configured on the server', 503);
  }
};

const enforceCooldown = async ({
  walletAddress,
  ipAddress,
  token,
}: {
  walletAddress: string;
  ipAddress: string;
  token: FaucetToken;
}) => {
  const now = Date.now();
  const walletRows = await sequelize.query<FaucetRequestRow>(
    `
    SELECT requested_at AS "requestedAt"
    FROM faucet_requests
    WHERE chain_id = :chainId
      AND LOWER(wallet_address) = LOWER(:walletAddress)
      AND token = :token
      AND status = 'confirmed'
    ORDER BY requested_at DESC
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        walletAddress,
        token,
      },
    }
  );

  const ipRows = await sequelize.query<FaucetRequestRow>(
    `
    SELECT requested_at AS "requestedAt"
    FROM faucet_requests
    WHERE chain_id = :chainId
      AND ip_address = :ipAddress
      AND token = :token
      AND status = 'confirmed'
    ORDER BY requested_at DESC
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        ipAddress,
        token,
      },
    }
  );

  const walletRequestedAt = walletRows[0]?.requestedAt ? Date.parse(walletRows[0].requestedAt) : null;
  const ipRequestedAt = ipRows[0]?.requestedAt ? Date.parse(ipRows[0].requestedAt) : null;

  if (walletRequestedAt && Number.isFinite(walletRequestedAt)) {
    const remainingMs = walletRequestedAt + env.faucetWalletCooldownMinutes * 60_000 - now;
    if (remainingMs > 0) {
      throw new ValidationError(buildCooldownMessage(remainingMs, 'wallet'), 429);
    }
  }

  if (ipRequestedAt && Number.isFinite(ipRequestedAt)) {
    const remainingMs = ipRequestedAt + env.faucetIpCooldownMinutes * 60_000 - now;
    if (remainingMs > 0) {
      throw new ValidationError(buildCooldownMessage(remainingMs, 'ip'), 429);
    }
  }
};

const insertRequest = async ({
  walletAddress,
  ipAddress,
  token,
}: {
  walletAddress: string;
  ipAddress: string;
  token: FaucetToken;
}): Promise<string> => {
  const rows = await sequelize.query<{ id: string }>(
    `
    INSERT INTO faucet_requests (
      chain_id,
      wallet_address,
      token,
      ip_address,
      status
    ) VALUES (
      :chainId,
      :walletAddress,
      :token,
      :ipAddress,
      'submitted'
    )
    RETURNING id
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        walletAddress,
        token,
        ipAddress,
      },
    }
  );
  const insertedId = rows[0]?.id;
  if (!insertedId) {
    throw new Error('Failed to create faucet request record');
  }
  return insertedId;
};

const markRequestComplete = async ({
  id,
  status,
  transactionHash,
  providerRequestId,
  errorMessage,
}: {
  id: string;
  status: 'confirmed' | 'failed';
  transactionHash?: string | null;
  providerRequestId?: string | null;
  errorMessage?: string | null;
}) => {
  await sequelize.query(
    `
    UPDATE faucet_requests
    SET status = :status,
        transaction_hash = :transactionHash,
        provider_request_id = :providerRequestId,
        error_message = :errorMessage,
        completed_at = NOW()
    WHERE id = :id
    `,
    {
      replacements: {
        id,
        status,
        transactionHash: transactionHash ?? null,
        providerRequestId: providerRequestId ?? null,
        errorMessage: errorMessage ?? null,
      },
    }
  );
};

const isRetryableCdpError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as {
    errorType?: string;
    networkDetails?: { retryable?: boolean };
    statusCode?: number;
  };
  return (
    maybeError.errorType === 'network_timeout' ||
    maybeError.networkDetails?.retryable === true ||
    maybeError.statusCode === 0
  );
};

const requestFaucetWithRetry = async (
  cdp: CdpClient,
  args: { address: string; network: 'base-sepolia'; token: FaucetToken }
) => {
  try {
    return await cdp.evm.requestFaucet(args);
  } catch (error) {
    if (!isRetryableCdpError(error)) {
      throw error;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
  return cdp.evm.requestFaucet(args);
};

export const requestTestnetFunds = async (req: Request, res: Response) => {
  try {
    if (!env.faucetEnabled) {
      return sendError(res, 503, 'Testnet faucet is currently disabled', 'service_unavailable');
    }

    const walletAddress = normalizeAddress(String(req.body.address || ''), 'address');
    const token = parseToken(req.body.token);
    const ipAddress = getClientIp(req);

    await enforceCooldown({ walletAddress, ipAddress, token });

    const requestId = await insertRequest({ walletAddress, ipAddress, token });
    const cdp = requireCdpClient();

    try {
      const response = await requestFaucetWithRetry(cdp, {
        address: walletAddress,
        network: 'base-sepolia',
        token,
      });

      const transactionHash = String((response as { transactionHash?: string }).transactionHash || '');
      const providerRequestId = String((response as { id?: string }).id || '');

      await markRequestComplete({
        id: requestId,
        status: 'confirmed',
        transactionHash: transactionHash || null,
        providerRequestId: providerRequestId || null,
      });

      return res.status(201).json({
        ok: true,
        token,
        address: walletAddress,
        transactionHash: transactionHash || null,
        providerRequestId: providerRequestId || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Faucet request failed';
      await markRequestComplete({
        id: requestId,
        status: 'failed',
        errorMessage: message,
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return sendError(res, error.status, error.message, 'validation_error');
    }
    if (isRetryableCdpError(error)) {
      return sendError(
        res,
        503,
        'Faucet provider timed out. Please retry in a moment.',
        'service_unavailable'
      );
    }
    console.error('[faucet.request] unexpected-error', error);
    return sendError(res, 500, 'Internal server error', 'internal_error');
  }
};
