import { Token } from '../types/token';
import { env } from './env';

// Base Sepolia tokens
export const BASE_SEPOLIA_USDC: Token = {
  // Official Base Sepolia USDC
  address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 84532,
};

export const BASE_SEPOLIA_ETH: Token = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  chainId: 84532,
};

export const getBaseSepoliaPlatformToken = (): Token | null => {
  const address = env.BASE_SEPOLIA_PLATFORM_TOKEN_ADDRESS.trim();
  if (!address) {
    return null;
  }
  return {
    address,
    symbol: env.BASE_SEPOLIA_PLATFORM_TOKEN_SYMBOL,
    name: env.BASE_SEPOLIA_PLATFORM_TOKEN_NAME,
    decimals: env.BASE_SEPOLIA_PLATFORM_TOKEN_DECIMALS,
    chainId: 84532,
  };
};

// Base Mainnet tokens
export const BASE_USDC: Token = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b1566469c3d',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 8453,
};

export const BASE_USDT: Token = {
  address: '0xfde4C96c8593536E31F26E3DaA6eFB41D12d2588',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 6,
  chainId: 8453,
};

export const BASE_ETH: Token = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  chainId: 8453,
};

export const TOKENS_BY_CHAIN: { [chainId: number]: Token[] } = {
  84532: [BASE_SEPOLIA_USDC, BASE_SEPOLIA_ETH].concat(getBaseSepoliaPlatformToken() ?? []),
  8453: [BASE_USDC, BASE_USDT, BASE_ETH],
};

export const getAllTokens = (): Token[] => {
  return Object.values(TOKENS_BY_CHAIN).flat();
};

export const getTokensByChain = (chainId: number): Token[] => {
  return TOKENS_BY_CHAIN[chainId] || [];
};
