/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LINKEDIN_CLIENT_ID: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_BACKEND_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
