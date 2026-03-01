import { Chain, ChainConfig } from '../types/chain';

export const BASE_SEPOLIA: Chain = {
  id: 84532,
  name: 'Base Sepolia',
  rpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  blockExplorer: 'https://sepolia.basescan.org',
  isTestnet: true,
};

export const BASE_MAINNET: Chain = {
  id: 8453,
  name: 'Base',
  rpcUrl: import.meta.env.VITE_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  blockExplorer: 'https://basescan.org',
  isTestnet: false,
};

export const SUPPORTED_CHAINS: ChainConfig = {
  84532: BASE_SEPOLIA,
  8453: BASE_MAINNET,
};

export const DEFAULT_CHAIN_ID = 84532;
