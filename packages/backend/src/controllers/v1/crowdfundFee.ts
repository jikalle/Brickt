import { Interface, JsonRpcProvider } from 'ethers';
import { BASE_SEPOLIA_CHAIN_ID } from '../../validators/v1.js';

type CrowdfundFeeInfo = {
  platformFeeBps: number | null;
  platformFeeRecipient: string | null;
};

const feeInterface = new Interface([
  'function platformFeeBps() view returns (uint16)',
  'function platformFeeRecipient() view returns (address)',
]);

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const FEE_CACHE_TTL_MS = 30_000;
const FEE_LOOKUP_TIMEOUT_MS = 1_500;
const provider = rpcUrl
  ? new JsonRpcProvider(rpcUrl, BASE_SEPOLIA_CHAIN_ID, { staticNetwork: true })
  : null;

const defaultFeeInfo: CrowdfundFeeInfo = {
  platformFeeBps: null,
  platformFeeRecipient: null,
};

const feeCache = new Map<
  string,
  {
    expiresAt: number;
    value: CrowdfundFeeInfo;
  }
>();

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('crowdfund-fee-timeout')), timeoutMs);
    }),
  ]);
};

export async function getCrowdfundFeeInfo(
  campaignAddress: string
): Promise<CrowdfundFeeInfo> {
  if (!provider) {
    return defaultFeeInfo;
  }

  const cacheKey = campaignAddress.toLowerCase();
  const cached = feeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const [feeResult, recipientResult] = await withTimeout(
      Promise.all([
        provider.call({
          to: campaignAddress,
          data: feeInterface.encodeFunctionData('platformFeeBps', []),
        }),
        provider.call({
          to: campaignAddress,
          data: feeInterface.encodeFunctionData('platformFeeRecipient', []),
        }),
      ]),
      FEE_LOOKUP_TIMEOUT_MS
    );

    const [feeBps] = feeInterface.decodeFunctionResult('platformFeeBps', feeResult);
    const [recipient] = feeInterface.decodeFunctionResult(
      'platformFeeRecipient',
      recipientResult
    );

    const result = {
      platformFeeBps: Number(feeBps),
      platformFeeRecipient: String(recipient).toLowerCase(),
    };
    feeCache.set(cacheKey, {
      expiresAt: Date.now() + FEE_CACHE_TTL_MS,
      value: result,
    });
    return result;
  } catch (_error) {
    feeCache.set(cacheKey, {
      expiresAt: Date.now() + FEE_CACHE_TTL_MS,
      value: defaultFeeInfo,
    });
    return defaultFeeInfo;
  }
}
