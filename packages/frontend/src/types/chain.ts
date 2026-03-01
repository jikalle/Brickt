export type ChainId = number;

export interface Chain {
  id: ChainId;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
  isTestnet: boolean;
}

export interface ChainConfig {
  [chainId: number]: Chain;
}
