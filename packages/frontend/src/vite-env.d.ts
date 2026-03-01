/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_DEFAULT_CHAIN: string
  readonly VITE_SUPPORTED_CHAINS: string
  readonly VITE_OWNER_ALLOWLIST: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
