export const env = {
  APP_NAME: import.meta.env.VITE_APP_NAME || 'Homeshare',
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  DEFAULT_CHAIN: import.meta.env.VITE_DEFAULT_CHAIN || 'base-sepolia',
  SUPPORTED_CHAINS: (import.meta.env.VITE_SUPPORTED_CHAINS || 'base-sepolia,base').split(','),
  OWNER_ALLOWLIST: (import.meta.env.VITE_OWNER_ALLOWLIST || '')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean),
  BASE_SEPOLIA_WETH:
    import.meta.env.VITE_BASE_SEPOLIA_WETH || '0x4200000000000000000000000000000000000006',
  BASE_SEPOLIA_SWAP_ROUTER: import.meta.env.VITE_BASE_SEPOLIA_SWAP_ROUTER || '',
  BASE_SEPOLIA_QUOTER: import.meta.env.VITE_BASE_SEPOLIA_QUOTER || '',
  BASE_SEPOLIA_SWAP_POOL_FEE: Number(import.meta.env.VITE_BASE_SEPOLIA_SWAP_POOL_FEE || '500'),
  BASE_BUILDER_CODES: (import.meta.env.VITE_BASE_BUILDER_CODES || '')
    .split(',')
    .map((value: string) => value.trim())
    .filter(Boolean),
};
