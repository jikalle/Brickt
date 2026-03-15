import { createBaseAccountSDK } from '@base-org/account';
import { env } from '../config/env';

type WalletConnectAccount = {
  address: string;
  capabilities?: {
    signInWithEthereum?: {
      message: string;
      signature: string;
    };
  };
};

type WalletConnectResponse = {
  accounts?: WalletConnectAccount[];
};

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const sdk = createBaseAccountSDK({
  appName: 'Brickt',
  appChainIds: [84532, 8453],
});

const provider = sdk.getProvider();

const toHexChainId = (chainId: number): `0x${string}` => `0x${chainId.toString(16)}`;
const toHexValue = (value: bigint | number = 0): `0x${string}` => `0x${BigInt(value).toString(16)}`;

type WalletCapabilities = Record<string, {
  paymasterService?: { supported?: boolean };
  atomic?: { supported?: string | boolean };
}>;

type WalletSendCall = {
  to: string;
  data?: `0x${string}`;
  value?: `0x${string}`;
};

type WalletSendCallsResponse = {
  batchId?: string;
  id?: string;
};

type WalletCallReceipt = {
  transactionHash?: string;
};

type WalletCallsStatus = {
  status: number;
  receipts?: WalletCallReceipt[];
};

const toHexUtf8 = (value: string): `0x${string}` => {
  const bytes = new TextEncoder().encode(value);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}`;
};

const buildFallbackMessage = (address: string, nonce: string, chainId: number): string =>
  [
    'Brickt wants you to sign in with your wallet.',
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');

const getInjectedProvider = (): Eip1193Provider | null => {
  const maybe = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (maybe && typeof maybe.request === 'function') {
    return maybe;
  }
  return null;
};

export const getBaseAccountProvider = (): Eip1193Provider => provider as Eip1193Provider;
export const getCurrentInjectedProvider = (): Eip1193Provider | null => getInjectedProvider();

const isTrustworthyOrigin = (): boolean => {
  if (window.isSecureContext) {
    return true;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
};

const signWithPersonalSign = async (
  signerProvider: Eip1193Provider,
  nonce: string,
  chainId: number
): Promise<{ address: string; message: string; signature: string }> => {
  const [address] = (await signerProvider.request({
    method: 'eth_requestAccounts',
  })) as string[];

  if (!address) {
    throw new Error('No wallet address returned');
  }

  const message = buildFallbackMessage(address, nonce, chainId);
  const signature = (await signerProvider.request({
    method: 'personal_sign',
    params: [toHexUtf8(message), address],
  })) as string;

  if (!signature) {
    throw new Error('Failed to sign message');
  }

  return { address, message, signature };
};

export async function signInWithBaseAccount(params: {
  nonce: string;
  chainId: number;
}): Promise<{ address: string; message: string; signature: string }> {
  const { nonce, chainId } = params;
  const injected = getInjectedProvider();

  if (!isTrustworthyOrigin()) {
    console.warn(
      `[auth.base] skipping_wallet_connect_untrustworthy_origin origin=${window.location.origin} chainId=${chainId}`
    );
    if (injected) {
      return signWithPersonalSign(injected, nonce, chainId);
    }
    throw new Error('Insecure origin for Sign in with Base. Use https or localhost.');
  }

  try {
    const response = (await provider.request({
      method: 'wallet_connect',
      params: [
        {
          version: '1',
          capabilities: {
            signInWithEthereum: {
              nonce,
              chainId: toHexChainId(chainId),
            },
          },
        },
      ],
    })) as WalletConnectResponse;

    const account = response.accounts?.[0];
    const message = account?.capabilities?.signInWithEthereum?.message;
    const signature = account?.capabilities?.signInWithEthereum?.signature;

    if (!account?.address || !message || !signature) {
      throw new Error('Invalid Sign in with Base response');
    }

    return {
      address: account.address,
      message,
      signature,
    };
  } catch (error) {
    console.error(
      `[auth.base] wallet_connect_failed chainId=${chainId} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (injected) {
      try {
        return signWithPersonalSign(injected, nonce, chainId);
      } catch (fallbackError) {
        console.error(
          `[auth.base] injected_fallback_failed chainId=${chainId} error=${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`
        );
        throw fallbackError;
      }
    }
    try {
      return signWithPersonalSign(provider as Eip1193Provider, nonce, chainId);
    } catch (fallbackError) {
      console.error(
        `[auth.base] sdk_provider_fallback_failed chainId=${chainId} error=${
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }`
      );
      throw fallbackError;
    }
  }
}

export async function signInWithInjectedWallet(params: {
  nonce: string;
  chainId: number;
}): Promise<{ address: string; message: string; signature: string }> {
  const { nonce, chainId } = params;
  const injected = getInjectedProvider();
  if (!injected) {
    throw new Error('No injected wallet provider available');
  }
  return signWithPersonalSign(injected, nonce, chainId);
}

export async function getWalletCapabilities(params: {
  walletProvider: Eip1193Provider;
  address: string;
  chainId: number;
}): Promise<{ paymasterSupported: boolean; atomicSupported: boolean }> {
  const { walletProvider, address, chainId } = params;
  const result = (await walletProvider.request({
    method: 'wallet_getCapabilities',
    params: [address],
  })) as WalletCapabilities;

  const chainCapabilities = result?.[toHexChainId(chainId)];
  return {
    paymasterSupported: !!chainCapabilities?.paymasterService?.supported,
    atomicSupported:
      chainCapabilities?.atomic?.supported === 'supported' || chainCapabilities?.atomic?.supported === true,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForCallsStatus(params: {
  walletProvider: Eip1193Provider;
  batchId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<WalletCallsStatus> {
  const {
    walletProvider,
    batchId,
    timeoutMs = 120_000,
    pollIntervalMs = 1_250,
  } = params;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = (await walletProvider.request({
      method: 'wallet_getCallsStatus',
      params: [batchId],
    })) as WalletCallsStatus;

    if (status.status !== 100) {
      return status;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error('Timed out waiting for sponsored transaction batch confirmation');
}

const describeBatchFailure = (status: number) => {
  if (status === 400) return 'Sponsored transaction batch failed before submission';
  if (status === 500) return 'Sponsored transaction batch reverted onchain';
  if (status === 600) return 'Sponsored transaction batch completed with partial failure';
  return `Sponsored transaction batch failed with status ${status}`;
};

export async function trySendSponsoredCall(params: {
  walletProvider: Eip1193Provider;
  from: string;
  chainId: number;
  call: WalletSendCall;
  paymasterUrl?: string | null;
}): Promise<{ batchId: string; txHash: string | null } | null> {
  const { walletProvider, from, chainId, call, paymasterUrl } = params;
  const normalizedPaymasterUrl = paymasterUrl?.trim();
  if (!normalizedPaymasterUrl) {
    return null;
  }

  try {
    const capabilities = await getWalletCapabilities({ walletProvider, address: from, chainId });
    if (!capabilities.paymasterSupported) {
      return null;
    }

    const response = (await walletProvider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          version: '2.0.0',
          from,
          chainId: toHexChainId(chainId),
          atomicRequired: false,
          calls: [
            {
              to: call.to,
              value: call.value || toHexValue(0),
              ...(call.data ? { data: call.data } : {}),
            },
          ],
          capabilities: {
            paymasterService: {
              url: normalizedPaymasterUrl,
            },
          },
        },
      ],
    })) as WalletSendCallsResponse;

    const batchId = response.batchId || response.id;
    if (!batchId) {
      throw new Error('wallet_sendCalls did not return a batch id');
    }

    const status = await waitForCallsStatus({ walletProvider, batchId });
    if (status.status !== 200) {
      throw new Error(describeBatchFailure(status.status));
    }

    return {
      batchId,
      txHash: status.receipts?.[0]?.transactionHash || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('wallet_getCapabilities') ||
      message.includes('wallet_sendCalls') ||
      message.includes('wallet_getCallsStatus') ||
      message.includes('unsupported') ||
      message.includes('not supported') ||
      message.includes('Missing required capability') ||
      message.includes('User rejected')
    ) {
      return null;
    }
    throw error;
  }
}

export const getBasePaymasterUrl = (chainId: number): string | null => {
  if (chainId === 84532) {
    return env.BASE_SEPOLIA_PAYMASTER_URL || null;
  }
  return null;
};
