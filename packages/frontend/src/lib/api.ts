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
