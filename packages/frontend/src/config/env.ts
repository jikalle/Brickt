export const env = {
  APP_NAME: import.meta.env.VITE_APP_NAME || 'Homeshare',
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  DEFAULT_CHAIN: import.meta.env.VITE_DEFAULT_CHAIN || 'base-sepolia',
  SUPPORTED_CHAINS: (import.meta.env.VITE_SUPPORTED_CHAINS || 'base-sepolia,base').split(','),
  OWNER_ALLOWLIST: (import.meta.env.VITE_OWNER_ALLOWLIST || '')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean),
};
