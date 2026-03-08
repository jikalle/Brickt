import { env } from '../config/env';

const TX_HASH_PATTERN = /0x[a-fA-F0-9]{64}/g;

const getBaseScanBaseUrl = () => {
  const normalized = env.DEFAULT_CHAIN.trim().toLowerCase();
  if (normalized === 'base') {
    return 'https://basescan.org/tx/';
  }
  return 'https://sepolia.basescan.org/tx/';
};

export const formatTxHash = (txHash: string, visible = 6) => {
  if (!txHash || txHash.length < 2 * visible + 2) {
    return txHash;
  }
  return `${txHash.slice(0, 2 + visible)}...${txHash.slice(-visible)}`;
};

export const buildTxExplorerUrl = (txHash: string) => `${getBaseScanBaseUrl()}${txHash}`;

export const extractTxHashes = (value: string): string[] => {
  if (!value) return [];
  const matches = value.match(TX_HASH_PATTERN);
  if (!matches) return [];
  return Array.from(new Set(matches.map((item) => item.toLowerCase())));
};

