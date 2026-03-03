import { env } from '../config/env';

const API_ROOT = env.API_BASE_URL;
const API_AUTH_BASE = `${API_ROOT}/v1`;
const API_V1_BASE = `${API_ROOT}/v1`;

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
  targetUsdcBaseUnits: string;
  startTime?: string;
  endTime?: string;
  crowdfundAddress?: string;
}

export interface PlatformFeeIntentPayload {
  chainId?: number;
  campaignAddress: string;
  platformFeeBps: number;
  platformFeeRecipient?: string | null;
}

export interface ProfitDistributionIntentPayload {
  chainId?: number;
  propertyId: string;
  profitDistributorAddress: string;
  usdcAmountBaseUnits: string;
}

export type IntentStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface PropertyIntentResponse {
  id: string;
  chainId: number;
  propertyId: string;
  name: string;
  location: string;
  description: string;
  targetUsdcBaseUnits: string;
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
  crowdfundAddress: string;
  equityTokenAddress: string;
  profitDistributorAddress: string;
  targetUsdcBaseUnits: string;
  platformFeeBps: number | null;
  platformFeeRecipient: string | null;
  createdAt: string;
  updatedAt: string;
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
      targetUsdcBaseUnits: payload.targetUsdcBaseUnits,
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

export async function fetchProperties(): Promise<PropertyResponse[]> {
  const response = await fetch(`${API_V1_BASE}/properties`);

  if (!response.ok) {
    throw new Error('Failed to fetch properties');
  }

  const data = await response.json();
  return data.properties ?? [];
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
