import { Request, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Contract, Interface, JsonRpcProvider, MaxUint256, Wallet } from 'ethers';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { env } from '../../config/env.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { sendError } from '../../lib/apiError.js';
import { upsertOnchainActivity } from '../../lib/onchainActivity.js';
import { getCrowdfundFeeInfo } from './crowdfundFee.js';
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

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendPackageRoot = resolve(__dirname, '../../../');
const PROCESSING_RUN_TIMEOUT_MS = 4 * 60 * 1000;
const noWorkerModeEnabled = process.env.NO_WORKER_MODE === 'true';

let processingRunInFlight = false;

const getWorkersHealthyValue = (staleSubmittedIntents: number): boolean =>
  noWorkerModeEnabled ? true : staleSubmittedIntents === 0;

type ProcessingStepKey =
  | 'propertyIntents'
  | 'campaignLifecycle'
  | 'platformFeeIntents'
  | 'profitIntents'
  | 'indexerSync';

type ProcessingStepResult = {
  key: ProcessingStepKey;
  label: string;
  status: 'ok' | 'failed';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
};

type ProcessingRunRecord = {
  id: string;
  triggerSource: 'manual' | 'cron';
  processingMode: 'manual_no_worker' | 'hybrid';
  status: 'ok' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: ProcessingStepResult[];
  createdAt: string;
};

const processingSteps: Array<{ key: ProcessingStepKey; label: string; script: string }> = [
  {
    key: 'propertyIntents',
    label: 'Property Intents',
    script: 'scripts/process-property-intents.mjs',
  },
  {
    key: 'campaignLifecycle',
    label: 'Campaign Lifecycle',
    script: 'scripts/process-campaign-lifecycle.mjs',
  },
  {
    key: 'platformFeeIntents',
    label: 'Platform Fee Intents',
    script: 'scripts/process-platform-fee-intents.mjs',
  },
  {
    key: 'profitIntents',
    label: 'Profit Intents',
    script: 'scripts/process-profit-intents.mjs',
  },
  {
    key: 'indexerSync',
    label: 'Indexer Sync',
    script: 'scripts/process-indexer-sync.mjs',
  },
];

const parseOptionalBoolean = (value: unknown, field: string): boolean | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new ValidationError(`Invalid ${field}. Use true or false`);
};

const getCronTokenFromRequest = (req: Request): string => {
  const fromHeader =
    req.header('x-cron-token') ||
    req.header('x-processing-token') ||
    req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const fromQuery = req.query.token?.toString();
  const fromBody = req.body?.token?.toString?.();
  return (fromHeader || fromQuery || fromBody || '').trim();
};

const ensureCronTokenAuthorized = (req: Request): void => {
  const configuredToken = (process.env.PROCESSING_CRON_TOKEN || '').trim();
  if (!configuredToken) {
    throw new ValidationError(
      'PROCESSING_CRON_TOKEN is not configured on server',
      503
    );
  }
  const providedToken = getCronTokenFromRequest(req);
  if (!providedToken || providedToken !== configuredToken) {
    throw new ValidationError('Invalid cron token', 401);
  }
};

const insertProcessingRun = async (record: {
  triggerSource: 'manual' | 'cron';
  processingMode: 'manual_no_worker' | 'hybrid';
  status: 'ok' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: ProcessingStepResult[];
}) => {
  await sequelize.query(
    `
    INSERT INTO processing_runs (
      trigger_source,
      processing_mode,
      status,
      started_at,
      finished_at,
      duration_ms,
      steps_json
    ) VALUES (
      :triggerSource,
      :processingMode,
      :status,
      :startedAt,
      :finishedAt,
      :durationMs,
      :steps::jsonb
    )
    `,
    {
      replacements: {
        triggerSource: record.triggerSource,
        processingMode: record.processingMode,
        status: record.status,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        durationMs: Math.max(0, Math.round(record.durationMs)),
        steps: JSON.stringify(record.steps),
      },
    }
  );
};

const runProcessingSteps = async (options: {
  triggerSource: 'manual' | 'cron';
  includePropertyIntents: boolean;
  includeCampaignLifecycle: boolean;
  includePlatformFeeIntents: boolean;
  includeProfitIntents: boolean;
  includeIndexerSync: boolean;
}) => {
  if (processingRunInFlight) {
    throw new ValidationError(
      'A processing run is already in progress. Please wait for it to finish.',
      409
    );
  }

  const stepConfig = new Map<ProcessingStepKey, boolean>([
    ['propertyIntents', options.includePropertyIntents],
    ['campaignLifecycle', options.includeCampaignLifecycle],
    ['platformFeeIntents', options.includePlatformFeeIntents],
    ['profitIntents', options.includeProfitIntents],
    ['indexerSync', options.includeIndexerSync],
  ]);
  const selectedSteps = processingSteps.filter((step) => stepConfig.get(step.key));
  if (selectedSteps.length === 0) {
    throw new ValidationError('At least one processing step must be enabled');
  }

  processingRunInFlight = true;
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  const steps: ProcessingStepResult[] = [];

  try {
    for (const step of selectedSteps) {
      const scriptPath = resolve(backendPackageRoot, step.script);
      try {
        const { stdout, stderr } = await execFileAsync('node', [scriptPath], {
          cwd: backendPackageRoot,
          env: process.env,
          timeout: PROCESSING_RUN_TIMEOUT_MS,
          maxBuffer: 2 * 1024 * 1024,
        });
        steps.push({
          key: step.key,
          label: step.label,
          status: 'ok',
          exitCode: 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          error: null,
        });
      } catch (error) {
        const typedError = error as {
          code?: number | string;
          message?: string;
          stdout?: string;
          stderr?: string;
        };
        steps.push({
          key: step.key,
          label: step.label,
          status: 'failed',
          exitCode: typeof typedError.code === 'number' ? typedError.code : null,
          stdout: typedError.stdout ?? '',
          stderr: typedError.stderr ?? '',
          error: typedError.message ?? 'Processing step failed',
        });
        break;
      }
    }
  } finally {
    processingRunInFlight = false;
  }

  const finishedAtIso = new Date().toISOString();
  const hasFailure = steps.some((step) => step.status === 'failed');
  const processingMode = noWorkerModeEnabled ? 'manual_no_worker' : 'hybrid';
  const payload = {
    processingMode,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    durationMs: Date.now() - startedAtMs,
    steps,
  } as const;

  await insertProcessingRun({
    triggerSource: options.triggerSource,
    processingMode,
    status: hasFailure ? 'failed' : 'ok',
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt,
    durationMs: payload.durationMs,
    steps,
  });

  return {
    statusCode: hasFailure ? 207 : 200,
    payload,
  };
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

type IntentTableKey = 'property' | 'profit' | 'platformFee';
const PROPERTY_BEST_FOR_VALUES = new Set(['sell', 'rent', 'build_and_sell', 'build_and_rent']);

const parseIntentTable = (value: unknown): IntentTableKey => {
  const normalized = value?.toString().trim().toLowerCase();
  if (normalized === 'property') return 'property';
  if (normalized === 'profit') return 'profit';
  if (normalized === 'platformfee' || normalized === 'platform-fee') return 'platformFee';
  throw new ValidationError('Invalid intent type. Use property, profit, or platformFee');
};

const getIntentTableName = (intentType: IntentTableKey): string => {
  if (intentType === 'property') return 'property_intents';
  if (intentType === 'profit') return 'profit_distribution_intents';
  return 'platform_fee_intents';
};

const recordAdminOnchainActivity = async (input: {
  adminAddress: string;
  chainId: number;
  txHash: string;
  activityType: string;
  campaignAddress?: string | null;
  propertyId?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  await upsertOnchainActivity(sequelize, {
    chainId: input.chainId,
    txHash: input.txHash,
    activityType: input.activityType,
    status: 'confirmed',
    actorRole: 'owner',
    actorAddress: input.adminAddress,
    campaignAddress: input.campaignAddress ?? null,
    propertyId: input.propertyId ?? null,
    metadata: input.metadata ?? null,
  });
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

const parseOptionalBaseUnits = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return parseBaseUnits(value, field);
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

const parseOptionalHttpUrl = (value: unknown, field: string): string | null => {
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
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new ValidationError(`Invalid ${field}`);
  }
  if (raw.length > 2048) {
    throw new ValidationError(`${field} is too long`);
  }
  return parsed.toString();
};

const parseOptionalImageUrls = (value: unknown): string[] => {
  if (value === undefined || value === null || value === '') {
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
    const normalized = parseOptionalHttpUrl(trimmed, 'imageUrls');
    if (normalized && !urls.includes(normalized)) {
      urls.push(normalized);
    }
  }
  if (urls.length > 30) {
    throw new ValidationError('imageUrls cannot exceed 30 items');
  }
  return urls;
};

const normalizeOptionalIdentifier = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const raw = value.toString().trim();
  if (!raw) {
    return null;
  }
  if (!/^[A-Za-z0-9/_-]{1,120}$/.test(raw)) {
    throw new ValidationError('Invalid identifier format');
  }
  return raw;
};

const createCloudinarySignature = (params: Record<string, string>, apiSecret: string): string => {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1')
    .update(`${payload}${apiSecret}`)
    .digest('hex');
};

const normalizeYoutubeEmbedUrl = (value: unknown): string | null => {
  const normalizedUrl = parseOptionalHttpUrl(value, 'youtubeEmbedUrl');
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
    } else if (parsed.pathname.startsWith('/embed/')) {
      videoId = parsed.pathname.split('/')[2] ?? '';
    } else if (parsed.pathname.startsWith('/shorts/')) {
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

const profitReadInterface = new Interface([
  'function owner() view returns (address)',
  'function usdcToken() view returns (address)',
  'function claimable(address user) view returns (uint256)',
]);
const crowdfundReadInterface = new Interface([
  'function owner() view returns (address)',
  'function state() view returns (uint8)',
  'function targetAmountUSDC() view returns (uint256)',
  'function raisedAmountUSDC() view returns (uint256)',
  'function startTime() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function usdcToken() view returns (address)',
  'function equityToken() view returns (address)',
  'function claimableTokens(address investor) view returns (uint256)',
  'function platformFeeBps() view returns (uint16)',
  'function platformFeeRecipient() view returns (address)',
]);
const crowdfundWriteAbi = [
  'function finalizeCampaign()',
  'function withdrawFunds(address to)',
  'function setEquityToken(address equityTokenAddress)',
];

const erc20ReadInterface = new Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);
const erc20WriteAbi = ['function approve(address spender, uint256 amount) returns (bool)'];

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

const getPlatformOperatorAddress = (): string | null => {
  const key =
    process.env.PLATFORM_OPERATOR_PRIVATE_KEY ||
    process.env.PROFIT_OPERATOR_PRIVATE_KEY ||
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

const getOperatorPrivateKey = (): string | null => {
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
    // Validate key format.
    void new Wallet(key);
    return key;
  } catch {
    return null;
  }
};

const getPlatformOperatorPrivateKey = (): string | null => {
  const key =
    process.env.PLATFORM_OPERATOR_PRIVATE_KEY ||
    process.env.PROFIT_OPERATOR_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    '';
  const ZERO_PRIVATE_KEY =
    '0x0000000000000000000000000000000000000000000000000000000000000000';
  if (!key || key === ZERO_PRIVATE_KEY) {
    return null;
  }
  try {
    void new Wallet(key);
    return key;
  } catch {
    return null;
  }
};

const decodeCrowdfundState = (stateIndex: number): 'ACTIVE' | 'SUCCESS' | 'FAILED' | 'WITHDRAWN' => {
  if (stateIndex === 1) return 'SUCCESS';
  if (stateIndex === 2) return 'FAILED';
  if (stateIndex === 3) return 'WITHDRAWN';
  return 'ACTIVE';
};

const getConfiguredRpcUrl = (): string => {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
  if (!rpcUrl) {
    throw new ValidationError('BASE_SEPOLIA_RPC_URL is not configured', 503);
  }
  return rpcUrl;
};

const getIndexerLastBlockSafe = async (chainId: number): Promise<number> => {
  try {
    const stateRows = await sequelize.query<{ last_block: string }>(
      'SELECT last_block::text AS last_block FROM indexer_state WHERE chain_id = :chainId LIMIT 1',
      {
        type: QueryTypes.SELECT,
        replacements: { chainId },
      }
    );
    return stateRows[0] ? Number(stateRows[0].last_block) : 0;
  } catch (error) {
    const code = (error as { original?: { code?: string } })?.original?.code;
    if (code === '42P01') {
      return 0;
    }
    throw error;
  }
};

const resolveCampaignAddressForProperty = async (
  chainId: number,
  propertyId: string
): Promise<string> => {
  const rows = await sequelize.query<{ campaignAddress: string }>(
    `
    SELECT LOWER(contract_address) AS "campaignAddress"
    FROM campaigns c
    JOIN properties p ON p.id = c.property_id
    WHERE c.chain_id = :chainId
      AND p.property_id = :propertyId
    ORDER BY c.updated_at DESC, c.created_at DESC
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { chainId, propertyId },
    }
  );
  const campaignAddress = rows[0]?.campaignAddress;
  if (!campaignAddress) {
    throw new ValidationError(
      `No campaign found for property ${propertyId}. Finalize + withdraw can only run on deployed campaigns.`
    );
  }
  return campaignAddress;
};

const resolveEquityTokenForCampaign = async (
  chainId: number,
  campaignAddress: string
): Promise<string | null> => {
  const rows = await sequelize.query<{ equityTokenAddress: string | null }>(
    `
    SELECT LOWER(p.equity_token_address) AS "equityTokenAddress"
    FROM campaigns c
    JOIN properties p ON p.id = c.property_id
    WHERE c.chain_id = :chainId
      AND LOWER(c.contract_address) = :campaignAddress
    ORDER BY c.updated_at DESC, c.created_at DESC
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { chainId, campaignAddress: campaignAddress.toLowerCase() },
    }
  );
  return rows[0]?.equityTokenAddress ?? null;
};

const assertSettlementIntentEligibility = async (
  provider: JsonRpcProvider,
  campaignAddress: string
): Promise<void> => {
  const normalizedCampaignAddress = normalizeAddress(campaignAddress, 'campaignAddress');
  const [stateRaw, usdcRaw] = await Promise.all([
    provider.call({
      to: normalizedCampaignAddress,
      data: crowdfundReadInterface.encodeFunctionData('state', []),
    }),
    provider.call({
      to: normalizedCampaignAddress,
      data: crowdfundReadInterface.encodeFunctionData('usdcToken', []),
    }),
  ]);
  const [stateIndexRaw] = crowdfundReadInterface.decodeFunctionResult('state', stateRaw);
  const [usdcAddressRaw] = crowdfundReadInterface.decodeFunctionResult('usdcToken', usdcRaw);
  const state = decodeCrowdfundState(Number(stateIndexRaw));
  const normalizedUsdcAddress = String(usdcAddressRaw).toLowerCase();

  const balanceRaw = await provider.call({
    to: normalizedUsdcAddress,
    data: erc20ReadInterface.encodeFunctionData('balanceOf', [normalizedCampaignAddress]),
  });
  const [campaignBalanceRaw] = erc20ReadInterface.decodeFunctionResult('balanceOf', balanceRaw);
  const campaignUsdcBalance = BigInt(campaignBalanceRaw);

  if (state === 'ACTIVE') {
    throw new ValidationError(
      'Settlement intents are blocked: campaign is still ACTIVE. Finalize campaign first.'
    );
  }
  if (state === 'FAILED') {
    throw new ValidationError(
      'Settlement intents are blocked: campaign FAILED and cannot receive settlement distribution.'
    );
  }
  if (state === 'SUCCESS' && campaignUsdcBalance > 0n) {
    throw new ValidationError(
      'Settlement intents are blocked: withdraw campaign funds first before creating fee/profit intents.'
    );
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
    const bestFor = parseOptionalBestFor(req.body.bestFor);
    const imageUrl = parseOptionalHttpUrl(req.body.imageUrl, 'imageUrl');
    const imageUrls = parseOptionalImageUrls(req.body.imageUrls);
    const youtubeEmbedUrl = normalizeYoutubeEmbedUrl(req.body.youtubeEmbedUrl);
    const latitude = parseOptionalCoordinate(req.body.latitude, 'latitude');
    const longitude = parseOptionalCoordinate(req.body.longitude, 'longitude');
    const targetUsdcBaseUnits = parseBaseUnits(req.body.targetUsdcBaseUnits, 'targetUsdcBaseUnits');
    const estimatedSellUsdcBaseUnits = parseOptionalBaseUnits(
      req.body.estimatedSellUsdcBaseUnits,
      'estimatedSellUsdcBaseUnits'
    );
    const conservativeSellUsdcBaseUnits = parseOptionalBaseUnits(
      req.body.conservativeSellUsdcBaseUnits,
      'conservativeSellUsdcBaseUnits'
    );
    const baseSellUsdcBaseUnits = parseOptionalBaseUnits(
      req.body.baseSellUsdcBaseUnits,
      'baseSellUsdcBaseUnits'
    );
    const optimisticSellUsdcBaseUnits = parseOptionalBaseUnits(
      req.body.optimisticSellUsdcBaseUnits,
      'optimisticSellUsdcBaseUnits'
    );
    const conservativeMultiplierBps = parseOptionalMultiplierBps(
      req.body.conservativeMultiplierBps,
      'conservativeMultiplierBps'
    );
    const baseMultiplierBps = parseOptionalMultiplierBps(
      req.body.baseMultiplierBps,
      'baseMultiplierBps'
    );
    const optimisticMultiplierBps = parseOptionalMultiplierBps(
      req.body.optimisticMultiplierBps,
      'optimisticMultiplierBps'
    );
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
    const mergedGallery = imageUrl && !imageUrls.includes(imageUrl) ? [imageUrl, ...imageUrls] : imageUrls;

    const [rows] = await sequelize.query(
      `
      INSERT INTO property_intents (
        id,
        chain_id,
        property_id,
        name,
        location,
        description,
        best_for,
        image_url,
        gallery_image_urls,
        youtube_embed_url,
        latitude,
        longitude,
        target_usdc_base_units,
        estimated_sell_usdc_base_units,
        conservative_sell_usdc_base_units,
        base_sell_usdc_base_units,
        optimistic_sell_usdc_base_units,
        conservative_multiplier_bps,
        base_multiplier_bps,
        optimistic_multiplier_bps,
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
        :bestFor,
        :imageUrl,
        :galleryImageUrls,
        :youtubeEmbedUrl,
        :latitude,
        :longitude,
        :targetUsdcBaseUnits,
        :estimatedSellUsdcBaseUnits,
        :conservativeSellUsdcBaseUnits,
        :baseSellUsdcBaseUnits,
        :optimisticSellUsdcBaseUnits,
        :conservativeMultiplierBps,
        :baseMultiplierBps,
        :optimisticMultiplierBps,
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
        best_for AS "bestFor",
        image_url AS "imageUrl",
        gallery_image_urls AS "imageUrls",
        youtube_embed_url AS "youtubeEmbedUrl",
        latitude::double precision AS "latitude",
        longitude::double precision AS "longitude",
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        estimated_sell_usdc_base_units::text AS "estimatedSellUsdcBaseUnits",
        conservative_sell_usdc_base_units::text AS "conservativeSellUsdcBaseUnits",
        base_sell_usdc_base_units::text AS "baseSellUsdcBaseUnits",
        optimistic_sell_usdc_base_units::text AS "optimisticSellUsdcBaseUnits",
        conservative_multiplier_bps AS "conservativeMultiplierBps",
        base_multiplier_bps AS "baseMultiplierBps",
        optimistic_multiplier_bps AS "optimisticMultiplierBps",
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
          bestFor,
          imageUrl,
          galleryImageUrls: JSON.stringify(mergedGallery),
          youtubeEmbedUrl,
          latitude,
          longitude,
          targetUsdcBaseUnits,
          estimatedSellUsdcBaseUnits,
          conservativeSellUsdcBaseUnits,
          baseSellUsdcBaseUnits,
          optimisticSellUsdcBaseUnits,
          conservativeMultiplierBps,
          baseMultiplierBps,
          optimisticMultiplierBps,
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

    const rpcUrl = getConfiguredRpcUrl();
    const provider = new JsonRpcProvider(rpcUrl);
    const linkedCampaignAddress = await resolveCampaignAddressForProperty(chainId, propertyId);
    await assertSettlementIntentEligibility(provider, linkedCampaignAddress);

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
    const usdcAmountBaseUnits =
      req.body.usdcAmountBaseUnits === undefined || req.body.usdcAmountBaseUnits === null
        ? null
        : parseBaseUnits(req.body.usdcAmountBaseUnits, 'usdcAmountBaseUnits');
    if (usdcAmountBaseUnits !== null && usdcAmountBaseUnits !== '0' && !platformFeeRecipient) {
      throw new ValidationError(
        'platformFeeRecipient is required when usdcAmountBaseUnits is greater than 0'
      );
    }

    const rpcUrl = getConfiguredRpcUrl();
    const provider = new JsonRpcProvider(rpcUrl);
    await assertSettlementIntentEligibility(provider, campaignAddress);

    const [rows] = await sequelize.query(
      `
      INSERT INTO platform_fee_intents (
        id,
        chain_id,
        campaign_address,
        platform_fee_bps,
        platform_fee_recipient,
        usdc_amount_base_units,
        created_by_address
      )
      VALUES (
        :id,
        :chainId,
        :campaignAddress,
        :platformFeeBps,
        :platformFeeRecipient,
        :usdcAmountBaseUnits,
        :createdByAddress
      )
      RETURNING
        LOWER(campaign_address) AS "campaignAddress",
        platform_fee_bps AS "platformFeeBps",
        LOWER(platform_fee_recipient) AS "platformFeeRecipient",
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
          campaignAddress,
          platformFeeBps,
          platformFeeRecipient,
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

export const createCloudinaryUploadSignature = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);

    if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
      return sendError(
        res,
        400,
        'Cloudinary is not configured on backend. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET',
        'bad_request'
      );
    }

    const folder = normalizeOptionalIdentifier(req.body.folder) ?? 'homeshare/properties';
    const publicId = normalizeOptionalIdentifier(req.body.publicId);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const paramsToSign: Record<string, string> = {
      folder,
      timestamp,
    };
    if (publicId) {
      paramsToSign.public_id = publicId;
    }

    const signature = createCloudinarySignature(paramsToSign, env.cloudinaryApiSecret);
    const uploadUrl = `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`;

    return res.json({
      cloudName: env.cloudinaryCloudName,
      apiKey: env.cloudinaryApiKey,
      timestamp,
      signature,
      folder,
      publicId,
      uploadUrl,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createIntentBatch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId ?? BASE_SEPOLIA_CHAIN_ID);
    const includeProfitIntent =
      req.body.includeProfitIntent === undefined ? true : Boolean(req.body.includeProfitIntent);
    const includePlatformFeeIntent =
      req.body.includePlatformFeeIntent === undefined
        ? true
        : Boolean(req.body.includePlatformFeeIntent);

    if (!includeProfitIntent && !includePlatformFeeIntent) {
      throw new ValidationError(
        'At least one of includeProfitIntent or includePlatformFeeIntent must be true'
      );
    }

    const profitPayload = includeProfitIntent
      ? {
          propertyId: validatePropertyId(req.body.propertyId),
          profitDistributorAddress: normalizeAddress(
            req.body.profitDistributorAddress?.toString(),
            'profitDistributorAddress'
          ),
          usdcAmountBaseUnits: parseBaseUnits(req.body.usdcAmountBaseUnits, 'usdcAmountBaseUnits'),
        }
      : null;

    const platformPayload = includePlatformFeeIntent
      ? (() => {
          const platformFeeBps = parseFeeBps(req.body.platformFeeBps, 'platformFeeBps');
          const recipientRaw = req.body.platformFeeRecipient ?? req.body.feeRecipient;
          const platformFeeRecipient =
            platformFeeBps === 0
              ? null
              : normalizeAddress(recipientRaw?.toString(), 'platformFeeRecipient');
          const usdcAmountBaseUnits =
            req.body.platformFeeUsdcAmountBaseUnits === undefined ||
            req.body.platformFeeUsdcAmountBaseUnits === null
              ? null
              : parseBaseUnits(
                  req.body.platformFeeUsdcAmountBaseUnits,
                  'platformFeeUsdcAmountBaseUnits'
                );
          if (usdcAmountBaseUnits !== null && usdcAmountBaseUnits !== '0' && !platformFeeRecipient) {
            throw new ValidationError(
              'platformFeeRecipient is required when usdcAmountBaseUnits is greater than 0'
            );
          }
          return {
            campaignAddress: normalizeAddress(
              req.body.campaignAddress?.toString(),
              'campaignAddress'
            ),
            platformFeeBps,
            platformFeeRecipient,
            usdcAmountBaseUnits,
          };
        })()
      : null;

    const rpcUrl = getConfiguredRpcUrl();
    const provider = new JsonRpcProvider(rpcUrl);
    const eligibilityCheckedCampaigns = new Set<string>();
    const checkCampaignEligibility = async (campaignAddress: string) => {
      const normalized = campaignAddress.toLowerCase();
      if (eligibilityCheckedCampaigns.has(normalized)) {
        return;
      }
      await assertSettlementIntentEligibility(provider, normalized);
      eligibilityCheckedCampaigns.add(normalized);
    };

    let profitCampaignAddress: string | null = null;
    if (profitPayload) {
      profitCampaignAddress = await resolveCampaignAddressForProperty(chainId, profitPayload.propertyId);
      await checkCampaignEligibility(profitCampaignAddress);
    }
    if (platformPayload) {
      await checkCampaignEligibility(platformPayload.campaignAddress);
      if (
        profitCampaignAddress &&
        platformPayload.campaignAddress.toLowerCase() !== profitCampaignAddress.toLowerCase()
      ) {
        throw new ValidationError(
          `Profit property campaign (${profitCampaignAddress}) does not match selected platform-fee campaign (${platformPayload.campaignAddress})`
        );
      }
    }

    const result = await sequelize.transaction(async (tx) => {
      let profitIntent: Record<string, unknown> | null = null;
      let platformFeeIntent: Record<string, unknown> | null = null;

      if (profitPayload) {
        const [profitRows] = await sequelize.query(
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
          `,
          {
            replacements: {
              id: randomUUID(),
              chainId,
              propertyId: profitPayload.propertyId,
              profitDistributorAddress: profitPayload.profitDistributorAddress,
              usdcAmountBaseUnits: profitPayload.usdcAmountBaseUnits,
              createdByAddress: adminAddress,
            },
            transaction: tx,
          }
        );
        profitIntent = Array.isArray(profitRows) ? (profitRows[0] as Record<string, unknown>) : null;
      }

      if (platformPayload) {
        const [platformRows] = await sequelize.query(
          `
          INSERT INTO platform_fee_intents (
            id,
            chain_id,
            campaign_address,
            platform_fee_bps,
            platform_fee_recipient,
            usdc_amount_base_units,
            created_by_address
          )
          VALUES (
            :id,
            :chainId,
            :campaignAddress,
            :platformFeeBps,
            :platformFeeRecipient,
            :usdcAmountBaseUnits,
            :createdByAddress
          )
          RETURNING
            id,
            chain_id AS "chainId",
            LOWER(campaign_address) AS "campaignAddress",
            platform_fee_bps AS "platformFeeBps",
            LOWER(platform_fee_recipient) AS "platformFeeRecipient",
            usdc_amount_base_units::text AS "usdcAmountBaseUnits",
            status,
            tx_hash AS "txHash",
            error_message AS "errorMessage",
            attempt_count AS "attemptCount",
            submitted_at AS "submittedAt",
            confirmed_at AS "confirmedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          `,
          {
            replacements: {
              id: randomUUID(),
              chainId,
              campaignAddress: platformPayload.campaignAddress,
              platformFeeBps: platformPayload.platformFeeBps,
              platformFeeRecipient: platformPayload.platformFeeRecipient,
              usdcAmountBaseUnits: platformPayload.usdcAmountBaseUnits,
              createdByAddress: adminAddress,
            },
            transaction: tx,
          }
        );
        platformFeeIntent = Array.isArray(platformRows)
          ? (platformRows[0] as Record<string, unknown>)
          : null;
      }

      return { profitIntent, platformFeeIntent };
    });

    return res.status(201).json(result);
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
        best_for AS "bestFor",
        image_url AS "imageUrl",
        gallery_image_urls AS "imageUrls",
        youtube_embed_url AS "youtubeEmbedUrl",
        latitude::double precision AS "latitude",
        longitude::double precision AS "longitude",
        target_usdc_base_units::text AS "targetUsdcBaseUnits",
        estimated_sell_usdc_base_units::text AS "estimatedSellUsdcBaseUnits",
        conservative_sell_usdc_base_units::text AS "conservativeSellUsdcBaseUnits",
        base_sell_usdc_base_units::text AS "baseSellUsdcBaseUnits",
        optimistic_sell_usdc_base_units::text AS "optimisticSellUsdcBaseUnits",
        conservative_multiplier_bps AS "conservativeMultiplierBps",
        base_multiplier_bps AS "baseMultiplierBps",
        optimistic_multiplier_bps AS "optimisticMultiplierBps",
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
        usdc_amount_base_units::text AS "usdcAmountBaseUnits",
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

export const listAdminOnchainActivities = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const limit = parseLimit(req.query.limit);
    const rows = await sequelize.query(
      `
      SELECT
        tx_hash AS "txHash",
        activity_type AS "activityType",
        status,
        actor_role AS "actorRole",
        LOWER(actor_address) AS "actorAddress",
        property_id AS "propertyId",
        LOWER(campaign_address) AS "campaignAddress",
        intent_type AS "intentType",
        intent_id AS "intentId",
        block_number::text AS "blockNumber",
        log_index AS "logIndex",
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        indexed_at AS "indexedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_error AS "lastError",
        metadata_json AS "metadata"
      FROM onchain_activities
      ORDER BY created_at DESC
      LIMIT :limit
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { limit },
      }
    );

    return res.json({ activities: rows });
  } catch (error) {
    return handleError(res, error);
  }
};

export const retryAdminIntent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const intentType = parseIntentTable(req.params.intentType);
    const intentId = req.params.intentId?.toString().trim();
    if (!intentId) {
      throw new ValidationError('Missing intentId');
    }
    const table = getIntentTableName(intentType);

    const [rows] = await sequelize.query(
      `
      UPDATE ${table}
      SET status = 'pending',
          tx_hash = NULL,
          error_message = NULL,
          submitted_at = NULL,
          confirmed_at = NULL,
          attempt_count = 0,
          updated_at = NOW()
      WHERE id = :id
        AND created_by_address = :createdByAddress
        AND status = 'failed'
      RETURNING
        id,
        status,
        attempt_count AS "attemptCount",
        updated_at AS "updatedAt"
      `,
      {
        replacements: {
          id: intentId,
          createdByAddress: adminAddress,
        },
      }
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return sendError(res, 404, 'Failed intent not found for this owner', 'not_found');
    }

    return res.json({ intentType, intent: rows[0] });
  } catch (error) {
    return handleError(res, error);
  }
};

export const resetAdminIntent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const intentType = parseIntentTable(req.params.intentType);
    const intentId = req.params.intentId?.toString().trim();
    if (!intentId) {
      throw new ValidationError('Missing intentId');
    }
    const table = getIntentTableName(intentType);

    const [rows] = await sequelize.query(
      `
      UPDATE ${table}
      SET status = 'pending',
          tx_hash = NULL,
          error_message = NULL,
          submitted_at = NULL,
          confirmed_at = NULL,
          attempt_count = 0,
          updated_at = NOW()
      WHERE id = :id
        AND created_by_address = :createdByAddress
        AND status <> 'confirmed'
      RETURNING
        id,
        status,
        attempt_count AS "attemptCount",
        updated_at AS "updatedAt"
      `,
      {
        replacements: {
          id: intentId,
          createdByAddress: adminAddress,
        },
      }
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return sendError(res, 404, 'Non-confirmed intent not found for this owner', 'not_found');
    }

    return res.json({ intentType, intent: rows[0] });
  } catch (error) {
    return handleError(res, error);
  }
};

export const runAdminProcessingNow = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const includePropertyIntents =
      parseOptionalBoolean(req.body?.propertyIntents, 'propertyIntents') ?? true;
    const includeCampaignLifecycle =
      parseOptionalBoolean(req.body?.campaignLifecycle, 'campaignLifecycle') ?? true;
    const includePlatformFeeIntents =
      parseOptionalBoolean(req.body?.platformFeeIntents, 'platformFeeIntents') ?? true;
    const includeProfitIntents =
      parseOptionalBoolean(req.body?.profitIntents, 'profitIntents') ?? true;
    const includeIndexerSync = parseOptionalBoolean(req.body?.indexerSync, 'indexerSync') ?? true;
    const result = await runProcessingSteps({
      triggerSource: 'manual',
      includePropertyIntents,
      includeCampaignLifecycle,
      includePlatformFeeIntents,
      includeProfitIntents,
      includeIndexerSync,
    });
    return res.status(result.statusCode).json(result.payload);
  } catch (error) {
    return handleError(res, error);
  }
};

export const runCronProcessing = async (req: Request, res: Response) => {
  try {
    ensureCronTokenAuthorized(req);
    const includePropertyIntents =
      parseOptionalBoolean(req.body?.propertyIntents ?? req.query.propertyIntents, 'propertyIntents') ??
      true;
    const includeCampaignLifecycle =
      parseOptionalBoolean(
        req.body?.campaignLifecycle ?? req.query.campaignLifecycle,
        'campaignLifecycle'
      ) ?? true;
    const includePlatformFeeIntents =
      parseOptionalBoolean(
        req.body?.platformFeeIntents ?? req.query.platformFeeIntents,
        'platformFeeIntents'
      ) ?? true;
    const includeProfitIntents =
      parseOptionalBoolean(req.body?.profitIntents ?? req.query.profitIntents, 'profitIntents') ??
      true;
    const includeIndexerSync =
      parseOptionalBoolean(req.body?.indexerSync ?? req.query.indexerSync, 'indexerSync') ?? true;

    const result = await runProcessingSteps({
      triggerSource: 'cron',
      includePropertyIntents,
      includeCampaignLifecycle,
      includePlatformFeeIntents,
      includeProfitIntents,
      includeIndexerSync,
    });
    return res.status(result.statusCode).json({
      trigger: 'cron',
      ...result.payload,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getLastProcessingRun = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const rows = await sequelize.query<ProcessingRunRecord>(
      `
      SELECT
        id,
        trigger_source AS "triggerSource",
        processing_mode AS "processingMode",
        status,
        started_at AS "startedAt",
        finished_at AS "finishedAt",
        duration_ms AS "durationMs",
        steps_json AS "steps",
        created_at AS "createdAt"
      FROM processing_runs
      ORDER BY created_at DESC
      LIMIT 1
      `,
      { type: QueryTypes.SELECT }
    );
    return res.json({ run: rows[0] ?? null });
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
    const operatorAddress = getPlatformOperatorAddress();

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

    const indexerLastBlock = await getIndexerLastBlockSafe(BASE_SEPOLIA_CHAIN_ID);

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
        workersHealthy: getWorkersHealthyValue(staleSubmittedIntents),
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

export const approveProfitAllowance = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId ?? BASE_SEPOLIA_CHAIN_ID);
    const propertyId = validatePropertyId(req.body.propertyId?.toString() || '');
    const modeRaw = req.body.mode?.toString().toLowerCase();
    const mode: 'exact' | 'max' = modeRaw === 'exact' ? 'exact' : 'max';
    const requiredBaseUnits = parseBaseUnits(
      req.body.usdcAmountBaseUnits ?? '0',
      'usdcAmountBaseUnits'
    );

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
        replacements: { chainId, propertyId },
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
    const operatorPrivateKey = getOperatorPrivateKey();
    if (!operatorPrivateKey) {
      return sendError(res, 503, 'Operator wallet is not configured', 'service_unavailable');
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(operatorPrivateKey, provider);
    const operatorAddress = signer.address.toLowerCase();

    const ownerData = profitReadInterface.encodeFunctionData('owner', []);
    const ownerRaw = await provider.call({ to: property.profitDistributorAddress, data: ownerData });
    const [distributorOwner] = profitReadInterface.decodeFunctionResult('owner', ownerRaw);
    const normalizedDistributorOwner = String(distributorOwner).toLowerCase();
    if (normalizedDistributorOwner !== operatorAddress) {
      return sendError(
        res,
        409,
        'Operator wallet does not own this profit distributor',
        'bad_request'
      );
    }

    const usdcData = profitReadInterface.encodeFunctionData('usdcToken', []);
    const usdcRaw = await provider.call({ to: property.profitDistributorAddress, data: usdcData });
    const [usdcTokenAddress] = profitReadInterface.decodeFunctionResult('usdcToken', usdcRaw);
    const normalizedUsdcTokenAddress = String(usdcTokenAddress).toLowerCase();

    const allowanceData = erc20ReadInterface.encodeFunctionData('allowance', [
      operatorAddress,
      property.profitDistributorAddress,
    ]);
    const allowanceBeforeRaw = await provider.call({
      to: normalizedUsdcTokenAddress,
      data: allowanceData,
    });
    const [allowanceBefore] = erc20ReadInterface.decodeFunctionResult(
      'allowance',
      allowanceBeforeRaw
    );

    const required = BigInt(requiredBaseUnits);
    const approveAmount = mode === 'exact' ? required : MaxUint256;
    let approveTxHash: string | null = null;
    let resetTxHash: string | null = null;
    let usedResetFlow = false;

    if (required === 0n || allowanceBefore < required) {
      const usdc = new Contract(normalizedUsdcTokenAddress, erc20WriteAbi, signer);
      try {
        const approveTx = await usdc.approve(property.profitDistributorAddress, approveAmount);
        const receipt = await approveTx.wait();
        approveTxHash = approveTx.hash;
        if (!receipt || receipt.status !== 1) {
          throw new Error('approve transaction failed');
        }
      } catch (_approveError) {
        usedResetFlow = true;
        const resetTx = await usdc.approve(property.profitDistributorAddress, 0n);
        const resetReceipt = await resetTx.wait();
        resetTxHash = resetTx.hash;
        if (!resetReceipt || resetReceipt.status !== 1) {
          throw new Error('allowance reset transaction failed');
        }
        const approveTx = await usdc.approve(property.profitDistributorAddress, approveAmount);
        const approveReceipt = await approveTx.wait();
        approveTxHash = approveTx.hash;
        if (!approveReceipt || approveReceipt.status !== 1) {
          throw new Error('approve transaction failed after reset');
        }
      }
    }

    const allowanceAfterRaw = await provider.call({
      to: normalizedUsdcTokenAddress,
      data: allowanceData,
    });
    const [allowanceAfter] = erc20ReadInterface.decodeFunctionResult(
      'allowance',
      allowanceAfterRaw
    );

    return res.json({
      propertyId,
      chainId,
      profitDistributorAddress: property.profitDistributorAddress,
      usdcTokenAddress: normalizedUsdcTokenAddress,
      operatorAddress,
      mode,
      requiredUsdcAmountBaseUnits: required.toString(),
      approvedUsdcAmountBaseUnits: approveAmount.toString(),
      allowanceBeforeBaseUnits: allowanceBefore.toString(),
      allowanceAfterBaseUnits: allowanceAfter.toString(),
      txHash: approveTxHash,
      resetTxHash,
      usedResetFlow,
      checks: {
        ownerMatchesOperator: normalizedDistributorOwner === operatorAddress,
        hasSufficientAllowance: allowanceAfter >= required,
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

export const getPlatformFeePreflight = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const campaignAddressRaw = req.query.campaignAddress?.toString();
    if (!campaignAddressRaw) {
      throw new ValidationError('Missing campaignAddress');
    }
    const campaignAddress = normalizeAddress(campaignAddressRaw, 'campaignAddress');
    const requestedFeeBps = parseFeeBps(req.query.platformFeeBps ?? 0, 'platformFeeBps');
    const recipientRaw = req.query.platformFeeRecipient?.toString();
    const requestedRecipient =
      requestedFeeBps === 0
        ? '0x0000000000000000000000000000000000000000'
        : (() => {
            if (!recipientRaw) {
              throw new ValidationError('Missing platformFeeRecipient');
            }
            return normalizeAddress(recipientRaw, 'platformFeeRecipient');
          })();

    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }
    const provider = new JsonRpcProvider(rpcUrl);
    const operatorAddress = getPlatformOperatorAddress();

    const ownerData = crowdfundReadInterface.encodeFunctionData('owner', []);
    const ownerRaw = await provider.call({ to: campaignAddress, data: ownerData });
    const [contractOwner] = crowdfundReadInterface.decodeFunctionResult('owner', ownerRaw);
    const normalizedContractOwner = String(contractOwner).toLowerCase();

    const feeBpsData = crowdfundReadInterface.encodeFunctionData('platformFeeBps', []);
    const feeBpsRaw = await provider.call({ to: campaignAddress, data: feeBpsData });
    const [currentFeeBpsRaw] = crowdfundReadInterface.decodeFunctionResult(
      'platformFeeBps',
      feeBpsRaw
    );
    const currentFeeBps = Number(currentFeeBpsRaw);

    const feeRecipientData = crowdfundReadInterface.encodeFunctionData('platformFeeRecipient', []);
    const feeRecipientRaw = await provider.call({ to: campaignAddress, data: feeRecipientData });
    const [currentRecipientRaw] = crowdfundReadInterface.decodeFunctionResult(
      'platformFeeRecipient',
      feeRecipientRaw
    );
    const currentRecipient = String(currentRecipientRaw).toLowerCase();

    const ownerMatchesOperator =
      operatorAddress !== null && normalizedContractOwner === operatorAddress;
    const recipientValid =
      requestedFeeBps === 0 ||
      requestedRecipient !== '0x0000000000000000000000000000000000000000';
    const alreadyApplied =
      currentFeeBps === requestedFeeBps &&
      currentRecipient.toLowerCase() === requestedRecipient.toLowerCase();

    const indexerLastBlock = await getIndexerLastBlockSafe(BASE_SEPOLIA_CHAIN_ID);

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
      campaignAddress,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      operatorAddress,
      contractOwner: normalizedContractOwner,
      requested: {
        platformFeeBps: requestedFeeBps,
        platformFeeRecipient: requestedRecipient,
      },
      current: {
        platformFeeBps: currentFeeBps,
        platformFeeRecipient: currentRecipient,
      },
      checks: {
        operatorConfigured: Boolean(operatorAddress),
        ownerMatchesOperator,
        recipientValid,
        alreadyApplied,
        indexerHealthy: indexerLastBlock > 0,
        workersHealthy: getWorkersHealthyValue(staleSubmittedIntents),
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

export const getPlatformFeeFlowStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const campaignAddressRaw = req.query.campaignAddress?.toString();
    if (!campaignAddressRaw) {
      throw new ValidationError('Missing campaignAddress');
    }
    const campaignAddress = normalizeAddress(campaignAddressRaw, 'campaignAddress');
    const requestedFeeBps =
      req.query.platformFeeBps !== undefined
        ? parseFeeBps(req.query.platformFeeBps, 'platformFeeBps')
        : null;
    const requestedRecipientRaw = req.query.platformFeeRecipient?.toString();
    const requestedRecipient =
      requestedFeeBps === null
        ? null
        : requestedFeeBps === 0
          ? '0x0000000000000000000000000000000000000000'
          : (() => {
              if (!requestedRecipientRaw) {
                throw new ValidationError('Missing platformFeeRecipient');
              }
              return normalizeAddress(requestedRecipientRaw, 'platformFeeRecipient');
            })();

    const latestIntentRows = await sequelize.query<{
      id: string;
      status: string;
      submittedAt: string | null;
      confirmedAt: string | null;
      txHash: string | null;
      platformFeeBps: number;
      platformFeeRecipient: string | null;
      usdcAmountBaseUnits: string | null;
      createdAt: string;
    }>(
      `
      SELECT
        id,
        status,
        submitted_at AS "submittedAt",
        confirmed_at AS "confirmedAt",
        tx_hash AS "txHash",
        platform_fee_bps AS "platformFeeBps",
        LOWER(platform_fee_recipient) AS "platformFeeRecipient",
        usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        created_at AS "createdAt"
      FROM platform_fee_intents
      WHERE LOWER(campaign_address) = :campaignAddress
      ORDER BY created_at DESC
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { campaignAddress: campaignAddress.toLowerCase() },
      }
    );

    const onchainFeeInfo = await getCrowdfundFeeInfo(campaignAddress);

    const latestIntent = latestIntentRows[0] ?? null;
    const currentCampaign = {
      platformFeeBps: onchainFeeInfo.platformFeeBps,
      platformFeeRecipient: onchainFeeInfo.platformFeeRecipient,
      updatedAt: null,
    };

    const targetBps =
      requestedFeeBps ?? (latestIntent ? Number(latestIntent.platformFeeBps) : null);
    const targetRecipient =
      requestedRecipient ??
      (latestIntent ? latestIntent.platformFeeRecipient?.toLowerCase() ?? null : null);
    const campaignMatchesTarget =
      targetBps !== null &&
      currentCampaign !== null &&
      currentCampaign.platformFeeBps === targetBps &&
      (currentCampaign.platformFeeRecipient ?? '').toLowerCase() === (targetRecipient ?? '');

    return res.json({
      campaignAddress,
      flags: {
        intentSubmitted: Boolean(latestIntent),
        intentConfirmed: latestIntent?.status === 'confirmed',
        campaignMatchesTarget,
      },
      latestIntent,
      currentCampaign,
      target: {
        platformFeeBps: targetBps,
        platformFeeRecipient: targetRecipient,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getCampaignLifecyclePreflight = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireAdminAddress(req);
    const campaignAddressRaw = req.query.campaignAddress?.toString();
    if (!campaignAddressRaw) {
      throw new ValidationError('Missing campaignAddress');
    }
    const campaignAddress = normalizeAddress(campaignAddressRaw, 'campaignAddress');

    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }
    const provider = new JsonRpcProvider(rpcUrl);
    const operatorAddress = getPlatformOperatorAddress();

    const [ownerRaw, stateRaw, targetRaw, raisedRaw, startRaw, endRaw, usdcRaw, equityRaw] =
      await Promise.all([
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('owner', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('state', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('targetAmountUSDC', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('raisedAmountUSDC', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('startTime', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('endTime', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('usdcToken', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('equityToken', []),
      }),
    ]);

    const [ownerAddress] = crowdfundReadInterface.decodeFunctionResult('owner', ownerRaw);
    const [stateIndexRaw] = crowdfundReadInterface.decodeFunctionResult('state', stateRaw);
    const [targetAmountRaw] = crowdfundReadInterface.decodeFunctionResult('targetAmountUSDC', targetRaw);
    const [raisedAmountRaw] = crowdfundReadInterface.decodeFunctionResult('raisedAmountUSDC', raisedRaw);
    const [startTimeRaw] = crowdfundReadInterface.decodeFunctionResult('startTime', startRaw);
    const [endTimeRaw] = crowdfundReadInterface.decodeFunctionResult('endTime', endRaw);
    const [usdcAddressRaw] = crowdfundReadInterface.decodeFunctionResult('usdcToken', usdcRaw);
    const [equityAddressRaw] = crowdfundReadInterface.decodeFunctionResult('equityToken', equityRaw);

    const normalizedOwner = String(ownerAddress).toLowerCase();
    const normalizedUsdcAddress = String(usdcAddressRaw).toLowerCase();
    const onchainEquityTokenAddress = String(equityAddressRaw).toLowerCase();
    const stateIndex = Number(stateIndexRaw);
    const state = decodeCrowdfundState(stateIndex);
    const targetAmount = BigInt(targetAmountRaw);
    const raisedAmount = BigInt(raisedAmountRaw);
    const startTime = Number(startTimeRaw);
    const endTime = Number(endTimeRaw);

    const now = Math.floor(Date.now() / 1000);
    const isTargetReached = raisedAmount >= targetAmount;
    const isEnded = now >= endTime;

    const erc20BalanceData = erc20ReadInterface.encodeFunctionData('balanceOf', [campaignAddress]);
    const erc20BalanceRaw = await provider.call({ to: normalizedUsdcAddress, data: erc20BalanceData });
    const [campaignBalanceRaw] = erc20ReadInterface.decodeFunctionResult('balanceOf', erc20BalanceRaw);
    const campaignUsdcBalance = BigInt(campaignBalanceRaw);

    const propertyRows = await sequelize.query<{
      equityTokenAddress: string | null;
      profitDistributorAddress: string | null;
    }>(
      `
      SELECT
        LOWER(p.equity_token_address) AS "equityTokenAddress",
        LOWER(p.profit_distributor_address) AS "profitDistributorAddress"
      FROM campaigns c
      JOIN properties p ON p.id = c.property_id
      WHERE c.chain_id = :chainId
        AND LOWER(c.contract_address) = :campaignAddress
      ORDER BY c.updated_at DESC, c.created_at DESC
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { chainId: BASE_SEPOLIA_CHAIN_ID, campaignAddress: campaignAddress.toLowerCase() },
      }
    );
    const mappedEquityTokenAddress = propertyRows[0]?.equityTokenAddress ?? null;
    const mappedProfitDistributorAddress = propertyRows[0]?.profitDistributorAddress ?? null;

    let investorWallets = 0;
    let equityClaimableWallets = 0;
    let profitClaimableWallets = 0;
    let claimabilityReadErrors = 0;
    if ((state === 'SUCCESS' || state === 'WITHDRAWN') && mappedProfitDistributorAddress) {
      const investorRows = await sequelize.query<{ investorAddress: string }>(
        `
        SELECT LOWER(ci.investor_address) AS "investorAddress"
        FROM campaign_investments ci
        JOIN campaigns c ON c.id = ci.campaign_id
        WHERE ci.chain_id = :chainId
          AND LOWER(c.contract_address) = :campaignAddress
        GROUP BY LOWER(ci.investor_address)
        ORDER BY LOWER(ci.investor_address)
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { chainId: BASE_SEPOLIA_CHAIN_ID, campaignAddress: campaignAddress.toLowerCase() },
        }
      );
      investorWallets = investorRows.length;
      for (const investor of investorRows) {
        try {
          const equityCall = await provider.call({
            to: campaignAddress,
            data: crowdfundReadInterface.encodeFunctionData('claimableTokens', [investor.investorAddress]),
          });
          const [equityClaimableRaw] = crowdfundReadInterface.decodeFunctionResult(
            'claimableTokens',
            equityCall
          );
          if (BigInt(equityClaimableRaw) > 0n) {
            equityClaimableWallets += 1;
          }
        } catch {
          claimabilityReadErrors += 1;
        }
        try {
          const profitCall = await provider.call({
            to: mappedProfitDistributorAddress,
            data: profitReadInterface.encodeFunctionData('claimable', [investor.investorAddress]),
          });
          const [profitClaimableRaw] = profitReadInterface.decodeFunctionResult('claimable', profitCall);
          if (BigInt(profitClaimableRaw) > 0n) {
            profitClaimableWallets += 1;
          }
        } catch {
          claimabilityReadErrors += 1;
        }
      }
    }

    const ownerMatchesOperator = operatorAddress !== null && normalizedOwner === operatorAddress;
    const canFinalizeNow = state === 'ACTIVE' && (isTargetReached || isEnded);
    const canWithdrawNow = state === 'SUCCESS' && campaignUsdcBalance > 0n;

    const finalizeReasons: string[] = [];
    if (!operatorAddress) finalizeReasons.push('operator-wallet-not-configured');
    if (!ownerMatchesOperator) finalizeReasons.push('campaign-owner-not-operator');
    if (state !== 'ACTIVE') finalizeReasons.push(`campaign-state-${state.toLowerCase()}`);
    if (!(isTargetReached || isEnded)) finalizeReasons.push('campaign-not-finishable-yet');

    const withdrawReasons: string[] = [];
    if (!operatorAddress) withdrawReasons.push('operator-wallet-not-configured');
    if (!ownerMatchesOperator) withdrawReasons.push('campaign-owner-not-operator');
    if (state !== 'SUCCESS') withdrawReasons.push(`campaign-state-${state.toLowerCase()}`);
    if (campaignUsdcBalance <= 0n) withdrawReasons.push('campaign-usdc-balance-zero');

    const indexerLastBlock = await getIndexerLastBlockSafe(BASE_SEPOLIA_CHAIN_ID);

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
      campaignAddress,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      operatorAddress,
      contractOwner: normalizedOwner,
      usdcTokenAddress: normalizedUsdcAddress,
      campaign: {
        state,
        stateIndex,
        targetUsdcBaseUnits: targetAmount.toString(),
        raisedUsdcBaseUnits: raisedAmount.toString(),
        campaignUsdcBalanceBaseUnits: campaignUsdcBalance.toString(),
        startTime,
        endTime,
        isTargetReached,
        isEnded,
      },
      checks: {
        operatorConfigured: Boolean(operatorAddress),
        ownerMatchesOperator,
        canFinalizeNow,
        canWithdrawNow,
        indexerHealthy: indexerLastBlock > 0,
        workersHealthy: getWorkersHealthyValue(staleSubmittedIntents),
      },
      actions: {
        finalize: {
          ready: finalizeReasons.length === 0,
          reasons: finalizeReasons,
        },
        withdraw: {
          ready: withdrawReasons.length === 0,
          reasons: withdrawReasons,
        },
      },
      observability: {
        indexerLastBlock,
        staleSubmittedIntents,
      },
      postSettlementHealth: {
        equityTokenSet:
          onchainEquityTokenAddress !== '0x0000000000000000000000000000000000000000',
        onchainEquityTokenAddress,
        mappedEquityTokenAddress,
        profitDistributorAddress: mappedProfitDistributorAddress,
        investorWallets,
        equityClaimableWallets,
        profitClaimableWallets,
        claimabilityReadErrors,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const finalizeCampaign = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId ?? BASE_SEPOLIA_CHAIN_ID);
    const campaignAddress = normalizeAddress(req.body.campaignAddress?.toString(), 'campaignAddress');

    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }
    const operatorPrivateKey = getPlatformOperatorPrivateKey();
    if (!operatorPrivateKey) {
      return sendError(res, 503, 'Operator wallet is not configured', 'service_unavailable');
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(operatorPrivateKey, provider);
    const operatorAddress = signer.address.toLowerCase();

    const ownerData = crowdfundReadInterface.encodeFunctionData('owner', []);
    const ownerRaw = await provider.call({ to: campaignAddress, data: ownerData });
    const [ownerAddress] = crowdfundReadInterface.decodeFunctionResult('owner', ownerRaw);
    const normalizedOwner = String(ownerAddress).toLowerCase();
    if (normalizedOwner !== operatorAddress) {
      return sendError(
        res,
        409,
        'Operator wallet does not own this campaign',
        'bad_request'
      );
    }

    const crowdfund = new Contract(campaignAddress, crowdfundWriteAbi, signer);
    const tx = await crowdfund.finalizeCampaign();
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return sendError(res, 500, 'Finalize transaction reverted', 'internal_error');
    }
    await recordAdminOnchainActivity({
      adminAddress,
      chainId,
      txHash: tx.hash,
      activityType: 'campaign-finalize',
      campaignAddress,
      metadata: {
        operatorAddress,
      },
    });

    const stateRaw = await provider.call({
      to: campaignAddress,
      data: crowdfundReadInterface.encodeFunctionData('state', []),
    });
    const [stateIndexRaw] = crowdfundReadInterface.decodeFunctionResult('state', stateRaw);
    const nextState = decodeCrowdfundState(Number(stateIndexRaw));

    return res.json({
      campaignAddress,
      chainId,
      txHash: tx.hash,
      operatorAddress,
      nextState,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const withdrawCampaignFunds = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId ?? BASE_SEPOLIA_CHAIN_ID);
    const campaignAddress = normalizeAddress(req.body.campaignAddress?.toString(), 'campaignAddress');
    const recipient = normalizeAddress(req.body.recipient?.toString(), 'recipient');

    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }
    const operatorPrivateKey = getPlatformOperatorPrivateKey();
    if (!operatorPrivateKey) {
      return sendError(res, 503, 'Operator wallet is not configured', 'service_unavailable');
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(operatorPrivateKey, provider);
    const operatorAddress = signer.address.toLowerCase();

    const ownerData = crowdfundReadInterface.encodeFunctionData('owner', []);
    const ownerRaw = await provider.call({ to: campaignAddress, data: ownerData });
    const [ownerAddress] = crowdfundReadInterface.decodeFunctionResult('owner', ownerRaw);
    const normalizedOwner = String(ownerAddress).toLowerCase();
    if (normalizedOwner !== operatorAddress) {
      return sendError(
        res,
        409,
        'Operator wallet does not own this campaign',
        'bad_request'
      );
    }

    const crowdfund = new Contract(campaignAddress, crowdfundWriteAbi, signer);
    const tx = await crowdfund.withdrawFunds(recipient);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return sendError(res, 500, 'Withdraw transaction reverted', 'internal_error');
    }
    await recordAdminOnchainActivity({
      adminAddress,
      chainId,
      txHash: tx.hash,
      activityType: 'campaign-withdraw',
      campaignAddress,
      metadata: {
        operatorAddress,
        recipient,
      },
    });

    const stateRaw = await provider.call({
      to: campaignAddress,
      data: crowdfundReadInterface.encodeFunctionData('state', []),
    });
    const [stateIndexRaw] = crowdfundReadInterface.decodeFunctionResult('state', stateRaw);
    const nextState = decodeCrowdfundState(Number(stateIndexRaw));

    return res.json({
      campaignAddress,
      chainId,
      recipient,
      txHash: tx.hash,
      operatorAddress,
      nextState,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const repairCampaignSetup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminAddress = requireAdminAddress(req);
    const chainId = validateChainId(req.body.chainId ?? BASE_SEPOLIA_CHAIN_ID);
    const campaignAddress = normalizeAddress(req.body.campaignAddress?.toString(), 'campaignAddress');

    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }
    const operatorPrivateKey = getPlatformOperatorPrivateKey();
    if (!operatorPrivateKey) {
      return sendError(res, 503, 'Operator wallet is not configured', 'service_unavailable');
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(operatorPrivateKey, provider);
    const operatorAddress = signer.address.toLowerCase();

    const [ownerRaw, stateRaw, equityRaw] = await Promise.all([
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('owner', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('state', []),
      }),
      provider.call({
        to: campaignAddress,
        data: crowdfundReadInterface.encodeFunctionData('equityToken', []),
      }),
    ]);

    const [ownerAddress] = crowdfundReadInterface.decodeFunctionResult('owner', ownerRaw);
    const [stateIndexRaw] = crowdfundReadInterface.decodeFunctionResult('state', stateRaw);
    const [equityAddressRaw] = crowdfundReadInterface.decodeFunctionResult('equityToken', equityRaw);

    const normalizedOwner = String(ownerAddress).toLowerCase();
    if (normalizedOwner !== operatorAddress) {
      return sendError(res, 409, 'Operator wallet does not own this campaign', 'bad_request');
    }

    const nextState = decodeCrowdfundState(Number(stateIndexRaw));
    if (nextState !== 'SUCCESS' && nextState !== 'WITHDRAWN') {
      return sendError(
        res,
        409,
        `Campaign setup repair is only allowed after success/withdrawn. Current state: ${nextState}`,
        'bad_request'
      );
    }

    const currentEquityToken = String(equityAddressRaw).toLowerCase();
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    if (currentEquityToken !== zeroAddress) {
      return res.json({
        campaignAddress,
        chainId,
        txHash: null,
        operatorAddress,
        nextState,
        repaired: false,
        equityTokenAddress: currentEquityToken,
        message: 'Campaign already has an equity token configured.',
      });
    }

    const equityTokenAddress = await resolveEquityTokenForCampaign(chainId, campaignAddress);
    if (!equityTokenAddress) {
      return sendError(
        res,
        404,
        'No equity token mapped for this campaign in properties table',
        'not_found'
      );
    }

    const crowdfund = new Contract(campaignAddress, crowdfundWriteAbi, signer);
    const tx = await crowdfund.setEquityToken(equityTokenAddress);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return sendError(res, 500, 'setEquityToken transaction reverted', 'internal_error');
    }
    await recordAdminOnchainActivity({
      adminAddress,
      chainId,
      txHash: tx.hash,
      activityType: 'campaign-repair-setup',
      campaignAddress,
      metadata: {
        operatorAddress,
        equityTokenAddress,
      },
    });

    return res.json({
      campaignAddress,
      chainId,
      txHash: tx.hash,
      operatorAddress,
      nextState,
      repaired: true,
      equityTokenAddress,
      message: 'Equity token configured successfully.',
    });
  } catch (error) {
    return handleError(res, error);
  }
};
