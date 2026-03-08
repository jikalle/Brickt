import { env } from '../config/env';

const API_ROOT = env.API_BASE_URL;
const API_AUTH_BASE = `${API_ROOT}/v1`;
const API_V1_BASE = `${API_ROOT}/v1`;
export type PropertyBestFor = 'sell' | 'rent' | 'build_and_sell' | 'build_and_rent';

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    address: string;
    role: 'owner' | 'investor';
  };
}

export async function getAuthNonce(): Promise<{ nonce: string; ttlSeconds: number }> {
  const response = await fetch(`${API_AUTH_BASE}/auth/nonce`);
  if (!response.ok) {
    throw new Error('Failed to get auth nonce');
  }
  return response.json();
}

export interface PropertyIntentPayload {
  chainId?: number;
  propertyId: string;
  name: string;
  description: string;
  location: string;
  bestFor?: PropertyBestFor | null;
  imageUrl?: string;
  imageUrls?: string[];
  youtubeEmbedUrl?: string;
  latitude?: number | null;
  longitude?: number | null;
  targetUsdcBaseUnits: string;
  estimatedSellUsdcBaseUnits?: string | null;
  conservativeSellUsdcBaseUnits?: string | null;
  baseSellUsdcBaseUnits?: string | null;
  optimisticSellUsdcBaseUnits?: string | null;
  conservativeMultiplierBps?: number | null;
  baseMultiplierBps?: number | null;
  optimisticMultiplierBps?: number | null;
  startTime?: string;
  endTime?: string;
  crowdfundAddress?: string;
}

export interface PlatformFeeIntentPayload {
  chainId?: number;
  campaignAddress: string;
  platformFeeBps: number;
  platformFeeRecipient?: string | null;
  usdcAmountBaseUnits?: string | null;
}

export interface ProfitDistributionIntentPayload {
  chainId?: number;
  propertyId: string;
  profitDistributorAddress: string;
  usdcAmountBaseUnits: string;
}

export interface AdminIntentBatchPayload {
  chainId?: number;
  includeProfitIntent: boolean;
  includePlatformFeeIntent: boolean;
  propertyId?: string;
  profitDistributorAddress?: string;
  usdcAmountBaseUnits?: string;
  campaignAddress?: string;
  platformFeeBps?: number;
  platformFeeRecipient?: string | null;
  platformFeeUsdcAmountBaseUnits?: string | null;
}

export interface ProfitAllowanceApprovalPayload {
  chainId?: number;
  propertyId: string;
  usdcAmountBaseUnits: string;
  mode?: 'exact' | 'max';
}

export type IntentStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';
export type IntentType = 'property' | 'profit' | 'platformFee';

export interface PropertyIntentResponse {
  id: string;
  chainId: number;
  propertyId: string;
  name: string;
  location: string;
  description: string;
  bestFor: PropertyBestFor | null;
  imageUrl: string | null;
  imageUrls: string[];
  youtubeEmbedUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  targetUsdcBaseUnits: string;
  estimatedSellUsdcBaseUnits: string | null;
  conservativeSellUsdcBaseUnits: string | null;
  baseSellUsdcBaseUnits: string | null;
  optimisticSellUsdcBaseUnits: string | null;
  conservativeMultiplierBps: number | null;
  baseMultiplierBps: number | null;
  optimisticMultiplierBps: number | null;
  startTime: string | null;
  endTime: string | null;
  crowdfundAddress: string | null;
  status: IntentStatus;
  txHash: string | null;
  errorMessage: string | null;
  attemptCount: number;
  submittedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfitDistributionIntentResponse {
  id: string;
  chainId: number;
  propertyId: string;
  profitDistributorAddress: string;
  usdcAmountBaseUnits: string;
  status: IntentStatus;
  txHash: string | null;
  errorMessage: string | null;
  attemptCount: number;
  submittedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformFeeIntentResponse {
  id: string;
  chainId: number;
  campaignAddress: string;
  platformFeeBps: number;
  platformFeeRecipient: string | null;
  usdcAmountBaseUnits: string | null;
  status: IntentStatus;
  txHash: string | null;
  errorMessage: string | null;
  attemptCount: number;
  submittedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyResponse {
  propertyId: string;
  name: string;
  description: string;
  location: string;
  bestFor: PropertyBestFor | null;
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
  platformFeeBps: number | null;
  platformFeeRecipient: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPropertyResponse extends PropertyResponse {
  archivedAt: string | null;
}

export interface CampaignResponse {
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
  platformFeeBps: number | null;
  platformFeeRecipient: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentResponse {
  propertyId: string;
  campaignAddress: string;
  investorAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
}

export interface EquityClaimResponse {
  propertyId: string;
  equityTokenAddress: string;
  campaignAddress: string | null;
  claimantAddress: string;
  equityAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
}

export interface ProfitClaimResponse {
  propertyId: string;
  profitDistributorAddress: string;
  claimerAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
}

export interface InvestorProfitStatusResponse {
  propertyId: string;
  profitDistributorAddress: string;
  campaignAddress: string | null;
  campaignState: string | null;
  equityTokenAddress: string | null;
  contributedBaseUnits: string;
  equityClaimedBaseUnits: string;
  totalDepositedBaseUnits: string;
  totalClaimedBaseUnits: string;
  unclaimedPoolBaseUnits: string;
  lastDepositAt: string | null;
  claimableBaseUnits: string | null;
  claimableError: string | null;
  equityWalletBalanceBaseUnits: string | null;
  claimableTokensBaseUnits: string | null;
  claimableTokensError: string | null;
  diagnostics: {
    profitReady: boolean;
    equityReady: boolean;
    profitReasons: string[];
    equityReasons: string[];
  };
}

export interface EthUsdcQuoteResponse {
  chainId: number;
  usdcAddress: string;
  amountEth: string;
  amountInWei: string;
  estimatedUsdcBaseUnits: string;
  estimatedUsdc: string;
  minUsdcOutBaseUnits: string;
  minUsdcOut: string;
  slippageBps: number;
  feeTier: number;
  source: string;
}

export interface AdminMetricsResponse {
  timestamp: string;
  uptimeSeconds: number;
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  indexer: {
    byChain: Array<{
      chainId: number;
      lastIndexedBlock: number;
    }>;
  };
  health?: {
    checks: {
      rpcConfigured: boolean;
      indexerHealthy: boolean;
      workersHealthy: boolean;
    };
    staleSubmittedIntents: number;
  };
  intents?: {
    property: {
      pending: number;
      submitted: number;
      confirmed: number;
      failed: number;
    };
    profit: {
      pending: number;
      submitted: number;
      confirmed: number;
      failed: number;
    };
    platformFee: {
      pending: number;
      submitted: number;
      confirmed: number;
      failed: number;
    };
    totals: {
      pending: number;
      submitted: number;
      confirmed: number;
      failed: number;
    };
  };
  settlements?: {
    platformFeeTransfers: {
      pending: number;
      submitted: number;
      confirmed: number;
      failed: number;
    };
    profitDeposits: {
      pending: number;
      submitted: number;
      confirmed: number;
      failed: number;
    };
    anomalies: {
      feeTransferStaleSubmitted: number;
      profitDepositStaleSubmitted: number;
      orphanedFeeTransfers: number;
      settlementFailures24h: number;
    };
  };
}

export interface ProfitPreflightResponse {
  propertyId: string;
  chainId: number;
  profitDistributorAddress: string;
  usdcTokenAddress: string;
  operatorAddress: string | null;
  distributorOwner: string;
  requiredUsdcAmountBaseUnits: string;
  operatorUsdcBalanceBaseUnits: string;
  operatorAllowanceBaseUnits: string;
  checks: {
    operatorConfigured: boolean;
    ownerMatchesOperator: boolean;
    hasSufficientBalance: boolean;
    hasSufficientAllowance: boolean;
    indexerHealthy: boolean;
    workersHealthy: boolean;
  };
  observability: {
    indexerLastBlock: number;
    staleSubmittedIntents: number;
  };
}

export interface ProfitFlowStatusResponse {
  propertyId: string;
  flags: {
    intentSubmitted: boolean;
    intentConfirmed: boolean;
    depositIndexed: boolean;
    claimablePoolPositive: boolean;
  };
  latestIntent: {
    id: string;
    status: string;
    submittedAt: string | null;
    confirmedAt: string | null;
    txHash: string | null;
  } | null;
  latestDeposit: {
    txHash: string;
    createdAt: string;
    amountBaseUnits: string;
  } | null;
  unclaimedPoolBaseUnits: string;
}

export interface PlatformFeePreflightResponse {
  campaignAddress: string;
  chainId: number;
  operatorAddress: string | null;
  contractOwner: string;
  requested: {
    platformFeeBps: number;
    platformFeeRecipient: string;
  };
  current: {
    platformFeeBps: number;
    platformFeeRecipient: string;
  };
  checks: {
    operatorConfigured: boolean;
    ownerMatchesOperator: boolean;
    recipientValid: boolean;
    alreadyApplied: boolean;
    indexerHealthy: boolean;
    workersHealthy: boolean;
  };
  observability: {
    indexerLastBlock: number;
    staleSubmittedIntents: number;
  };
}

export interface PlatformFeeFlowStatusResponse {
  campaignAddress: string;
  flags: {
    intentSubmitted: boolean;
    intentConfirmed: boolean;
    campaignMatchesTarget: boolean;
  };
  latestIntent: {
    id: string;
    status: string;
    submittedAt: string | null;
    confirmedAt: string | null;
    txHash: string | null;
    platformFeeBps: number;
    platformFeeRecipient: string | null;
    createdAt: string;
  } | null;
  currentCampaign: {
    platformFeeBps: number | null;
    platformFeeRecipient: string | null;
    updatedAt: string;
  } | null;
  target: {
    platformFeeBps: number | null;
    platformFeeRecipient: string | null;
  };
}

export interface CampaignLifecyclePreflightResponse {
  campaignAddress: string;
  chainId: number;
  operatorAddress: string | null;
  contractOwner: string;
  usdcTokenAddress: string;
  campaign: {
    state: 'ACTIVE' | 'SUCCESS' | 'FAILED' | 'WITHDRAWN';
    stateIndex: number;
    targetUsdcBaseUnits: string;
    raisedUsdcBaseUnits: string;
    campaignUsdcBalanceBaseUnits: string;
    startTime: number;
    endTime: number;
    isTargetReached: boolean;
    isEnded: boolean;
  };
  checks: {
    operatorConfigured: boolean;
    ownerMatchesOperator: boolean;
    canFinalizeNow: boolean;
    canWithdrawNow: boolean;
    indexerHealthy: boolean;
    workersHealthy: boolean;
  };
  actions: {
    finalize: {
      ready: boolean;
      reasons: string[];
    };
    withdraw: {
      ready: boolean;
      reasons: string[];
    };
  };
  observability: {
    indexerLastBlock: number;
    staleSubmittedIntents: number;
  };
  postSettlementHealth: {
    equityTokenSet: boolean;
    onchainEquityTokenAddress: string;
    mappedEquityTokenAddress: string | null;
    profitDistributorAddress: string | null;
    investorWallets: number;
    equityClaimableWallets: number;
    profitClaimableWallets: number;
    claimabilityReadErrors: number;
  };
}

export interface CampaignLifecycleActionResponse {
  campaignAddress: string;
  chainId: number;
  txHash: string | null;
  operatorAddress: string;
  nextState: string;
  recipient?: string;
}

export interface CampaignSetupRepairResponse extends CampaignLifecycleActionResponse {
  repaired: boolean;
  equityTokenAddress: string;
  message: string;
}

export interface ProfitAllowanceApprovalResponse {
  propertyId: string;
  chainId: number;
  profitDistributorAddress: string;
  usdcTokenAddress: string;
  operatorAddress: string;
  mode: 'exact' | 'max';
  requiredUsdcAmountBaseUnits: string;
  approvedUsdcAmountBaseUnits: string;
  allowanceBeforeBaseUnits: string;
  allowanceAfterBaseUnits: string;
  txHash: string | null;
  resetTxHash: string | null;
  usedResetFlow: boolean;
  checks: {
    ownerMatchesOperator: boolean;
    hasSufficientAllowance: boolean;
  };
}

export interface AdminIntentBatchResponse {
  profitIntent: ProfitDistributionIntentResponse | null;
  platformFeeIntent: PlatformFeeIntentResponse | null;
}

export interface IntentActionResponse {
  intentType: IntentType;
  intent: {
    id: string;
    status: IntentStatus;
    attemptCount: number;
    updatedAt: string;
  };
}

export interface AdminProcessingStepResult {
  key: 'propertyIntents' | 'campaignLifecycle' | 'platformFeeIntents' | 'profitIntents' | 'indexerSync';
  label: string;
  status: 'ok' | 'failed';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface AdminProcessingRunResponse {
  processingMode: 'manual_no_worker' | 'hybrid';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: AdminProcessingStepResult[];
}

export interface AdminLastProcessingRunResponse {
  run: {
    id: string;
    triggerSource: 'manual' | 'cron';
    processingMode: 'manual_no_worker' | 'hybrid';
    status: 'ok' | 'failed';
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    createdAt: string;
    steps: AdminProcessingStepResult[];
  } | null;
}

export interface CloudinaryUploadSignatureResponse {
  cloudName: string;
  apiKey: string;
  timestamp: string;
  signature: string;
  folder: string;
  publicId: string | null;
  uploadUrl: string;
}

export async function loginWithWallet(payload: {
  address: string;
  signature: string;
  message: string;
  role: 'owner' | 'investor';
}): Promise<AuthResponse> {
  const response = await fetch(`${API_AUTH_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Authentication failed' }));
    console.error(
      `[auth.api] login_http_error status=${response.status} statusText=${response.statusText} error="${
        error?.error || 'Authentication failed'
      }" role=${payload.role} address=${
        payload.address ? `${payload.address.slice(0, 6)}...${payload.address.slice(-4)}` : ''
      } messageLength=${payload.message.length}`
    );
    throw new Error(error.error || 'Authentication failed');
  }

  return response.json();
}

export async function createPropertyIntent(payload: PropertyIntentPayload, token: string) {
  const response = await fetch(`${API_V1_BASE}/admin/properties/intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      propertyId: payload.propertyId,
      name: payload.name,
      location: payload.location,
      description: payload.description,
      bestFor: payload.bestFor ?? null,
      imageUrl: payload.imageUrl ?? null,
      imageUrls: payload.imageUrls ?? [],
      youtubeEmbedUrl: payload.youtubeEmbedUrl ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      targetUsdcBaseUnits: payload.targetUsdcBaseUnits,
      estimatedSellUsdcBaseUnits: payload.estimatedSellUsdcBaseUnits ?? null,
      conservativeSellUsdcBaseUnits: payload.conservativeSellUsdcBaseUnits ?? null,
      baseSellUsdcBaseUnits: payload.baseSellUsdcBaseUnits ?? null,
      optimisticSellUsdcBaseUnits: payload.optimisticSellUsdcBaseUnits ?? null,
      conservativeMultiplierBps: payload.conservativeMultiplierBps ?? null,
      baseMultiplierBps: payload.baseMultiplierBps ?? null,
      optimisticMultiplierBps: payload.optimisticMultiplierBps ?? null,
      startTime: payload.startTime ?? null,
      endTime: payload.endTime ?? null,
      crowdfundAddress: payload.crowdfundAddress,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create property intent' }));
    throw new Error(error.error || 'Failed to create property intent');
  }

  return response.json();
}

export async function createCloudinaryUploadSignature(
  token: string,
  payload?: { folder?: string; publicId?: string }
): Promise<CloudinaryUploadSignatureResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/media/cloudinary/signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      folder: payload?.folder ?? 'homeshare/properties',
      publicId: payload?.publicId ?? null,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to create Cloudinary upload signature' }));
    throw new Error(error.error || 'Failed to create Cloudinary upload signature');
  }

  return response.json();
}

export async function createPlatformFeeIntent(
  payload: PlatformFeeIntentPayload,
  token: string
) {
  const response = await fetch(`${API_V1_BASE}/admin/platform-fees/intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      campaignAddress: payload.campaignAddress,
      platformFeeBps: payload.platformFeeBps,
      platformFeeRecipient: payload.platformFeeRecipient ?? null,
      usdcAmountBaseUnits: payload.usdcAmountBaseUnits ?? null,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create platform fee intent' }));
    throw new Error(error.error || 'Failed to create platform fee intent');
  }

  return response.json();
}

export async function createProfitDistributionIntent(
  payload: ProfitDistributionIntentPayload,
  token: string
) {
  const response = await fetch(`${API_V1_BASE}/admin/profits/intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      propertyId: payload.propertyId,
      profitDistributorAddress: payload.profitDistributorAddress,
      usdcAmountBaseUnits: payload.usdcAmountBaseUnits,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create profit intent' }));
    throw new Error(error.error || 'Failed to create profit intent');
  }

  return response.json();
}

export async function approveProfitAllowance(
  payload: ProfitAllowanceApprovalPayload,
  token: string
): Promise<ProfitAllowanceApprovalResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/profits/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      propertyId: payload.propertyId,
      usdcAmountBaseUnits: payload.usdcAmountBaseUnits,
      mode: payload.mode ?? 'max',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to approve USDC allowance' }));
    throw new Error(error.error || 'Failed to approve USDC allowance');
  }

  return response.json();
}

export async function createAdminIntentBatch(
  payload: AdminIntentBatchPayload,
  token: string
): Promise<AdminIntentBatchResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/intents/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      includeProfitIntent: payload.includeProfitIntent,
      includePlatformFeeIntent: payload.includePlatformFeeIntent,
      propertyId: payload.propertyId,
      profitDistributorAddress: payload.profitDistributorAddress,
      usdcAmountBaseUnits: payload.usdcAmountBaseUnits,
      campaignAddress: payload.campaignAddress,
      platformFeeBps: payload.platformFeeBps,
      platformFeeRecipient: payload.platformFeeRecipient ?? null,
      platformFeeUsdcAmountBaseUnits: payload.platformFeeUsdcAmountBaseUnits ?? null,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create batch intents' }));
    throw new Error(error.error || 'Failed to create batch intents');
  }

  return response.json();
}

export async function retryAdminIntent(
  token: string,
  intentType: IntentType,
  intentId: string
): Promise<IntentActionResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/intents/${intentType}/${intentId}/retry`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to retry intent' }));
    throw new Error(error.error || 'Failed to retry intent');
  }
  return response.json();
}

export async function resetAdminIntent(
  token: string,
  intentType: IntentType,
  intentId: string
): Promise<IntentActionResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/intents/${intentType}/${intentId}/reset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to reset intent' }));
    throw new Error(error.error || 'Failed to reset intent');
  }
  return response.json();
}

export async function runAdminProcessingNow(
  token: string,
  payload?: {
    propertyIntents?: boolean;
    campaignLifecycle?: boolean;
    platformFeeIntents?: boolean;
    profitIntents?: boolean;
    indexerSync?: boolean;
  }
): Promise<AdminProcessingRunResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/processing/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      propertyIntents: payload?.propertyIntents ?? true,
      campaignLifecycle: payload?.campaignLifecycle ?? true,
      platformFeeIntents: payload?.platformFeeIntents ?? true,
      profitIntents: payload?.profitIntents ?? true,
      indexerSync: payload?.indexerSync ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to run processing cycle' }));
    throw new Error(error.error || 'Failed to run processing cycle');
  }
  return response.json();
}

export async function fetchAdminLastProcessingRun(
  token: string
): Promise<AdminLastProcessingRunResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/processing/last`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch last processing run' }));
    throw new Error(error.error || 'Failed to fetch last processing run');
  }
  return response.json();
}

export async function fetchPropertyIntents(token: string): Promise<PropertyIntentResponse[]> {
  const response = await fetch(`${API_V1_BASE}/admin/properties/intents`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch property intents');
  }
  const data = await response.json();
  return data.intents ?? [];
}

export async function fetchProfitDistributionIntents(
  token: string
): Promise<ProfitDistributionIntentResponse[]> {
  const response = await fetch(`${API_V1_BASE}/admin/profits/intents`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch profit intents');
  }
  const data = await response.json();
  return data.intents ?? [];
}

export async function fetchPlatformFeeIntents(
  token: string
): Promise<PlatformFeeIntentResponse[]> {
  const response = await fetch(`${API_V1_BASE}/admin/platform-fees/intents`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch platform fee intents');
  }
  const data = await response.json();
  return data.intents ?? [];
}

export async function fetchAdminMetrics(token: string): Promise<AdminMetricsResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/metrics`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch admin metrics');
  }
  return response.json();
}

export async function fetchProfitPreflight(
  token: string,
  params: { propertyId: string; usdcAmountBaseUnits?: string }
): Promise<ProfitPreflightResponse> {
  const search = new URLSearchParams({ propertyId: params.propertyId });
  if (params.usdcAmountBaseUnits) {
    search.set('usdcAmountBaseUnits', params.usdcAmountBaseUnits);
  }
  const response = await fetch(`${API_V1_BASE}/admin/profits/preflight?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch profit preflight' }));
    throw new Error(error.error || 'Failed to fetch profit preflight');
  }
  return response.json();
}

export async function fetchProfitFlowStatus(
  token: string,
  propertyId: string
): Promise<ProfitFlowStatusResponse> {
  const search = new URLSearchParams({ propertyId });
  const response = await fetch(`${API_V1_BASE}/admin/profits/flow-status?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch profit flow status' }));
    throw new Error(error.error || 'Failed to fetch profit flow status');
  }
  return response.json();
}

export async function fetchPlatformFeePreflight(
  token: string,
  params: {
    campaignAddress: string;
    platformFeeBps: number;
    platformFeeRecipient?: string | null;
  }
): Promise<PlatformFeePreflightResponse> {
  const search = new URLSearchParams({
    campaignAddress: params.campaignAddress,
    platformFeeBps: String(params.platformFeeBps),
  });
  if (params.platformFeeRecipient) {
    search.set('platformFeeRecipient', params.platformFeeRecipient);
  }
  const response = await fetch(`${API_V1_BASE}/admin/platform-fees/preflight?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to fetch platform fee preflight' }));
    throw new Error(error.error || 'Failed to fetch platform fee preflight');
  }
  return response.json();
}

export async function fetchPlatformFeeFlowStatus(
  token: string,
  params: {
    campaignAddress: string;
    platformFeeBps?: number;
    platformFeeRecipient?: string | null;
  }
): Promise<PlatformFeeFlowStatusResponse> {
  const search = new URLSearchParams({
    campaignAddress: params.campaignAddress,
  });
  if (params.platformFeeBps !== undefined) {
    search.set('platformFeeBps', String(params.platformFeeBps));
  }
  if (params.platformFeeRecipient) {
    search.set('platformFeeRecipient', params.platformFeeRecipient);
  }
  const response = await fetch(`${API_V1_BASE}/admin/platform-fees/flow-status?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to fetch platform fee flow status' }));
    throw new Error(error.error || 'Failed to fetch platform fee flow status');
  }
  return response.json();
}

export async function fetchCampaignLifecyclePreflight(
  token: string,
  campaignAddress: string
): Promise<CampaignLifecyclePreflightResponse> {
  const search = new URLSearchParams({
    campaignAddress,
  });
  const response = await fetch(`${API_V1_BASE}/admin/campaigns/preflight?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to fetch campaign lifecycle preflight' }));
    throw new Error(error.error || 'Failed to fetch campaign lifecycle preflight');
  }
  return response.json();
}

export async function finalizeCampaignAdmin(
  token: string,
  payload: { campaignAddress: string; chainId?: number }
): Promise<CampaignLifecycleActionResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/campaigns/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      campaignAddress: payload.campaignAddress,
    }),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to finalize campaign' }));
    throw new Error(error.error || 'Failed to finalize campaign');
  }
  return response.json();
}

export async function withdrawCampaignFundsAdmin(
  token: string,
  payload: { campaignAddress: string; recipient: string; chainId?: number }
): Promise<CampaignLifecycleActionResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/campaigns/withdraw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      campaignAddress: payload.campaignAddress,
      recipient: payload.recipient,
    }),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to withdraw campaign funds' }));
    throw new Error(error.error || 'Failed to withdraw campaign funds');
  }
  return response.json();
}

export async function repairCampaignSetupAdmin(
  token: string,
  payload: { campaignAddress: string; chainId?: number }
): Promise<CampaignSetupRepairResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/campaigns/repair-setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chainId: payload.chainId ?? 84532,
      campaignAddress: payload.campaignAddress,
    }),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to repair campaign setup' }));
    throw new Error(error.error || 'Failed to repair campaign setup');
  }
  return response.json();
}

export async function fetchProperties(): Promise<PropertyResponse[]> {
  const response = await fetch(`${API_V1_BASE}/properties`);

  if (!response.ok) {
    throw new Error('Failed to fetch properties');
  }

  const data = await response.json();
  return data.properties ?? [];
}

export async function fetchAdminProperties(
  token: string,
  includeArchived = true
): Promise<AdminPropertyResponse[]> {
  const search = new URLSearchParams({
    includeArchived: includeArchived ? 'true' : 'false',
  });
  const response = await fetch(`${API_V1_BASE}/admin/properties?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch admin properties' }));
    throw new Error(error.error || 'Failed to fetch admin properties');
  }
  const data = await response.json();
  return data.properties ?? [];
}

export async function updateAdminProperty(
  token: string,
  propertyId: string,
  payload: {
    name?: string;
    location?: string;
    description?: string;
    bestFor?: PropertyBestFor | null;
    imageUrl?: string | null;
    imageUrls?: string[] | null;
    youtubeEmbedUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    estimatedSellUsdcBaseUnits?: string | null;
    conservativeSellUsdcBaseUnits?: string | null;
    baseSellUsdcBaseUnits?: string | null;
    optimisticSellUsdcBaseUnits?: string | null;
    conservativeMultiplierBps?: number | null;
    baseMultiplierBps?: number | null;
    optimisticMultiplierBps?: number | null;
  }
): Promise<AdminPropertyResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/properties/${encodeURIComponent(propertyId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to update property' }));
    throw new Error(error.error || 'Failed to update property');
  }
  const data = await response.json();
  return data.property as AdminPropertyResponse;
}

export async function archiveAdminProperty(
  token: string,
  propertyId: string
): Promise<AdminPropertyResponse> {
  const response = await fetch(`${API_V1_BASE}/admin/properties/${encodeURIComponent(propertyId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to archive property' }));
    throw new Error(error.error || 'Failed to archive property');
  }
  const data = await response.json();
  return data.property as AdminPropertyResponse;
}

export async function restoreAdminProperty(
  token: string,
  propertyId: string
): Promise<AdminPropertyResponse> {
  const response = await fetch(
    `${API_V1_BASE}/admin/properties/${encodeURIComponent(propertyId)}/restore`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to restore property' }));
    throw new Error(error.error || 'Failed to restore property');
  }
  const data = await response.json();
  return data.property as AdminPropertyResponse;
}

export async function fetchProperty(propertyId: string): Promise<PropertyResponse> {
  const response = await fetch(`${API_V1_BASE}/properties/${encodeURIComponent(propertyId)}`);

  if (!response.ok) {
    throw new Error('Failed to fetch property');
  }

  const data = await response.json();
  if (!data?.property) {
    throw new Error('Property not found');
  }

  return data.property as PropertyResponse;
}

export async function fetchMyInvestments(token: string): Promise<InvestmentResponse[]> {
  const response = await fetch(`${API_V1_BASE}/me/investments`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Please authenticate to view your portfolio');
    }
    throw new Error('Failed to fetch investments');
  }

  const data = await response.json();
  return data.investments ?? [];
}

export async function fetchCampaigns(): Promise<CampaignResponse[]> {
  const response = await fetch(`${API_V1_BASE}/campaigns`);
  if (!response.ok) {
    throw new Error('Failed to fetch campaigns');
  }
  const data = await response.json();
  return data.campaigns ?? [];
}

export async function fetchCampaign(campaignAddress: string): Promise<CampaignResponse> {
  const response = await fetch(
    `${API_V1_BASE}/campaigns/${encodeURIComponent(campaignAddress)}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch campaign');
  }
  const data = await response.json();
  if (!data?.campaign) {
    throw new Error('Campaign not found');
  }
  return data.campaign as CampaignResponse;
}

export async function fetchCampaignInvestments(
  campaignAddress: string
): Promise<InvestmentResponse[]> {
  const response = await fetch(
    `${API_V1_BASE}/campaigns/${encodeURIComponent(campaignAddress)}/investments`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch campaign investments');
  }
  const data = await response.json();
  return data.investments ?? [];
}

export async function fetchPropertyEquityClaims(
  propertyId: string
): Promise<EquityClaimResponse[]> {
  const response = await fetch(
    `${API_V1_BASE}/properties/${encodeURIComponent(propertyId)}/equity-claims`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch property equity claims');
  }
  const data = await response.json();
  return data.equityClaims ?? [];
}

export async function fetchPropertyProfitClaims(
  propertyId: string
): Promise<ProfitClaimResponse[]> {
  const response = await fetch(
    `${API_V1_BASE}/properties/${encodeURIComponent(propertyId)}/profit-claims`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch property profit claims');
  }
  const data = await response.json();
  return data.profitClaims ?? [];
}

export async function fetchMyEquityClaims(token: string): Promise<EquityClaimResponse[]> {
  const response = await fetch(`${API_V1_BASE}/me/equity-claims`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Please authenticate to view your equity claims');
    }
    throw new Error('Failed to fetch equity claims');
  }

  const data = await response.json();
  return data.equityClaims ?? [];
}

export async function fetchMyProfitClaims(token: string): Promise<ProfitClaimResponse[]> {
  const response = await fetch(`${API_V1_BASE}/me/profit-claims`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Please authenticate to view your profit claims');
    }
    throw new Error('Failed to fetch profit claims');
  }

  const data = await response.json();
  return data.profitClaims ?? [];
}

export async function fetchMyProfitStatus(token: string): Promise<InvestorProfitStatusResponse[]> {
  const response = await fetch(`${API_V1_BASE}/me/profit-status`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Please authenticate to view your profit status');
    }
    throw new Error('Failed to fetch profit status');
  }

  const data = await response.json();
  return data.statuses ?? [];
}

export async function fetchEthUsdcQuote(payload: {
  amountEth: string;
  slippagePercent: string;
  usdcAddress?: string;
}): Promise<EthUsdcQuoteResponse> {
  const params = new URLSearchParams({
    amountEth: payload.amountEth,
    slippagePercent: payload.slippagePercent,
  });
  if (payload.usdcAddress) {
    params.set('usdcAddress', payload.usdcAddress);
  }
  const response = await fetch(`${API_V1_BASE}/quotes/eth-usdc?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch ETH/USDC quote' }));
    throw new Error(error.error || 'Failed to fetch ETH/USDC quote');
  }
  const data = await response.json();
  if (!data?.quote) {
    throw new Error('Invalid quote response');
  }
  return data.quote as EthUsdcQuoteResponse;
}
