import { createBaseAccountSDK } from '@base-org/account';

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

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const sdk = createBaseAccountSDK({
  appName: 'Homeshare',
  appChainIds: [84532, 8453],
});

const provider = sdk.getProvider();

const toHexChainId = (chainId: number): `0x${string}` => `0x${chainId.toString(16)}`;

const toHexUtf8 = (value: string): `0x${string}` => {
  const bytes = new TextEncoder().encode(value);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}`;
};

const buildFallbackMessage = (address: string, nonce: string, chainId: number): string =>
  [
    'Homeshare wants you to sign in with your wallet.',
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
