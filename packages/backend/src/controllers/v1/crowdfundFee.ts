import { Interface, JsonRpcProvider } from 'ethers';

type CrowdfundFeeInfo = {
  platformFeeBps: number | null;
  platformFeeRecipient: string | null;
};

const feeInterface = new Interface([
  'function platformFeeBps() view returns (uint16)',
  'function platformFeeRecipient() view returns (address)',
]);

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const provider = rpcUrl ? new JsonRpcProvider(rpcUrl) : null;

const defaultFeeInfo: CrowdfundFeeInfo = {
  platformFeeBps: null,
  platformFeeRecipient: null,
};

export async function getCrowdfundFeeInfo(
  campaignAddress: string
): Promise<CrowdfundFeeInfo> {
  if (!provider) {
    return defaultFeeInfo;
  }

  try {
    const [feeResult, recipientResult] = await Promise.all([
      provider.call({
        to: campaignAddress,
        data: feeInterface.encodeFunctionData('platformFeeBps', []),
      }),
      provider.call({
        to: campaignAddress,
        data: feeInterface.encodeFunctionData('platformFeeRecipient', []),
      }),
    ]);

    const [feeBps] = feeInterface.decodeFunctionResult('platformFeeBps', feeResult);
    const [recipient] = feeInterface.decodeFunctionResult(
      'platformFeeRecipient',
      recipientResult
    );

    return {
      platformFeeBps: Number(feeBps),
      platformFeeRecipient: String(recipient).toLowerCase(),
    };
  } catch (_error) {
    return defaultFeeInfo;
  }
}

